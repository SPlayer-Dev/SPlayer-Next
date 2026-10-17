import type {
  HotkeyActionId,
  HotkeyBinding,
  HotkeyBindingsMap,
  HotkeyConfig,
  HotkeyConflict,
} from "@shared/types/hotkey";
import { normalizeAccelerator } from "@shared/utils/accelerator";

/**
 * 快捷键状态
 */
export const useHotkeyStore = defineStore("hotkey", () => {
  const bindings = ref<HotkeyBindingsMap>({} as HotkeyBindingsMap);
  const globalEnabled = ref(true);
  const conflicts = ref<HotkeyConflict[]>([]);
  const initialized = ref(false);
  const isRecording = ref(false);

  let unsubscribeConflicts: (() => void) | null = null;
  let recordingUpdate: Promise<void> = Promise.resolve();

  /** 初始化 */
  const init = async (): Promise<void> => {
    if (initialized.value) return;
    const [cfg, initialConflicts] = await Promise.all([
      window.api.hotkey.getAll(),
      window.api.hotkey.getConflicts(),
    ]);
    applyConfig(cfg);
    conflicts.value = initialConflicts;
    unsubscribeConflicts?.();
    unsubscribeConflicts = window.api.hotkey.onConflicts((list) => {
      conflicts.value = list;
    });
    initialized.value = true;
  };

  /** 应用配置 */
  const applyConfig = (cfg: HotkeyConfig): void => {
    bindings.value = cfg.bindings;
    globalEnabled.value = cfg.globalEnabled;
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

  /** 同步录入状态；重复请求等待已有 IPC 完成，避免提前开始捕获。 */
  const setRecording = (recording: boolean): Promise<void> => {
    if (isRecording.value === recording) return recordingUpdate;
    isRecording.value = recording;
    recordingUpdate = window.api.hotkey.setRecording(recording);
    return recordingUpdate;
  };

  /** 探测某 accelerator 在系统层是否可注册 */
  const probe = async (accelerator: string): Promise<boolean> => {
    return window.api.hotkey.probe(accelerator);
  };

  // HMR / store dispose 时清理监听，避免开发期累积
  onScopeDispose(() => {
    unsubscribeConflicts?.();
    unsubscribeConflicts = null;
  });

  /** 检测同 inApp scope 内重复占用 */
  const findInAppDuplicate = (
    accelerator: string,
    excludeId?: HotkeyActionId,
  ): HotkeyActionId | null => {
    const ids = Object.keys(bindings.value) as HotkeyActionId[];
    const normalized = normalizeAccelerator(accelerator);
    for (const id of ids) {
      if (id === excludeId) continue;
      if (normalizeAccelerator(bindings.value[id]?.inApp ?? "") === normalized) return id;
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
    const normalized = normalizeAccelerator(accelerator);
    for (const id of ids) {
      if (id === excludeId) continue;
      const b = bindings.value[id];
      if (!b) continue;
      if (normalizeAccelerator(b.global ?? "") === normalized) return { id, scope: "global" };
      if (normalizeAccelerator(b.inApp ?? "") === normalized) return { id, scope: "inApp" };
    }
    return null;
  };

  return {
    bindings,
    globalEnabled,
    isRecording,
    conflicts,
    init,
    updateBinding,
    resetBinding,
    setGlobalEnabled,
    setRecording,
    probe,
    findInAppDuplicate,
    findGlobalConflict,
  };
});
