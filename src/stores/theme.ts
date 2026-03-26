import type { ThemeMode, ThemeSource } from "@/types/theme";
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

export const useThemeStore = defineStore(
  "theme",
  () => {
    /** 主题模式 */
    const mode = ref<ThemeMode>("system");
    /** 颜色来源 */
    const source = ref<ThemeSource>("default");
    /** 自定义主色 HEX */
    const customColor = ref(DEFAULT_PRIMARY);
    /** 全局着色 */
    const globalTint = ref(false);
    /** 封面取色 HEX */
    const coverColor = ref<string | null>(null);

    /** 系统暗色偏好（响应式） */
    const systemDark = usePreferredDark();

    /** 当前是否为暗色 */
    const isDark = computed(() => {
      if (mode.value === "dark") return true;
      if (mode.value === "light") return false;
      return systemDark.value;
    });

    /** 当前使用的主色 HEX */
    const activeColor = computed(() => {
      if (source.value === "cover" && coverColor.value) return coverColor.value;
      if (source.value === "custom") return customColor.value;
      return DEFAULT_PRIMARY;
    });

    /** 应用主题到 DOM */
    const apply = (): void => {
      const useSolid = source.value === "solid" || (source.value === "cover" && !coverColor.value);
      const palette = useSolid
        ? isDark.value
          ? SOLID_PALETTE_DARK
          : SOLID_PALETTE_LIGHT
        : generatePalette(activeColor.value, isDark.value, globalTint.value);
      applyThemeToDOM(palette, coverColor.value, isDark.value);
    };

    /** 循环切换主题模式 */
    const cycleMode = (): void => {
      const idx = MODE_CYCLE.indexOf(mode.value);
      mode.value = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
    };

    /** 设置自定义主色 HEX */
    const setCustomColor = (hex: string): void => {
      customColor.value = hex;
      source.value = "custom";
    };

    /** 从封面图片元素提取主色，更新 --s-cover 供播放器使用 */
    const updateCoverColor = (img: HTMLImageElement | null): void => {
      coverColor.value = img ? extractColorFromImage(img) : null;
    };

    /** 设置颜色来源 */
    const setSource = (newSource: ThemeSource): void => {
      source.value = newSource;
    };

    /** 初始化（启动时调用一次） */
    const init = (): void => {
      if (typeof customColor.value !== "string" || !customColor.value.startsWith("#")) {
        customColor.value = DEFAULT_PRIMARY;
      }
      apply();
      watch([isDark, activeColor, source, coverColor, globalTint], () => apply());
    };

    return {
      mode,
      source,
      customColor,
      globalTint,
      coverColor,
      isDark,
      activeColor,
      cycleMode,
      setCustomColor,
      updateCoverColor,
      setSource,
      init,
    };
  },
  {
    persist: {
      storage: localStorage,
      pick: ["mode", "source", "customColor", "globalTint"],
    },
  },
);
