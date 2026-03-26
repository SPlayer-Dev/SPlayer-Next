import type { AppearanceSettings, PlayerSettings } from "@/types/settings";
import type { ThemeMode } from "@/types/theme";
import type { SystemConfig } from "@shared/types/settings";
import { defaultSystemConfig } from "@shared/defaults/settings";
import {
  generatePalette,
  applyThemeToDOM,
  extractColorFromImage,
  DEFAULT_PRIMARY,
  SOLID_PALETTE_LIGHT,
  SOLID_PALETTE_DARK,
} from "@/utils/color";

/** 主题模式循环顺序 */
const MODE_CYCLE: ThemeMode[] = ["light", "dark", "system"];

export const useSettingsStore = defineStore(
  "settings",
  () => {
    /** 外观设置（持久化） */
    const appearance = reactive<AppearanceSettings>({
      themeMode: "system",
      themeSource: "default",
      customColor: DEFAULT_PRIMARY,
      globalTint: false,
    });

    /** 播放器设置（持久化） */
    const player = reactive<PlayerSettings>({
      playerBgType: "blur",
    });

    /** 后端配置（不持久化，从主进程同步） */
    const system = reactive<SystemConfig>(structuredClone(defaultSystemConfig));

    /** 封面取色 HEX（运行时状态，不持久化） */
    const coverColor = ref<string | null>(null);

    /** 系统暗色偏好 */
    const systemDark = usePreferredDark();

    /** 当前是否为暗色 */
    const isDark = computed(() => {
      if (appearance.themeMode === "dark") return true;
      if (appearance.themeMode === "light") return false;
      return systemDark.value;
    });

    /** 当前使用的主色 HEX */
    const activeColor = computed(() => {
      if (appearance.themeSource === "cover" && coverColor.value) return coverColor.value;
      if (appearance.themeSource === "custom") return appearance.customColor;
      return DEFAULT_PRIMARY;
    });

    /** 应用主题到 DOM */
    const applyTheme = (): void => {
      const useSolid =
        appearance.themeSource === "solid" ||
        (appearance.themeSource === "cover" && !coverColor.value);
      const palette = useSolid
        ? isDark.value
          ? SOLID_PALETTE_DARK
          : SOLID_PALETTE_LIGHT
        : generatePalette(activeColor.value, isDark.value, appearance.globalTint);
      applyThemeToDOM(palette, coverColor.value, isDark.value);
    };

    /** 循环切换主题模式 */
    const cycleMode = (): void => {
      const idx = MODE_CYCLE.indexOf(appearance.themeMode);
      appearance.themeMode = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
    };

    /** 设置自定义主色 */
    const setCustomColor = (hex: string): void => {
      appearance.customColor = hex;
      appearance.themeSource = "custom";
    };

    /** 从封面图片提取主色 */
    const updateCoverColor = (img: HTMLImageElement | null): void => {
      coverColor.value = img ? extractColorFromImage(img) : null;
    };

    /** 初始化主题（启动时调用一次） */
    let themeInitialized = false;
    const initTheme = (): void => {
      if (themeInitialized) return;
      themeInitialized = true;
      if (typeof appearance.customColor !== "string" || !appearance.customColor.startsWith("#")) {
        appearance.customColor = DEFAULT_PRIMARY;
      }
      applyTheme();
      watchThrottled(
        [isDark, activeColor, () => appearance.themeSource, coverColor, () => appearance.globalTint],
        () => applyTheme(),
        { throttle: 100 },
      );
    };

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
      appearance,
      player,
      system,
      coverColor,
      isDark,
      activeColor,
      cycleMode,
      setCustomColor,
      updateCoverColor,
      initTheme,
      syncSystem,
      setSystem,
    };
  },
  {
    persist: {
      storage: localStorage,
      omit: ["system", "coverColor", "isDark", "activeColor"],
    },
  },
);
