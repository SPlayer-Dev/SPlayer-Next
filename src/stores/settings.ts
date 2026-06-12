import type {
  PlayerSettings,
  LyricSettings,
  AppearanceSettings,
  SpringPreset,
} from "@/types/settings";
import {
  DEFAULT_LYRIC_FORMAT_ORDER,
  DEFAULT_LYRIC_SOURCE_ORDER,
  SPRING_PRESETS,
} from "@/types/settings";
import type { SystemConfig, LocaleCode } from "@shared/types/settings";
import { ALL_PLATFORMS } from "@shared/types/platform";
import { defaultSystemConfig } from "@shared/defaults/settings";
import { setByPath } from "@shared/utils/path";

/**
 * 对账有序集合：保留存档中仍有效的项（顺序不变），
 * 末尾补上完整集合里缺失的新项，剔除已失效的项
 * 用于平台/格式偏好——新增平台或格式时无需用户手动重置即可生效
 * @param stored - 存档顺序
 * @param all - 当前完整集合
 * @returns 对账后的顺序
 */
const reconcileOrder = <T>(stored: T[], all: readonly T[]): T[] => {
  const known = stored.filter((item) => all.includes(item));
  const missing = all.filter((item) => !known.includes(item));
  return [...known, ...missing];
};

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
      sidebarPlaylistCover: false,
      showQualitySwitch: false,
      closeAction: "hide",
      rememberCloseChoice: false,
      fontFamily: "",
      showPerformanceMonitor: false,
    });

    /** 播放器 */
    const player = reactive<PlayerSettings>({
      playerBgType: "blur",
      coverLayout: "default",
      autoCenterCover: true,
      followCoverColor: true,
      autoImmersive: true,
      outputDevice: null,
      pauseOnDeviceSwitch: false,
      enableSpectrum: false,
      spectrumBarWidth: 4,
      songLevel: "hq",
    });

    /** 歌词 */
    const lyric = reactive<LyricSettings>({
      lyricSourcePreference: "auto",
      lyricSourceOrder: [...DEFAULT_LYRIC_SOURCE_ORDER],
      lyricFormatOrder: [...DEFAULT_LYRIC_FORMAT_ORDER],
      smartPreferOnline: false,
      adaptiveFontSize: true,
      fontSize: 48,
      fontWeight: 700,
      fontFamily: "",
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
      enableExcludeLyrics: true,
      excludeLyricsUserKeywords: [],
      excludeLyricsUserRegexes: [],
    });

    /** 系统配置 - 传递主进程 */
    const system = reactive<SystemConfig>(structuredClone(defaultSystemConfig));

    /** 桌面歌词窗口是否打开；由主进程广播 */
    const isDesktopLyricOpen = ref(false);

    /** 灵动岛窗口是否打开；由主进程广播 */
    const isDynamicIslandOpen = ref(false);

    /** 任务栏歌词窗口是否打开；由主进程广播 */
    const isTaskbarLyricOpen = ref(false);

    /**
     * 深合并：嵌套对象原地 mutate，叶子值不变就不写
     * 避免浅 Object.assign 替换嵌套引用，导致依赖路径的 watcher 误触
     */
    const deepAssign = (target: Record<string, unknown>, source: Record<string, unknown>): void => {
      for (const key of Object.keys(source)) {
        const next = source[key];
        const cur = target[key];
        if (
          next &&
          typeof next === "object" &&
          !Array.isArray(next) &&
          cur &&
          typeof cur === "object" &&
          !Array.isArray(cur)
        ) {
          deepAssign(cur as Record<string, unknown>, next as Record<string, unknown>);
        } else if (cur !== next) {
          target[key] = next;
        }
      }
    };

    /** 从主进程拉取后端配置 */
    const syncSystem = async (): Promise<void> => {
      try {
        deepAssign(
          system as unknown as Record<string, unknown>,
          (await window.api.config.getAll()) as unknown as Record<string, unknown>,
        );
      } catch {}
    };

    /** IPC 订阅取消回调集合 */
    const unsubscribers: Array<() => void> = [
      // 订阅桌面歌词配置变化：歌词窗口点锁定按钮等场景需要回流到主窗口设置页
      window.api.desktopLyric.onConfigChange((next) => {
        Object.assign(system.desktopLyric, next as object);
      }),
      // 订阅桌面歌词窗口开关状态
      window.api.window.onDesktopLyricVisibilityChange((open) => {
        isDesktopLyricOpen.value = open;
      }),
      // 订阅灵动岛配置变化
      window.api.dynamicIsland.onConfigChange((next) => {
        Object.assign(system.dynamicIsland, next as object);
      }),
      // 订阅灵动岛窗口开关状态
      window.api.window.onDynamicIslandVisibilityChange((open) => {
        isDynamicIslandOpen.value = open;
      }),
      // 订阅任务栏歌词窗口开关状态
      window.api.window.onTaskbarLyricVisibilityChange((open) => {
        isTaskbarLyricOpen.value = open;
      }),
    ];

    onScopeDispose(() => {
      for (const off of unsubscribers) off();
      unsubscribers.length = 0;
    });

    // 拉取窗口初始开关状态
    window.api.window
      .isDesktopLyricOpen()
      .then((open) => {
        isDesktopLyricOpen.value = open;
      })
      .catch(() => {});
    window.api.window
      .isDynamicIslandOpen()
      .then((open) => {
        isDynamicIslandOpen.value = open;
      })
      .catch(() => {});
    window.api.window
      .isTaskbarLyricOpen()
      .then((open) => {
        isTaskbarLyricOpen.value = open;
      })
      .catch(() => {});

    /**
     * 写入后端配置并同步本地
     * 先就地 mutate 叶子保证 UI 即时反馈，IPC 落盘异步执行
     */
    const setSystem = async (keyPath: string, value: unknown): Promise<void> => {
      setByPath(system, keyPath, value);
      window.api.config.set(keyPath, value).catch((err) => {
        console.error("[settings] config.set failed", keyPath, err);
      });
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
      isTaskbarLyricOpen,
      syncSystem,
      setSystem,
      afterLocalChange,
    };
  },
  {
    persist: {
      storage: localStorage,
      omit: ["system"],
      afterHydrate: ({ store }) => {
        const { lyric } = store as unknown as { lyric: LyricSettings };
        lyric.lyricSourceOrder = reconcileOrder(lyric.lyricSourceOrder, ALL_PLATFORMS);
        lyric.lyricFormatOrder = reconcileOrder(lyric.lyricFormatOrder, DEFAULT_LYRIC_FORMAT_ORDER);
      },
    },
  },
);
