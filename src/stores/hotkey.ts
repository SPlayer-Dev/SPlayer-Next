import type {
  HotkeyActionId,
  HotkeyBinding,
  HotkeyBindingsMap,
  HotkeyConfig,
  HotkeyConflict,
  HotkeyGlobalMode,
  HotkeyGlobalModeSnapshot,
} from "@shared/types/hotkey";

/**
 * 快捷键状态
 */
export const useHotkeyStore = defineStore("hotkey", () => {
  const bindings = ref<HotkeyBindingsMap>({} as HotkeyBindingsMap);
  const globalEnabled = ref(true);
  /** Linux 下是否优先用 XDG Desktop Portal 托管全局快捷键 */
  const portalShortcuts = ref(true);
  const conflicts = ref<HotkeyConflict[]>([]);
  /** 全局快捷键实现模式（portal 模式下全局绑定由系统托管，不可在应用内编辑） */
  const mode = ref<HotkeyGlobalMode>("electron");
  /** portal 模式下后端是否支持 ConfigureShortcuts */
  const portalConfigureSupported = ref(false);
  const initialized = ref(false);

  let unsubscribeConflicts: (() => void) | null = null;
  let unsubscribeMode: (() => void) | null = null;

  /** 初始化 */
  const init = async (): Promise<void> => {
    if (initialized.value) return;
    const [cfg, initialConflicts, modeSnapshot] = await Promise.all([
      window.api.hotkey.getAll(),
      window.api.hotkey.getConflicts(),
      window.api.hotkey.getGlobalMode(),
    ]);
    applyConfig(cfg);
    conflicts.value = initialConflicts;
    applyModeSnapshot(modeSnapshot);
    unsubscribeConflicts?.();
    unsubscribeConflicts = window.api.hotkey.onConflicts((list) => {
      conflicts.value = list;
    });
    unsubscribeMode?.();
    unsubscribeMode = window.api.hotkey.onGlobalModeChange(applyModeSnapshot);
    initialized.value = true;
  };

  /** 应用配置 */
  const applyConfig = (cfg: HotkeyConfig): void => {
    bindings.value = cfg.bindings;
    globalEnabled.value = cfg.globalEnabled;
    portalShortcuts.value = cfg.portalShortcuts;
  };

  /** 应用模式快照 */
  const applyModeSnapshot = (snapshot: HotkeyGlobalModeSnapshot): void => {
    mode.value = snapshot.mode;
    portalConfigureSupported.value = snapshot.portalConfigureSupported;
  };

  /** 打开系统侧快捷键设置（portal 模式） */
  const configureShortcuts = async (): Promise<{ ok: boolean; error?: string }> => {
    return window.api.hotkey.configureShortcuts();
  };

  /** 单项更新 */
  const updateBinding = async (id: HotkeyActionId, binding: HotkeyBinding): Promise<void> => {
    applyConfig(await window.api.hotkey.set(id, binding));
  };

  /** 重置 */
  const resetBinding = async (id?: HotkeyActionId): Promise<void> => {
    applyConfig(await window.api.hotkey.reset(id));
  };

  /** 切换全局快捷键总开关 */
  const setGlobalEnabled = async (enabled: boolean): Promise<void> => {
    applyConfig(await window.api.hotkey.setGlobalEnabled(enabled));
  };

  /** 切换使用 XDG Desktop Portal 托管全局快捷键（Linux） */
  const setPortalShortcuts = async (enabled: boolean): Promise<void> => {
    applyConfig(await window.api.hotkey.setPortalShortcuts(enabled));
  };

  /** 探测某 accelerator 在系统层是否可注册 */
  const probe = async (accelerator: string): Promise<boolean> => {
    return window.api.hotkey.probe(accelerator);
  };

  // HMR / store dispose 时清理监听，避免开发期累积
  onScopeDispose(() => {
    unsubscribeConflicts?.();
    unsubscribeConflicts = null;
    unsubscribeMode?.();
    unsubscribeMode = null;
  });

  /** 检测同 inApp scope 内重复占用 */
  const findInAppDuplicate = (
    accelerator: string,
    excludeId?: HotkeyActionId,
  ): HotkeyActionId | null => {
    const ids = Object.keys(bindings.value) as HotkeyActionId[];
    for (const id of ids) {
      if (id === excludeId) continue;
      if (bindings.value[id]?.inApp === accelerator) return id;
    }
    return null;
  };

  /**
   * 检测 global accelerator 与"其他动作"既有绑定的冲突
   * - 与另一动作 global 重复：主进程注册时会被静默跳过
   * - 与另一动作 inApp 重复：应用聚焦时该 inApp 会被 OS 拦截而 shadow，用户会困惑
   * 同动作自身 inApp == 新 global 不算冲突（OS 拦截后只触发一次，无副作用）
   */
  const findGlobalConflict = (
    accelerator: string,
    excludeId?: HotkeyActionId,
  ): { id: HotkeyActionId; scope: "inApp" | "global" } | null => {
    const ids = Object.keys(bindings.value) as HotkeyActionId[];
    for (const id of ids) {
      if (id === excludeId) continue;
      const b = bindings.value[id];
      if (!b) continue;
      if (b.global === accelerator) return { id, scope: "global" };
      if (b.inApp === accelerator) return { id, scope: "inApp" };
    }
    return null;
  };

  return {
    bindings,
    globalEnabled,
    portalShortcuts,
    conflicts,
    mode,
    portalConfigureSupported,
    init,
    updateBinding,
    resetBinding,
    setGlobalEnabled,
    setPortalShortcuts,
    probe,
    configureShortcuts,
    findInAppDuplicate,
    findGlobalConflict,
  };
});
