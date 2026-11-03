import { nativeImage, nativeTheme, NativeImage } from "electron";
import { join } from "path";

/** 图标根目录 */
const ICONS_DIR = join(import.meta.dirname, "../../public/icons");

/**
 * 加载图标文件
 * @param relativePath - 相对于 public/icons/ 的路径
 * @param size - 可选，resize 尺寸
 * @returns NativeImage 实例
 */
export const loadIcon = (
  relativePath: string,
  size?: { width: number; height: number },
): NativeImage => {
  const image = nativeImage.createFromPath(join(ICONS_DIR, relativePath));
  return size ? image.resize(size) : image;
};

/**
 * 加载主题感知图标（自动根据系统明暗主题选择 -dark / -light 后缀）
 * @param dir - 图标子目录（如 "thumbar"、"tray"）
 * @param name - 图标名称（不含后缀，如 "play"、"prev"）
 * @param size - 可选，resize 尺寸
 * @returns NativeImage 实例
 */
export const loadThemedIcon = (
  dir: string,
  name: string,
  size?: { width: number; height: number },
): NativeImage => {
  const suffix = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  return loadIcon(`${dir}/${name}-${suffix}.png`, size);
};
