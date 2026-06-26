/** RGB 颜色 */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** HSL 颜色 */
export interface HSL {
  h: number;
  s: number;
  l: number;
}

/** RGB → HSL */
export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

/** HSL → RGB */
export function hslToRgb({ h, s, l }: HSL): RGB {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

/** 颜色桶，用于中位切分 */
interface ColorBucket {
  colors: RGB[];
  rMin: number; rMax: number;
  gMin: number; gMax: number;
  bMin: number; bMax: number;
}

/** 创建颜色桶 */
const createBucket = (colors: RGB[]): ColorBucket => {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (const c of colors) {
    if (c.r < rMin) rMin = c.r;
    if (c.r > rMax) rMax = c.r;
    if (c.g < gMin) gMin = c.g;
    if (c.g > gMax) gMax = c.g;
    if (c.b < bMin) bMin = c.b;
    if (c.b > bMax) bMax = c.b;
  }
  return { colors, rMin, rMax, gMin, gMax, bMin, bMax };
};

/** 获取桶的最长轴范围 */
const bucketRange = (b: ColorBucket): number =>
  Math.max(b.rMax - b.rMin, b.gMax - b.gMin, b.bMax - b.bMin);

/** 按最长轴中位数切分桶 */
const splitBucket = (bucket: ColorBucket): [ColorBucket, ColorBucket] => {
  const { colors } = bucket;
  const rRange = bucket.rMax - bucket.rMin;
  const gRange = bucket.gMax - bucket.gMin;
  const bRange = bucket.bMax - bucket.bMin;
  // 按最长轴排序
  if (rRange >= gRange && rRange >= bRange) {
    colors.sort((a, b) => a.r - b.r);
  } else if (gRange >= rRange && gRange >= bRange) {
    colors.sort((a, b) => a.g - b.g);
  } else {
    colors.sort((a, b) => a.b - b.b);
  }
  const mid = Math.floor(colors.length / 2);
  return [createBucket(colors.slice(0, mid)), createBucket(colors.slice(mid))];
};

/** 桶的平均色 */
const bucketAverage = (bucket: ColorBucket): RGB => {
  const len = bucket.colors.length;
  if (len === 0) return { r: 0, g: 0, b: 0 };
  let rSum = 0, gSum = 0, bSum = 0;
  for (const c of bucket.colors) {
    rSum += c.r;
    gSum += c.g;
    bSum += c.b;
  }
  return {
    r: Math.round(rSum / len),
    g: Math.round(gSum / len),
    b: Math.round(bSum / len),
  };
};

/**
 * 中位切分法提取调色板
 * @param imageData - 图像像素数据
 * @param maxColors - 提取颜色数，默认 4
 * @returns 按面积降序排列的颜色数组
 */
export function extractPalette(imageData: ImageData, maxColors = 4): RGB[] {
  const { data, width, height } = imageData;
  const colors: RGB[] = [];
  // 每隔 10 像素采样
  const step = 10;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      // 跳过透明/近黑/近白像素
      if (a < 128) continue;
      if (r + g + b < 30 || r + g + b > 735) continue;
      colors.push({ r, g, b });
    }
  }
  if (colors.length === 0) return [{ r: 128, g: 128, b: 128 }];
  // 中位切分
  const buckets = [createBucket(colors)];
  while (buckets.length < maxColors) {
    // 找范围最大的桶
    let maxIdx = 0;
    let maxRange = 0;
    for (let i = 0; i < buckets.length; i++) {
      const range = bucketRange(buckets[i]);
      if (range > maxRange && buckets[i].colors.length > 1) {
        maxRange = range;
        maxIdx = i;
      }
    }
    if (maxRange === 0) break;
    const [left, right] = splitBucket(buckets[maxIdx]);
    buckets.splice(maxIdx, 1, left, right);
  }
  // 按面积降序排列
  return buckets
    .map((b) => ({ color: bucketAverage(b), count: b.colors.length }))
    .sort((a, b) => b.count - a.count)
    .map((item) => item.color);
}

/** 取主色 */
export function getDominantColor(palette: RGB[]): RGB {
  return palette[0] ?? { r: 128, g: 128, b: 128 };
}

/**
 * 根据背景色亮度生成对比前景色
 * @param bgColor - 背景色
 * @returns 前景色
 */
export function getForegroundColor(bgColor: RGB): RGB {
  const hsl = rgbToHsl(bgColor);
  const targetL = hsl.l > 0.5 ? 0.15 : 0.85;
  const targetS = Math.min(1, hsl.s + 0.1);
  return hslToRgb({ h: hsl.h, s: targetS, l: targetL });
}

/** RGB 转 CSS 颜色字符串 */
export function rgbToCss({ r, g, b }: RGB, alpha = 1): string {
  if (alpha < 1) return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  return `rgb(${r}, ${g}, ${b})`;
}
