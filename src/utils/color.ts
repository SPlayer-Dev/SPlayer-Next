import {
  argbFromHex,
  themeFromSourceColor,
  QuantizerCelebi,
  Score,
  Hct,
  type Theme,
} from "@material/material-color-utilities";
import type { ThemePalette } from "@/types/theme";

/** 默认主色 */
export const DEFAULT_PRIMARY = "#6750a4";

/** 将 ARGB 整数转为 "R G B" 字符串，用于 CSS 变量 */
const argbToRgb = (argb: number): string => {
  return `${(argb >> 16) & 0xff} ${(argb >> 8) & 0xff} ${argb & 0xff}`;
};

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

/** 根据主色 HEX 和明暗模式生成 Material Design 3 色板 */
export const generatePalette = (hex: string, isDark: boolean): ThemePalette => {
  const safeHex = typeof hex === "string" && hex.startsWith("#") ? hex : DEFAULT_PRIMARY;
  const theme: Theme = themeFromSourceColor(argbFromHex(safeHex));
  const scheme = isDark ? theme.schemes.dark : theme.schemes.light;

  return {
    primary: argbToRgb(scheme.primary),
    primaryContainer: argbToRgb(scheme.primaryContainer),
    onPrimary: argbToRgb(scheme.onPrimary),
    onPrimaryContainer: argbToRgb(scheme.onPrimaryContainer),
    secondary: argbToRgb(scheme.secondary),
    secondaryContainer: argbToRgb(scheme.secondaryContainer),
    surface: argbToRgb(scheme.surface),
    surfaceAlt: argbToRgb(scheme.surfaceVariant),
    onSurface: argbToRgb(scheme.onSurface),
    onSurfaceVariant: argbToRgb(scheme.onSurfaceVariant),
    outline: argbToRgb(scheme.outline),
    outlineVariant: argbToRgb(scheme.outlineVariant),
    error: argbToRgb(scheme.error),
  };
};

/** 纯色色板 — 浅色 */
export const SOLID_PALETTE_LIGHT: ThemePalette = {
  primary: "38 38 38",
  primaryContainer: "230 230 230",
  onPrimary: "255 255 255",
  onPrimaryContainer: "30 30 30",
  secondary: "82 82 82",
  secondaryContainer: "240 240 240",
  surface: "255 255 255",
  surfaceAlt: "245 245 245",
  onSurface: "23 23 23",
  onSurfaceVariant: "100 100 100",
  outline: "200 200 200",
  outlineVariant: "230 230 230",
  error: "200 50 50",
};

/** 纯色色板 — 深色 */
export const SOLID_PALETTE_DARK: ThemePalette = {
  primary: "230 230 230",
  primaryContainer: "50 50 50",
  onPrimary: "20 20 20",
  onPrimaryContainer: "230 230 230",
  secondary: "160 160 160",
  secondaryContainer: "45 45 45",
  surface: "18 18 18",
  surfaceAlt: "28 28 28",
  onSurface: "230 230 230",
  onSurfaceVariant: "160 160 160",
  outline: "60 60 60",
  outlineVariant: "40 40 40",
  error: "240 80 80",
};

/**
 * 从图片元素提取主色 HEX
 * 缩放到 50×50 降低计算量，经 QuantizerCelebi 量化 + Score 评分
 * @returns 主色 HEX，单调图片返回 null
 */
export const extractColorFromImage = (img: HTMLImageElement): string | null => {
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
  // 单调检测：前 5 色 RGB 分量差值均 < 5 → 灰度图
  const top5 = sorted
    .slice(0, 5)
    .map(([argb]) => [(argb >> 16) & 0xff, (argb >> 8) & 0xff, argb & 0xff]);
  if (top5.every((c) => Math.max(...c) - Math.min(...c) < 5)) return null;
  // Score 评分取最佳色，经 Material 主题提取 secondary 色相后提亮至 tone 90
  const ranked = Score.score(new Map(sorted.slice(0, 50)));
  const theme: Theme = themeFromSourceColor(ranked[0]);
  const { hue, chroma } = theme.palettes.secondary;
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
