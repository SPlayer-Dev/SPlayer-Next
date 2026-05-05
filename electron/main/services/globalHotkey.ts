/**
 * 全局快捷键服务
 *
 * 职责：
 * - 启动时读 settings.json 的 hotkeys 字段，注册 globalShortcut
 * - 设置变更时 unregisterAll 后整体重注册
 * - globalEnabled = false 时不注册任何全局键
 * - 注册失败/系统占用记入 conflicts 表，broadcast 给渲染端
 * - 触发时不直接执行业务，broadcast `hotkey:trigger` 让渲染端 dispatch
 */

import { app, globalShortcut } from "electron";
import { store } from "@main/store";
import { broadcast } from "@main/utils/broadcast";
import { coreLog } from "@main/utils/logger";
import type {
  HotkeyActionId,
  HotkeyBinding,
  HotkeyConfig,
  HotkeyConflict,
} from "@shared/types/hotkey";
import { defaultHotkeyConfig, HOTKEY_ACTIONS } from "@shared/defaults/hotkeys";
import { normalizeAccelerator } from "@shared/utils/accelerator";

let conflicts: HotkeyConflict[] = [];

/** 取当前完整配置（store 兜底默认） */
const readConfig = (): HotkeyConfig => {
  const stored = store.get("hotkeys") as Partial<HotkeyConfig> | undefined;
  if (!stored || typeof stored !== "object") {
    return { ...defaultHotkeyConfig, bindings: { ...defaultHotkeyConfig.bindings } };
  }
  return {
    globalEnabled: stored.globalEnabled ?? defaultHotkeyConfig.globalEnabled,
    bindings: { ...defaultHotkeyConfig.bindings, ...(stored.bindings ?? {}) },
  };
};

/** 写入完整配置并重注册 */
const writeConfig = (next: HotkeyConfig): HotkeyConfig => {
  store.set("hotkeys", next);
  applyAll();
  return readConfig();
};

/** 卸载所有 globalShortcut + 清空冲突 */
const unregisterAll = (): void => {
  globalShortcut.unregisterAll();
  conflicts = [];
};

/**
 * 注册全部 global accelerators
 * 同 accelerator 重复 / OS 占用 / 解析异常 都计入 conflicts
 * globalEnabled = false 时只 unregisterAll 不注册新的
 */
const applyAll = (): void => {
  unregisterAll();
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

/** 启动初始化 */
export const initGlobalHotkey = (): void => {
  applyAll();
};

/** 退出清理 */
export const cleanupGlobalHotkey = (): void => {
  unregisterAll();
};

/** 当前冲突列表 */
export const getConflicts = (): HotkeyConflict[] => [...conflicts];

/** 取完整配置（IPC getAll） */
export const getHotkeyConfig = (): HotkeyConfig => readConfig();

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
 * 用于录入新 global 时给 UI 实时反馈
 */
export const probeAccelerator = (accelerator: string): boolean => {
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
    applyAll();
  }
  return ok;
};

// 退出前自动清理
app.on("will-quit", () => {
  cleanupGlobalHotkey();
});
