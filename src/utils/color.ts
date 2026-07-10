import {
  argbFromHex,
  themeFromSourceColor,
  QuantizerCelebi,
  Hct,
  type Theme,
} from "@material/material-color-utilities";
import type { ThemePalette } from "@/types/theme";
import { useSettingsStore } from "@/stores/settings";
import { useThemeStore } from "@/stores/theme";

/** 默认主色 */
export const DEFAULT_PRIMARY = "#fe7971";
/** 封面取色竞态 token */
let coverColorToken = 0;
/** 封面取样大小 */
const COVER_SAMPLE_SIZE = 64;
/** 封面边缘留白 */
const COVER_EDGE_MARGIN = 3;
/** 封面最小色度 */
const MIN_COVER_CHROMA = 8;

/** 将 ARGB 整数转为 HEX 字符串 */
const argbToHex = (argb: number): string => {
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
};

/** 根据位置给中心主体区域更高权重，降低边框和角落装饰干扰 */
const sampleWeight = (x: number, y: number): number => {
  const center = (COVER_SAMPLE_SIZE - 1) / 2;
  const dx = (x - center) / center;
  const dy = (y - center) / center;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance < 0.34) return 3;
  if (distance < 0.58) return 2;
  return 1;
};

/** 从量化后的候选中选封面代表色 */
const pickRepresentativeCoverColor = (colors: Map<number, number>): number | null => {
  const entries = Array.from(colors);
  if (entries.length === 0) return null;
  const maxCount = Math.max(...entries.map(([, count]) => count));

  let best: number | null = null;
  let bestScore = 0;
  for (const [argb, count] of entries) {
    const hct = Hct.fromInt(argb);
    if (hct.chroma < MIN_COVER_CHROMA) continue;
    if (hct.tone < 10 || hct.tone > 94) continue;

    const populationScore = Math.pow(count / maxCount, 0.72);
    const chromaScore = Math.min(hct.chroma / 52, 1);
    const toneScore = Math.max(0, 1 - Math.abs(hct.tone - 58) / 58);
    const score = populationScore * 0.58 + chromaScore * 0.28 + toneScore * 0.14;
    if (score > bestScore) {
      best = argb;
      bestScore = score;
    }
  }
  return best;
};

/** 把真实代表色约束到适合作为背景基色的范围 */
const toCoverBaseColor = (argb: number): string => {
  const hct = Hct.fromInt(argb);
  const tone = Math.min(72, Math.max(28, hct.tone));
  const chroma = Math.min(64, Math.max(12, hct.chroma));
  return argbToHex(Hct.from(hct.hue, chroma, tone).toInt());
};

/** 从封面代表色派生播放器前景 UI 色 */
const toCoverUiColor = (hex: string): string => {
  const hct = Hct.fromInt(argbFromHex(hex));
  const tone = 88;
  const chroma = Math.min(30, Math.max(14, hct.chroma * 0.48));
  return argbToHex(Hct.from(hct.hue, chroma, tone).toInt());
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
  surfaceAlt: "250 250 251",
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
 * http(s) URL 走主进程取字节构造 blob URL，避免跨域 canvas tainted
 * @param url 封面图片 URL，传 null 清除颜色
 */
export const extractColorFromUrl = (url: string | null): void => {
  const themeStore = useThemeStore();
  const token = ++coverColorToken;
  if (!url || !useSettingsStore().player.followCoverColor) {
    themeStore.coverColor = null;
    return;
  }
  if (/^https?:\/\//i.test(url)) {
    void loadColorFromRemote(url, token);
    return;
  }
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    if (token !== coverColorToken || !useSettingsStore().player.followCoverColor) return;
    themeStore.coverColor = extractColorFromImageElement(img);
  };
  img.onerror = () => {
    if (token !== coverColorToken) return;
    themeStore.coverColor = null;
  };
  img.src = url;
};

/** 跨域封面：主进程拉字节 → blob URL → 同源 canvas 取色 */
const loadColorFromRemote = async (url: string, token: number): Promise<void> => {
  const settings = useSettingsStore();
  const themeStore = useThemeStore();
  try {
    const result = await window.api.system.fetchRemoteBytes(url);
    if (token !== coverColorToken || !settings.player.followCoverColor) return;
    if (!result.success || !result.data) {
      themeStore.coverColor = null;
      return;
    }
    const blob = new Blob([new Uint8Array(result.data)]);
    const blobUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      if (token !== coverColorToken || !settings.player.followCoverColor) {
        URL.revokeObjectURL(blobUrl);
        return;
      }
      themeStore.coverColor = extractColorFromImageElement(img);
      URL.revokeObjectURL(blobUrl);
    };
    img.onerror = () => {
      if (token !== coverColorToken) {
        URL.revokeObjectURL(blobUrl);
        return;
      }
      themeStore.coverColor = null;
      URL.revokeObjectURL(blobUrl);
    };
    img.src = blobUrl;
  } catch {
    if (token !== coverColorToken) return;
    themeStore.coverColor = null;
  }
};

/**
 * 从图片 URL 提取主色
 * @returns 主色 HEX 或 null（图片加载失败 / 单调 / 低彩度）
 */
export const extractColorFromImageUrl = (url: string): Promise<string | null> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(extractColorFromImageElement(img));
    img.onerror = () => resolve(null);
    img.src = url;
  });
};

/**
 * 从 HTMLImageElement 提取主色 HEX，纯计算，不操作 store
 * @returns 主色 HEX 或 null（单调/低彩度时）
 */
const extractColorFromImageElement = (img: HTMLImageElement): string | null => {
  const canvas = document.createElement("canvas");
  canvas.width = COVER_SAMPLE_SIZE;
  canvas.height = COVER_SAMPLE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  // 跨域无 CORS 头会污染 canvas；图片状态异常时 drawImage 也可能抛错
  let data: Uint8ClampedArray;
  try {
    ctx.drawImage(
      img,
      0,
      0,
      img.naturalWidth,
      img.naturalHeight,
      0,
      0,
      COVER_SAMPLE_SIZE,
      COVER_SAMPLE_SIZE,
    );
    data = ctx.getImageData(0, 0, COVER_SAMPLE_SIZE, COVER_SAMPLE_SIZE).data;
  } catch {
    canvas.width = 0;
    canvas.height = 0;
    return null;
  }
  // RGBA → ARGB int
  const pixels: number[] = [];
  for (let y = COVER_EDGE_MARGIN; y < COVER_SAMPLE_SIZE - COVER_EDGE_MARGIN; y++) {
    for (let x = COVER_EDGE_MARGIN; x < COVER_SAMPLE_SIZE - COVER_EDGE_MARGIN; x++) {
      const i = (y * COVER_SAMPLE_SIZE + x) * 4;
      if (data[i + 3] < 16) continue;
      const argb = ((data[i + 3] << 24) | (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) >>> 0;
      const weight = sampleWeight(x, y);
      for (let j = 0; j < weight; j++) pixels.push(argb);
    }
  }
  if (pixels.length === 0) return null;
  const quantized = QuantizerCelebi.quantize(pixels, 128);
  const sorted = Array.from(quantized).sort((a, b) => b[1] - a[1]);
  // 单调检测：前 5 色 RGB 分量差值均 < 8 → 灰度图
  const top5 = sorted
    .slice(0, 5)
    .map(([argb]) => [(argb >> 16) & 0xff, (argb >> 8) & 0xff, argb & 0xff]);
  if (top5.every((c) => Math.max(...c) - Math.min(...c) < 8)) return null;
  const picked = pickRepresentativeCoverColor(new Map(sorted.slice(0, 50)));
  if (!picked) return null;
  // 释放 canvas GPU 资源
  canvas.width = 0;
  canvas.height = 0;
  return toCoverBaseColor(picked);
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
  root.style.setProperty(
    "--s-cover",
    coverColorHex ? hexToRgb(toCoverUiColor(coverColorHex)) : "239 239 239",
  );
  root.style.setProperty("--s-cover-base", coverColorHex ? hexToRgb(coverColorHex) : "20 20 28");
  root.classList.toggle("dark", isDark);
};
