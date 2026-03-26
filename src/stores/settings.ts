import type { PlayerSettings } from "@/types/settings";
import type { SystemConfig } from "@shared/types/settings";
import { defaultSystemConfig } from "@shared/defaults/settings";

export const useSettingsStore = defineStore(
  "settings",
  () => {
    /** 播放器设置（持久化） */
    const player = reactive<PlayerSettings>({
      playerBgType: "blur",
    });

    /** 后端配置（不持久化，从主进程同步） */
    const system = reactive<SystemConfig>(structuredClone(defaultSystemConfig));

    /** 从主进程拉取后端配置 */
    const syncSystem = async (): Promise<void> => {
      try {
        Object.assign(system, await window.api.config.getAll());
      } catch {}
    };

    /** 写入后端配置并更新本地 */
    const setSystem = async (keyPath: string, value: unknown): Promise<void> => {
      await window.api.config.set(keyPath, value);
      await syncSystem();
    };

    return {
      player,
      system,
      syncSystem,
      setSystem,
    };
  },
  {
    persist: {
      storage: localStorage,
      omit: ["system"],
    },
  },
);
