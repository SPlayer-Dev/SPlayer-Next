import { BrowserWindow, nativeImage, type NativeImage } from "electron";
import { loadNativeModule } from "@main/utils/nativeLoader";
import { isWin } from "@main/utils/config";
import { nativeLog } from "@main/utils/logger";
import defaultCoverPath from "../../../public/images/song.jpg?asset";

type ThumbnailNative = typeof import("@splayer/taskbar-thumbnail");

let native: ThumbnailNative | null = null;
let enabled = false;
/** 最近一次封面原始字节，启用时据此回填 */
let lastCover: Buffer | null = null;
/** 默认封面图（无封面时回退），懒加载一次 */
let defaultImg: NativeImage | null = null;

/** 封面缩放目标边长：DWM 缩略图 / Peek 都不大，256 足够且省内存 */
const COVER_SIZE = 256;

/** 懒加载原生模块 */
const load = (): ThumbnailNative | null => {
  if (native) return native;
  native = loadNativeModule<ThumbnailNative>("taskbar-thumbnail.node", "taskbar-thumbnail");
  return native;
};

/** 默认封面图（无歌曲 / 歌曲无封面时使用） */
const getDefaultImg = (): NativeImage => {
  if (!defaultImg) defaultImg = nativeImage.createFromPath(defaultCoverPath);
  return defaultImg;
};

/**
 * 取主窗 HWND 指针（JS number）
 * @param win - 主窗口
 * @returns 指针数值，超出安全整数或失败返回 null
 */
const getHwndPtr = (win: BrowserWindow): number | null => {
  try {
    const big = win.getNativeWindowHandle().readBigUInt64LE(0);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(big);
  } catch {
    return null;
  }
};

/** 解码封面（无则回退默认图）为 BGRA 并下发给原生模块 */
const pushCover = (cover: Buffer | null): void => {
  if (!native) return;
  try {
    const img = cover && cover.length ? nativeImage.createFromBuffer(cover) : getDefaultImg();
    if (img.isEmpty()) return;
    const { width: ow, height: oh } = img.getSize();
    // 等比缩放，长边限制到 COVER_SIZE，避免拉伸变形
    const resized =
      ow >= oh ? img.resize({ width: COVER_SIZE }) : img.resize({ height: COVER_SIZE });
    const { width, height } = resized.getSize();
    // Windows 上 toBitmap 返回 BGRA，正好对应 DWM 的 32bpp DIBSection
    native.setCover(resized.toBitmap(), width, height);
  } catch (error) {
    nativeLog.warn("更新任务栏缩略图封面失败", error);
  }
};

/**
 * 在主窗上启用自定义任务栏缩略图（始终启用，仅 Windows）
 * @param win - 主窗口
 */
export const enableTaskbarThumbnail = (win: BrowserWindow): void => {
  if (!isWin || enabled) return;
  const mod = load();
  if (!mod) return;
  const ptr = getHwndPtr(win);
  if (ptr === null) return;
  enabled = mod.enable(ptr);
  if (enabled) {
    nativeLog.debug("任务栏缩略图自定义已启用");
    // 无歌曲时先显示默认封面，避免空白
    pushCover(lastCover);
  }
};

/**
 * 更新任务栏缩略图封面；无封面时回退默认图
 * @param cover - 原始图片字节（jpeg/png）；空表示当前歌曲无封面
 */
export const setTaskbarThumbnailCover = (cover: Buffer | undefined): void => {
  if (!isWin) return;
  lastCover = cover && cover.length ? cover : null;
  if (enabled) pushCover(lastCover);
};
