/**
 * 封面调色板提取
 * 参照 WinIsland get_palette_from_image：8x8 采样网格 + brighten 提亮
 */

interface RGB {
  r: number;
  g: number;
  b: number;
}

/** 默认调色板（白色渐变） */
const DEFAULT_PALETTE: string[] = [
  "rgba(255,255,255,0.9)",
  "rgba(255,255,255,0.5)",
  "rgba(255,255,255,0.9)",
];

/** 提亮颜色（参照 WinIsland brighten 函数） */
const brighten = (rgb: RGB, factor: number): string => {
  let r = rgb.r * factor;
  let g = rgb.g * factor;
  let b = rgb.b * factor;
  const brightness = r * 0.299 + g * 0.587 + b * 0.114;
  if (brightness < 80) {
    const boost = 80 - brightness;
    r += boost;
    g += boost;
    b += boost;
  }
  return `rgb(${Math.min(255, r)}, ${Math.min(255, g)}, ${Math.min(255, b)})`;
};

/**
 * 从图片 URL 提取调色板
 * @param src - 图片 URL
 * @returns [primary, secondary, primary] 调色板
 */
export const extractPalette = async (src: string): Promise<string[]> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const size = 8;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(DEFAULT_PALETTE);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let rTotal = 0, gTotal = 0, bTotal = 0, count = 0;
        for (let y = 1; y < size; y++) {
          for (let x = 1; x < size; x++) {
            const idx = (y * size + x) * 4;
            rTotal += data[idx];
            gTotal += data[idx + 1];
            bTotal += data[idx + 2];
            count++;
          }
        }
        if (count === 0) {
          resolve(DEFAULT_PALETTE);
          return;
        }
        const avg: RGB = {
          r: rTotal / count,
          g: gTotal / count,
          b: bTotal / count,
        };
        const primary = brighten(avg, 1.3);
        const secondary = brighten(avg, 1.5);
        resolve([primary, secondary, primary]);
      } catch {
        resolve(DEFAULT_PALETTE);
      }
    };
    img.onerror = () => {
      resolve(DEFAULT_PALETTE);
    };
    img.src = src;
  });
};
