import type {
  HotkeyActionId,
  HotkeyBinding,
  HotkeyBindingsMap,
  HotkeyConfig,
  HotkeyConflict,
} from "@shared/types/hotkey";

/**
 * 快捷键状态独立 store
 *
 * 不挂在 useSettingsStore 下；持久化职责完全交给主进程。
 * init() 时拉一次完整配置，所有 setter 都走 IPC 让主进程权威落盘 + 重注册。
 */
export const useHotkeyStore = defineStore("hotkey", () => {
  const bindings = ref<HotkeyBindingsMap>({} as HotkeyBindingsMap);
  const globalEnabled = ref(true);
  const conflicts = ref<HotkeyConflict[]>([]);
  const initialized = ref(false);

  /** 启动时拉取主进程权威数据 + 订阅冲突上报 */
  const init = async (): Promise<void> => {
    if (initialized.value) return;
    const [cfg, initialConflicts] = await Promise.all([
      window.api.hotkey.getAll(),
      window.api.hotkey.getConflicts(),
    ]);
    applyConfig(cfg);
    conflicts.value = initialConflicts;
    window.api.hotkey.onConflicts((list) => {
      conflicts.value = list;
    });
    initialized.value = true;
  };

  const applyConfig = (cfg: HotkeyConfig): void => {
    bindings.value = cfg.bindings;
    globalEnabled.value = cfg.globalEnabled;
  };

  /** 单项更新；返回最新全量 */
  const updateBinding = async (
    id: HotkeyActionId,
    binding: HotkeyBinding,
  ): Promise<void> => {
    applyConfig(await window.api.hotkey.set(id, binding));
  };

  /** 重置：传 id 重置单项；不传重置全部（含 globalEnabled） */
  const resetBinding = async (id?: HotkeyActionId): Promise<void> => {
    applyConfig(await window.api.hotkey.reset(id));
  };

  /** 切换全局总开关 */
  const setGlobalEnabled = async (enabled: boolean): Promise<void> => {
    applyConfig(await window.api.hotkey.setGlobalEnabled(enabled));
  };

  /** 探测某 accelerator 在系统层是否可注册（global 录入用） */
  const probe = async (accelerator: string): Promise<boolean> => {
    return window.api.hotkey.probe(accelerator);
  };

  /** 同 inApp scope 内重复占用检测 */
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

  return {
    bindings,
    globalEnabled,
    conflicts,
    initialized,
    init,
    updateBinding,
    resetBinding,
    setGlobalEnabled,
    probe,
    findInAppDuplicate,
  };
});
