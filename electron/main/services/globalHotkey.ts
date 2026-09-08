/**
 * 全局快捷键服务
 *
 * 双模式：
 * - Linux + hotkeys.portalShortcuts 开启且 portal 后端支持时，走 XDG Desktop Portal
 *   GlobalShortcuts（Wayland 下 Electron globalShortcut 不可用），绑定全部 allowGlobal 动作，
 *   触发由主进程回调后广播给渲染端
 * - 其余情况回退 Electron globalShortcut
 *
 * 职责：
 * - 启动时读 settings.json 的 hotkeys 字段，注册 globalShortcut / portal bind
 * - 设置变更时整体重注册
 * - globalEnabled = false 时不注册任何全局键
 * - 注册失败/系统占用记入 conflicts 表，broadcast 给渲染端
 * - 触发时不直接执行业务，broadcast `hotkey:trigger` 让渲染端 dispatch
 */

import { app, globalShortcut } from "electron";
import { store } from "@main/store";
import { broadcast } from "@main/utils/broadcast";
import { coreLog, nativeLogsDir } from "@main/utils/logger";
import { isDev } from "@main/utils/config";
import { loadNativeModule } from "@main/utils/nativeLoader";
import { acceleratorToXdgTrigger } from "@shared/utils/accelerator";
import type {
  HotkeyActionId,
  HotkeyBinding,
  HotkeyConfig,
  HotkeyConflict,
  HotkeyGlobalMode,
  HotkeyGlobalModeSnapshot,
} from "@shared/types/hotkey";
import { defaultHotkeyConfig, HOTKEY_ACTIONS } from "@shared/defaults/hotkeys";
import { normalizeAccelerator } from "@shared/utils/accelerator";
import type { PortalCapability, PortalShortcut } from "@splayer/linux-portal";

type PortalModule = typeof import("@splayer/linux-portal");

let portalModule: PortalModule | null = null;
let portalCapability: PortalCapability | null = null;
let currentMode: HotkeyGlobalMode = "electron";
/** 探测/初始化请求代际，用于规避切换竞态（如探测期间用户关闭 portal） */
let portalEpoch = 0;
/** 进行中的 portal 初始化 promise，IPC 读取模式快照时等待它落定 */
let readyPromise: Promise<void> | null = null;
/** 模式切换串行链：portal 绑定/解绑与 Electron 注册必须依次完成，避免快速切换时交错 */
let transitionChain: Promise<void> = Promise.resolve();

/** 把一段模式切换操作排入串行链并等待其完成（链内异常不会污染后续节点） */
const enqueueTransition = (op: () => Promise<void>): Promise<void> => {
  const next = transitionChain.then(op);
  transitionChain = next.catch(() => {});
  return next;
};

let conflicts: HotkeyConflict[] = [];
/** 当前 portal 会话是否保持绑定（跟随 globalEnabled） */
let portalBound = false;

/** 渲染端上报的快捷键描述（key: HotkeyActionId，value: 当前语言文本） */
let portalDescriptions: Partial<Record<HotkeyActionId, string>> = {};
/** 描述首次上报前等待（portal 首次绑定前保证拿到本地化描述，避免首绑显示原始 id） */
let resolveDescriptionsReady: (() => void) | null = null;
const descriptionsReady = new Promise<void>((resolve) => {
  resolveDescriptionsReady = resolve;
});

/** 取当前完整配置（store 兜底默认） */
const readConfig = (): HotkeyConfig => {
  const stored = store.get("hotkeys") as Partial<HotkeyConfig> | undefined;
  if (!stored || typeof stored !== "object") {
    return { ...defaultHotkeyConfig, bindings: { ...defaultHotkeyConfig.bindings } };
  }
  return {
    globalEnabled: stored.globalEnabled ?? defaultHotkeyConfig.globalEnabled,
    portalShortcuts: stored.portalShortcuts ?? defaultHotkeyConfig.portalShortcuts,
    bindings: { ...defaultHotkeyConfig.bindings, ...(stored.bindings ?? {}) },
  };
};

/** 写入完整配置并重注册 */
const writeConfig = (next: HotkeyConfig): HotkeyConfig => {
  store.set("hotkeys", next);
  syncRegistration();
  return readConfig();
};

/** 卸载 Electron 快捷键并清空冲突 */
const unregisterElectronShortcuts = (): void => {
  globalShortcut.unregisterAll();
  conflicts = [];
};

/**
 * 注册全部 global accelerators（仅 Electron 模式）
 * 同 accelerator 重复 / OS 占用 / 解析异常 都计入 conflicts
 * globalEnabled = false 时只解绑，不注册新的
 */
const registerElectronShortcuts = (): void => {
  unregisterElectronShortcuts();
  if (currentMode === "portal") return;
  const config = readConfig();
  if (!config.globalEnabled) {
    broadcast("hotkey:conflicts", conflicts);
    return;
  }
  const seenAccel = new Map<string, HotkeyActionId>();
  const ids = Object.keys(config.bindings) as HotkeyActionId[];

  for (const id of ids) {
    const accel = config.bindings[id]?.global;
    if (!accel) continue;

    const norm = normalizeAccelerator(accel);
    if (!norm) {
      conflicts.push({ id, scope: "global", reason: "invalid" });
      continue;
    }

    const occupier = seenAccel.get(norm);
    if (occupier) {
      conflicts.push({
        id,
        scope: "global",
        reason: "duplicate",
        conflictWith: occupier,
      });
      continue;
    }

    try {
      const ok = globalShortcut.register(norm, () => {
        broadcast("hotkey:trigger", id);
      });
      if (ok) {
        seenAccel.set(norm, id);
      } else {
        conflicts.push({ id, scope: "global", reason: "os-occupied" });
      }
    } catch (err) {
      coreLog.warn(`[hotkey] register ${norm} failed`, err);
      conflicts.push({ id, scope: "global", reason: "invalid" });
    }
  }

  broadcast("hotkey:conflicts", conflicts);
};

/** 构建要绑定到 portal 的全部快捷键（只含 allowGlobal 动作，固定顺序） */
const buildPortalShortcuts = (): PortalShortcut[] =>
  HOTKEY_ACTIONS.filter((a) => a.allowGlobal).map((a) => ({
    id: a.id,
    description: portalDescriptions[a.id] ?? a.id,
    // 用户配置的 global 绑定由系统设置侧托管，无视之；preferredTrigger 始终取默认值
    preferredTrigger: a.defaultBinding.global
      ? (acceleratorToXdgTrigger(a.defaultBinding.global) ?? undefined)
      : undefined,
  }));

/** 绑定 Portal 快捷键，失败时记录原因 */
const bindPortalShortcuts = async (): Promise<boolean> => {
  const res = await portalModule!.bindShortcuts(buildPortalShortcuts());
  if (!res.ok) {
    coreLog.error(`[portal] 绑定全局快捷键失败: ${res.error ?? "未知错误"}`);
    return false;
  }
  return true;
};

/** 解绑当前 portal 会话并释放绑定（globalEnabled 关闭 / 退出 portal）入串行链 */
const portalUnbindAll = (): Promise<void> =>
  enqueueTransition(async () => {
    // 期间已切回 Electron 时，switchToElectron 已自行解绑，避免重复操作
    if (currentMode !== "portal" || !portalModule) return;
    await portalModule.unbindShortcuts();
  });

/**
 * 通过 portal 绑定全部快捷键（语言切换重绑 / globalEnabled 开启）
 * 入串行链，与模式切换交错时以最新 mode 为准
 */
const portalBindAll = (): Promise<void> =>
  enqueueTransition(async () => {
    if (currentMode !== "portal" || !portalModule) return;
    if (!readConfig().globalEnabled || (await bindPortalShortcuts())) return;
    // 回退操作必须排在当前 transition 之后，避免等待自身造成死锁。
    void switchToElectron();
  });

/** 切换到 Portal 模式并绑定当前配置 */
const switchToPortal = (epoch: number): Promise<void> =>
  enqueueTransition(async () => {
    if (epoch !== portalEpoch) return;

    currentMode = "portal";
    unregisterElectronShortcuts();

    const config = readConfig();
    if (config.globalEnabled && !(await bindPortalShortcuts())) {
      if (epoch !== portalEpoch) {
        void portalModule!.unbindShortcuts();
        return;
      }
      void switchToElectron();
      return;
    }

    portalBound = config.globalEnabled;
    conflicts = [];
    broadcast("hotkey:conflicts", conflicts);
    broadcastMode();
  });

/**
 * 释放 portal 会话并切回 Electron 模式
 * 入串行链执行：旧 portal 会话 close() 完成释放按键后，再注册 Electron 快捷键，
 * 否则同键仍被占用导致注册失败且不会在解绑完成后自动重试
 */
const switchToElectron = (): Promise<void> =>
  enqueueTransition(async () => {
    portalEpoch++;
    currentMode = "electron";
    portalBound = false;
    // 等待解绑完成释放按键后再注册 Electron，避免注册被占用
    if (portalModule) await portalModule.unbindShortcuts();
    registerElectronShortcuts();
    broadcastMode();
  });

/** 广播当前模式快照 */
const broadcastMode = (): void => {
  broadcast("hotkey:mode-change", getGlobalModeSnapshot());
};

/** 加载 portal 模块并探测后端能力；探测通过则切到 portal 模式，否则回退 Electron */
const ensurePortalReady = async (): Promise<void> => {
  const epoch = ++portalEpoch;
  if (!portalModule) {
    portalModule = loadNativeModule<PortalModule>("linux-portal.node", "linux-portal");
    if (!portalModule) {
      coreLog.warn("linux-portal 模块未找到，全局快捷键回退 Electron 实现");
      await switchToElectron();
      return;
    }
    try {
      portalModule.initLogger(nativeLogsDir, isDev);
    } catch (err) {
      coreLog.warn("[portal] 初始化日志失败:", err);
    }
    portalModule.onActivated((_err, id) => {
      broadcast("hotkey:trigger", id);
    });
  }

  if (!portalCapability) {
    portalCapability = await portalModule.detect();
    if (epoch !== portalEpoch) return;
    coreLog.info(
      `portal 后端支持 GlobalShortcuts (v${portalCapability.version})，全局快捷键由系统托管`,
    );
  }

  // supported=false 也会缓存；重绑路径（关闭再开启 portal）会跳过上面的探测块，
  // 这里的判断独立于缓存，确保「不支持」的缓存结果同样直接回退 Electron
  if (!portalCapability.supported) {
    coreLog.warn(
      `portal 后端不支持 GlobalShortcuts: ${portalCapability.error ?? "未知原因"}，回退 Electron 实现`,
    );
    await switchToElectron();
    return;
  }

  // 首次绑定前等待渲染端上报本地化描述，保证系统侧授权弹窗显示完整文案
  await descriptionsReady;
  if (epoch !== portalEpoch) return;

  await switchToPortal(epoch);
};

/** 触发一次 portal 初始化（幂等，进行中则复用） */
const runPortalReady = (): Promise<void> => {
  if (!readyPromise) {
    readyPromise = ensurePortalReady().finally(() => {
      readyPromise = null;
    });
  }
  return readyPromise;
};

/** 按配置切换模式（启动 / portalShortcuts 开关变更时调用） */
export const applyPortalMode = (): void => {
  const usePortal = process.platform === "linux" && readConfig().portalShortcuts;
  if (usePortal) void runPortalReady();
  else void switchToElectron();
};

/** 切换是否用 XDG Desktop Portal 托管全局快捷键（Linux） */
export const setPortalShortcuts = (enabled: boolean): HotkeyConfig => {
  const cur = readConfig();
  if (cur.portalShortcuts === enabled) return cur;
  writeConfig({ ...cur, portalShortcuts: enabled });
  applyPortalMode();
  return readConfig();
};

/** 上报当前语言的快捷键描述（启动与语言切换时由渲染端调用） */
export const setPortalDescriptions = (
  descriptions: Partial<Record<HotkeyActionId, string>>,
): void => {
  portalDescriptions = descriptions;
  // 首次上报解除首绑等待；之后的上报是语言切换，需要重绑更新描述
  if (resolveDescriptionsReady) {
    resolveDescriptionsReady();
    resolveDescriptionsReady = null;
  } else if (currentMode === "portal" && portalModule && portalBound) {
    void portalBindAll();
  }
};

/** 启动初始化 */
export const initGlobalHotkey = (): void => {
  app.on("will-quit", cleanupGlobalHotkey);
  applyPortalMode();
};

/** 退出清理 */
export const cleanupGlobalHotkey = (): void => {
  unregisterElectronShortcuts();
  if (portalModule) void portalModule.shutdown();
};

/** 当前冲突列表 */
export const getConflicts = (): HotkeyConflict[] => [...conflicts];

/** 取完整配置（IPC getAll） */
export const getHotkeyConfig = (): HotkeyConfig => readConfig();

/** 当前模式快照（IPC getGlobalMode） */
export const getGlobalModeSnapshot = (): HotkeyGlobalModeSnapshot => ({
  mode: currentMode,
  portalConfigureSupported: portalCapability?.configureSupported ?? false,
});

/** 等待进行中的 portal 初始化落定（IPC 读取模式快照时先 await，避免读到中间态） */
export const awaitPortalReady = async (): Promise<void> => {
  await readyPromise?.catch(() => {});
};

/** 打开系统侧快捷键设置（portal 模式，需后端支持） */
export const configurePortalShortcuts = async (): Promise<{ ok: boolean; error?: string }> => {
  if (currentMode !== "portal" || !portalModule) {
    return { ok: false, error: "当前未处于 portal 模式" };
  }
  const res = await portalModule.configureShortcuts();
  return { ok: res.ok, error: res.error };
};

/** 写入某动作的绑定 */
export const setBinding = (id: HotkeyActionId, binding: HotkeyBinding): HotkeyConfig => {
  const meta = HOTKEY_ACTIONS.find((m) => m.id === id);
  if (!meta) {
    coreLog.warn(`[hotkey] setBinding: unknown action id ${id}, ignored`);
    return readConfig();
  }
  const config = readConfig();
  const norm = (s: string | null): string | null => (s ? normalizeAccelerator(s) || null : null);
  // 不允许全局的动作强制清空 global 字段，防止 IPC 越权
  const global = meta.allowGlobal ? norm(binding.global) : null;
  config.bindings[id] = { inApp: norm(binding.inApp), global };
  return writeConfig(config);
};

/** 重置：传 id 重置单项；不传重置全部（含 globalEnabled） */
export const resetBindings = (id?: HotkeyActionId): HotkeyConfig => {
  if (id) {
    const config = readConfig();
    config.bindings[id] = { ...defaultHotkeyConfig.bindings[id] };
    return writeConfig(config);
  }
  return writeConfig({
    globalEnabled: defaultHotkeyConfig.globalEnabled,
    portalShortcuts: defaultHotkeyConfig.portalShortcuts,
    bindings: { ...defaultHotkeyConfig.bindings },
  });
};

/** 切换全局总开关 */
export const setGlobalEnabled = (enabled: boolean): HotkeyConfig => {
  const config = readConfig();
  config.globalEnabled = enabled;
  return writeConfig(config);
};

/**
 * 探测某 accelerator 是否能在系统层注册成功
 * 用于录入新 global 时给 UI 实时反馈；portal 模式下由系统托管，无法探测
 */
export const probeAccelerator = (accelerator: string): boolean => {
  if (currentMode === "portal") return false;
  const norm = normalizeAccelerator(accelerator);
  if (!norm) return false;
  const wasRegistered = globalShortcut.isRegistered(norm);
  if (wasRegistered) {
    globalShortcut.unregister(norm);
  }
  let ok = false;
  try {
    ok = globalShortcut.register(norm, () => {});
    if (ok) globalShortcut.unregister(norm);
  } catch {
    ok = false;
  }
  if (wasRegistered) {
    registerElectronShortcuts();
  }
  return ok;
};

/**
 * 绑定变更后的重注册
 * - Electron 模式：整体重注册 globalShortcut
 * - Portal 模式：只在 globalEnabled 翻转时绑定或解绑会话
 *   （避免覆盖用户在系统设置侧的自定义）
 */
const syncRegistration = (): void => {
  if (currentMode !== "portal") {
    registerElectronShortcuts();
    return;
  }
  const config = readConfig();
  if (config.globalEnabled === portalBound) return;
  portalBound = config.globalEnabled;
  if (config.globalEnabled) {
    void portalBindAll();
  } else {
    void portalUnbindAll();
  }
};
