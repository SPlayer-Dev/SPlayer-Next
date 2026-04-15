import type {
  PlayerSettings,
  LyricSettings,
  AppearanceSettings,
  SpringPreset,
} from "@/types/settings";
import { SPRING_PRESETS } from "@/types/settings";
import type { SystemConfig, LocaleCode } from "@shared/types/settings";
import { defaultSystemConfig } from "@shared/defaults/settings";

export const useSettingsStore = defineStore(
  "settings",
  () => {
    /** 界面语言（持久化，由 main.ts 同步到 vue-i18n） */
    const locale = ref<LocaleCode>("zh-CN");

    /** 外观 */
    const appearance = reactive<AppearanceSettings>({
      layoutMode: "default",
      routeTransition: "fade",
      sidebarCollapsed: false,
    });

    /** 播放器 */
    const player = reactive<PlayerSettings>({
      playerBgType: "blur",
      autoCenterCover: true,
      followCoverColor: true,
      outputDevice: null,
    });

    /** 歌词 */
    const lyric = reactive<LyricSettings>({
      lyricMode: "effects",
      adaptiveFontSize: true,
      fontSize: 48,
      fontWeight: 700,
      showTranslation: true,
      showRomanization: true,
      enableWordHighlight: true,
      enableFloatAnimation: false,
      enableEmphasizeEffect: false,
      enableBlur: false,
      hidePassedLines: false,
      springPreset: "default",
      springMass: 0.9,
      springDamping: 15,
      springStiffness: 90,
      alignPosition: 0.35,
      wordFadeWidth: 0.5,
      inactiveAlpha: 0.2,
    });

    /** 系统配置 - 传递主进程 */
    const system = reactive<SystemConfig>(structuredClone(defaultSystemConfig));

    /** 桌面歌词窗口是否打开；由主进程广播 */
    const isDesktopLyricOpen = ref(false);

    /** 灵动岛窗口是否打开；由主进程广播 */
    const isDynamicIslandOpen = ref(false);

    /** 从主进程拉取后端配置 */
    const syncSystem = async (): Promise<void> => {
      try {
        Object.assign(system, await window.api.config.getAll());
      } catch {}
    };

    // 订阅桌面歌词配置变化：歌词窗口点锁定按钮等场景需要回流到主窗口设置页
    window.api.desktopLyric.onConfigChange((next) => {
      Object.assign(system.desktopLyric, next);
    });

    // 订阅桌面歌词窗口开关状态：主窗口播放栏按钮需要显示当前状态
    window.api.window
      .isDesktopLyricOpen()
      .then((open) => {
        isDesktopLyricOpen.value = open;
      })
      .catch(() => {});
    window.api.window.onDesktopLyricVisibilityChange((open) => {
      isDesktopLyricOpen.value = open;
    });

    // 订阅灵动岛配置变化
    window.api.dynamicIsland.onConfigChange((next) => {
      Object.assign(system.dynamicIsland, next);
    });

    // 订阅灵动岛窗口开关状态
    window.api.window
      .isDynamicIslandOpen()
      .then((open) => {
        isDynamicIslandOpen.value = open;
      })
      .catch(() => {});
    window.api.window.onDynamicIslandVisibilityChange((open) => {
      isDynamicIslandOpen.value = open;
    });

    /** 写入后端配置并更新本地 */
    const setSystem = async (keyPath: string, value: unknown): Promise<void> => {
      await window.api.config.set(keyPath, value);
      await syncSystem();
      // 后处理
      if (keyPath === "player.fadeEnabled" || keyPath === "player.fadeDuration") {
        await window.api.player.setFadeDuration(
          system.player.fadeEnabled ? system.player.fadeDuration : 0,
        );
      }
    };

    /** 本地配置写入后处理 */
    const afterLocalChange = (path: string, value: unknown): void => {
      if (path === "lyric.springPreset" && value !== "custom") {
        const params = SPRING_PRESETS[value as Exclude<SpringPreset, "custom">];
        lyric.springMass = params.mass;
        lyric.springDamping = params.damping;
        lyric.springStiffness = params.stiffness;
      }
    };

    return {
      locale,
      appearance,
      player,
      lyric,
      system,
      isDesktopLyricOpen,
      isDynamicIslandOpen,
      syncSystem,
      setSystem,
      afterLocalChange,
    };
  },
  {
    persist: {
      storage: localStorage,
      omit: ["system"],
    },
  },
);
