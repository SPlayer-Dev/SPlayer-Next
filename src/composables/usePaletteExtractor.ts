import type { RGB } from "@/utils/palette";
import { extractPalette, getDominantColor, getForegroundColor } from "@/utils/palette";

/**
 * 封面调色板提取 composable
 * 从封面图提取多色调色板，缓存机制避免重复提取
 */
export function usePaletteExtractor() {
  const dominant = shallowRef<RGB>({ r: 128, g: 128, b: 128 });
  const palette = shallowRef<RGB[]>([{ r: 128, g: 128, b: 128 }]);
  const foreground = shallowRef<RGB>({ r: 255, g: 255, b: 255 });

  /** 上次提取的封面 URL */
  let lastUrl = "";
  /** 采样用 Canvas */
  const sampleCanvas = document.createElement("canvas");
  const sampleCtx = sampleCanvas.getContext("2d")!;
  // 采样尺寸：64x64 足够提取主色
  sampleCanvas.width = 64;
  sampleCanvas.height = 64;

  /**
   * 从封面 URL 提取调色板
   * @param url - 封面图 URL（cover:// 协议或远程 URL）
   */
  const extract = (url: string): void => {
    if (!url || url === lastUrl) return;
    lastUrl = url;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;

    img.onload = () => {
      try {
        sampleCtx.drawImage(img, 0, 0, 64, 64);
        const imageData = sampleCtx.getImageData(0, 0, 64, 64);
        const colors = extractPalette(imageData, 4);
        palette.value = colors;
        dominant.value = getDominantColor(colors);
        foreground.value = getForegroundColor(dominant.value);
      } catch {
        // 跨域图片无法读取像素，使用默认色
        palette.value = [{ r: 128, g: 128, b: 128 }];
        dominant.value = { r: 128, g: 128, b: 128 };
        foreground.value = { r: 255, g: 255, b: 255 };
      }
    };

    img.onerror = () => {
      lastUrl = "";
    };
  };

  /** 重置为默认色 */
  const reset = (): void => {
    lastUrl = "";
    dominant.value = { r: 128, g: 128, b: 128 };
    palette.value = [{ r: 128, g: 128, b: 128 }];
    foreground.value = { r: 255, g: 255, b: 255 };
  };

  return { dominant, palette, foreground, extract, reset };
}
