import { useSettingsStore } from "@/stores/settings";

/**
 * 虚拟 binding：path 不对应任何持久化 store 字段
 * 而是映射到瞬时状态 / 一次性 action（如窗口开关、命令触发）
 * 写入通常只调 IPC / action，真实状态由广播回流驱动 UI
 */
export interface VirtualBinding {
  get: () => unknown;
  set: (value: unknown) => void;
}

/** 虚拟绑定 */
export const virtualBindings: Record<string, VirtualBinding> = {
  /** 桌面歌词窗口 */
  isDesktopLyricOpen: {
    get: () => useSettingsStore().isDesktopLyricOpen,
    set: (v) => {
      const store = useSettingsStore();
      if (v === store.isDesktopLyricOpen) return;
      window.api.window.toggleDesktopLyric().catch(() => {});
    },
  },
  /** 灵动岛窗口 */
  isDynamicIslandOpen: {
    get: () => useSettingsStore().isDynamicIslandOpen,
    set: (v) => {
      const store = useSettingsStore();
      if (v === store.isDynamicIslandOpen) return;
      window.api.window.toggleDynamicIsland().catch(() => {});
    },
  },
};
