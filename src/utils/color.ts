import {
  argbFromHex,
  themeFromSourceColor,
  QuantizerCelebi,
  Score,
  Hct,
  type Theme,
} from "@material/material-color-utilities";
import type { ThemePalette } from "@/types/theme";
import { useSettingsStore } from "@/stores/settings";
import { useThemeStore } from "@/stores/theme";

/** 默认主色 */
export const DEFAULT_PRIMARY = "#6750a4";

/** 将 ARGB 整数转为 HEX 字符串 */
const argbToHex = (argb: number): string => {
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
};

/** 将 HEX 字符串转为 "R G B" 字符串 */
export const hexToRgb = (hex: string): string => {
  return `${parseInt(hex.slice(1, 3), 16)} ${parseInt(hex.slice(3, 5), 16)} ${parseInt(hex.slice(5, 7), 16)}`;
};

/** 根据主色 HEX 和明暗模式生成色板 */
export const generatePalette = (hex: string, isDark: boolean, globalTint = false): ThemePalette => {
  const safeHex = typeof hex === "string" && hex.startsWith("#") ? hex : DEFAULT_PRIMARY;
  const theme: Theme = themeFromSourceColor(argbFromHex(safeHex));
  // 用 secondary palette 生成主色
  const { hue, chroma } = theme.palettes.secondary;
  const toneColor = (tone: number) => {
    const argb = Hct.from(hue, chroma, tone).toInt();
    return `${(argb >> 16) & 0xff} ${(argb >> 8) & 0xff} ${argb & 0xff}`;
  };
  // 主色
  const primary = isDark ? toneColor(90) : toneColor(10);
  const primaryColors = {
    primary,
    primaryContainer: isDark ? toneColor(30) : toneColor(90),
    onPrimary: isDark ? toneColor(10) : toneColor(100),
    onPrimaryContainer: isDark ? toneColor(90) : toneColor(10),
  };
  // 全局着色
  if (globalTint) {
    return {
      ...primaryColors,
      secondary: isDark ? toneColor(80) : toneColor(40),
      secondaryContainer: isDark ? toneColor(30) : toneColor(90),
      surface: isDark ? toneColor(20) : toneColor(94),
      surfaceAlt: isDark ? toneColor(25) : toneColor(86),
      surfacePanel: isDark ? toneColor(16) : toneColor(92),
      surfaceBright: isDark ? toneColor(40) : toneColor(95),
      onSurface: primary,
      onSurfaceVariant: isDark ? toneColor(70) : toneColor(30),
      outline: isDark ? toneColor(40) : toneColor(60),
      outlineVariant: isDark ? toneColor(25) : toneColor(80),
    };
  }
  // 非全局着色
  const base = isDark ? SOLID_PALETTE_DARK : SOLID_PALETTE_LIGHT;
  return { ...base, ...primaryColors };
};

/** 纯色色板 — 浅色（基于 Zinc 色系，带微弱冷色调） */
export const SOLID_PALETTE_LIGHT: ThemePalette = {
  primary: "24 24 27",
  primaryContainer: "228 228 231",
  onPrimary: "255 255 255",
  onPrimaryContainer: "39 39 42",
  secondary: "82 82 91",
  secondaryContainer: "244 244 245",
  surface: "246 246 246",
  surfaceAlt: "244 244 245",
  surfacePanel: "255 255 255",
  surfaceBright: "255 255 255",
  onSurface: "24 24 27",
  onSurfaceVariant: "113 113 122",
  outline: "212 212 216",
  outlineVariant: "228 228 231",
};

/** 纯色色板 — 深色 */
export const SOLID_PALETTE_DARK: ThemePalette = {
  primary: "244 244 245",
  primaryContainer: "63 63 70",
  onPrimary: "24 24 27",
  onPrimaryContainer: "212 212 216",
  secondary: "161 161 170",
  secondaryContainer: "63 63 70",
  surface: "16 16 20",
  surfaceAlt: "39 39 42",
  surfacePanel: "24 24 28",
  surfaceBright: "72 72 78",
  onSurface: "228 228 231",
  onSurfaceVariant: "161 161 170",
  outline: "82 82 91",
  outlineVariant: "46 46 51",
};

/**
 * 从 HTMLImageElement 提取主色并应用
 * 缩放到 50×50 降低计算量，经 QuantizerCelebi 量化 + Score 评分
 * @param img 封面图片元素，无封面传 null
 */
export const extractColorFromImage = (img: HTMLImageElement | null): void => {
  const themeStore = useThemeStore();
  if (!img || !useSettingsStore().player.followCoverColor) {
    themeStore.coverColor = null;
    return;
  }
  themeStore.coverColor = extractColorFromImageElement(img);
};

/**
 * 从图片 URL 提取主色并应用（不依赖 DOM 渲染）
 * 适用于启动时组件还未挂载的场景
 * @param url 封面图片 URL，传 null 清除颜色
 */
export const extractColorFromUrl = (url: string | null): void => {
  const themeStore = useThemeStore();
  if (!url || !useSettingsStore().player.followCoverColor) {
    themeStore.coverColor = null;
    return;
  }
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    themeStore.coverColor = extractColorFromImageElement(img);
  };
  img.onerror = () => {
    themeStore.coverColor = null;
  };
  img.src = url;
};

/**
 * 从 HTMLImageElement 提取主色 HEX，纯计算，不操作 store
 * @returns 主色 HEX 或 null（单调/低彩度时）
 */
const extractColorFromImageElement = (img: HTMLImageElement): string | null => {
  const canvas = document.createElement("canvas");
  canvas.width = 50;
  canvas.height = 50;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, 50, 50);
  const { data } = ctx.getImageData(0, 0, 50, 50);
  // RGBA → ARGB int
  const pixels: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    pixels.push(((data[i + 3] << 24) | (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) >>> 0);
  }
  const quantized = QuantizerCelebi.quantize(pixels, 128);
  const sorted = Array.from(quantized).sort((a, b) => b[1] - a[1]);
  // 单调检测：前 5 色 RGB 分量差值均 < 8 → 灰度图
  const top5 = sorted
    .slice(0, 5)
    .map(([argb]) => [(argb >> 16) & 0xff, (argb >> 8) & 0xff, argb & 0xff]);
  if (top5.every((c) => Math.max(...c) - Math.min(...c) < 8)) return null;
  // Score 评分取最佳色
  const ranked = Score.score(new Map(sorted.slice(0, 50)));
  // 彩度检测：scored 色的 chroma 过低说明实际无有效彩色
  const scoredHct = Hct.fromInt(ranked[0]);
  if (scoredHct.chroma < 6) return null;
  // 经 Material 主题提取 secondary 色相后提亮至 tone 90
  const materialTheme: Theme = themeFromSourceColor(ranked[0]);
  const { hue, chroma } = materialTheme.palettes.secondary;
  // 释放 canvas GPU 资源
  canvas.width = 0;
  canvas.height = 0;
  return argbToHex(Hct.from(hue, chroma, 90).toInt());
};

/**
 * 将色板和封面主色写入 CSS 自定义属性，并切换明暗 class
 */
export const applyThemeToDOM = (
  palette: ThemePalette,
  coverColorHex: string | null,
  isDark: boolean,
): void => {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(palette)) {
    const cssVar = `--s-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
    root.style.setProperty(cssVar, value);
  }
  root.style.setProperty("--s-cover", coverColorHex ? hexToRgb(coverColorHex) : "239 239 239");
  root.classList.toggle("dark", isDark);
};
