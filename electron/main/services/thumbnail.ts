import { BrowserWindow, nativeImage, type NativeImage } from "electron";
import { loadNativeModule } from "@main/utils/nativeLoader";
import { store } from "@main/store";
import { isWin } from "@main/utils/config";
import { nativeLog } from "@main/utils/logger";
import defaultCoverPath from "../../../public/images/song.jpg?asset";

type ThumbnailNative = typeof import("@splayer/taskbar-thumbnail");

let native: ThumbnailNative | null = null;
let service: InstanceType<ThumbnailNative["ThumbnailService"]> | null = null;
/** 主窗引用，供运行时开关重新启用 */
let mainWin: BrowserWindow | null = null;
interface PreparedCover {
  variants: Array<{ bgra: Buffer; width: number; height: number }>;
}

/** 最近一次封面；远端原图只保留 256px BGRA，不长期持有原始 Buffer */
let lastCover: PreparedCover | string | null = null;
/** 默认封面图（无封面时回退），懒加载一次 */
let defaultImg: NativeImage | null = null;

/** 封面缩放目标边长：DWM 缩略图 / Peek 都不大，256 足够且省内存 */
const COVER_SIZE = 256;
const COVER_VARIANT_EDGES = [16, 24, 32, 48, 64, 96, 128, 160, 192, COVER_SIZE] as const;

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
 * 取主窗 HWND 原始字节，避免用 JS number 丢失 64 位句柄精度。
 * @param win - 主窗口
 * @returns 原始句柄字节，失败返回 null
 */
const getHwndPtr = (win: BrowserWindow): Buffer | null => {
  try {
    const handle = win.getNativeWindowHandle();
    return handle.length === 8 || handle.length === 4 ? handle : null;
  } catch {
    return null;
  }
};

/** 解码封面（路径或字节，无则回退默认图）为 BGRA 并下发给原生模块 */
const pushCover = (cover: PreparedCover | string | null): void => {
  if (!service) return;
  try {
    if (cover && typeof cover !== "string") {
      service.setCoverVariants(cover.variants);
      return;
    }
    let img: NativeImage;
    if (typeof cover === "string") img = nativeImage.createFromPath(cover);
    else img = getDefaultImg();
    if (img.isEmpty()) return;
    const prepared = prepareNativeImage(img);
    if (prepared) service.setCoverVariants(prepared.variants);
  } catch (error) {
    nativeLog.warn("更新任务栏缩略图封面失败", error);
  }
};

/** 将在线原图压缩成任务栏所需的有界 BGRA 快照 */
const prepareBufferCover = (cover: Buffer): PreparedCover | null => {
  const img = nativeImage.createFromBuffer(cover);
  return prepareNativeImage(img);
};

/** 在 Electron 侧预生成有界 BGRA buckets，Rust/WndProc 只创建和选择 DIB。 */
const prepareNativeImage = (img: NativeImage): PreparedCover | null => {
  if (img.isEmpty()) return null;
  const { width: originalWidth, height: originalHeight } = img.getSize();
  if (originalWidth <= 0 || originalHeight <= 0) return null;
  const variants: PreparedCover["variants"] = [];
  let previousSize = "";
  for (const edge of COVER_VARIANT_EDGES) {
    const resized =
      originalWidth >= originalHeight ? img.resize({ width: edge }) : img.resize({ height: edge });
    const { width, height } = resized.getSize();
    if (width <= 0 || height <= 0 || width > COVER_SIZE || height > COVER_SIZE) continue;
    const sizeKey = `${width}x${height}`;
    if (sizeKey === previousSize) continue;
    const bgra = resized.toBitmap();
    if (bgra.length !== width * height * 4) continue;
    variants.push({ bgra, width, height });
    previousSize = sizeKey;
  }
  return variants.length > 0 ? { variants } : null;
};

/**
 * 在主窗上启用自定义任务栏缩略图（仅 Windows，受设置 system.taskbarThumbnailCover 控制）
 * @param win - 主窗口
 */
export const enableTaskbarThumbnail = (win: BrowserWindow): void => {
  if (!isWin) return;
  if (mainWin && mainWin !== win) disableTaskbarThumbnail();
  // 记住主窗，供设置开关运行时重新启用
  mainWin = win;
  if (service) return;
  // 设置关闭则不接管任务栏缩略图（保留系统默认的实时窗口预览）
  if (!store.get("system.taskbarThumbnailCover")) return;
  const mod = load();
  if (!mod) return;
  const ptr = getHwndPtr(win);
  if (ptr === null) return;
  try {
    service = new mod.ThumbnailService(ptr);
    nativeLog.debug("任务栏缩略图自定义已启用");
    // 无歌曲时先显示默认封面，避免空白
    pushCover(lastCover);
    win.once("closed", () => {
      if (mainWin !== win) return;
      disableTaskbarThumbnail();
      mainWin = null;
    });
  } catch (error) {
    service = null;
    nativeLog.warn("启用任务栏缩略图自定义失败", error);
  }
};

/** 关闭自定义任务栏缩略图，恢复系统默认的实时窗口预览 */
export const disableTaskbarThumbnail = (): void => {
  if (!isWin || !service) return;
  try {
    service.disable();
  } catch (error) {
    nativeLog.warn("关闭任务栏缩略图自定义失败", error);
  }
  service = null;
  nativeLog.debug("任务栏缩略图自定义已关闭");
};

/**
 * 运行时切换是否接管任务栏缩略图（设置开关即时生效）
 * @param on - 目标启用状态
 */
export const setTaskbarThumbnailEnabled = (on: boolean): void => {
  if (!isWin) return;
  if (on) {
    if (mainWin) enableTaskbarThumbnail(mainWin);
  } else {
    disableTaskbarThumbnail();
  }
};

/**
 * 更新任务栏缩略图封面；无封面时回退默认图
 * @param cover - 缩略图磁盘路径（本地，优先）或原始图片字节（在线）；空表示无封面
 */
export const setTaskbarThumbnailCover = (cover: Buffer | string | undefined): void => {
  if (!isWin) return;
  const has = typeof cover === "string" ? cover.length > 0 : !!cover && cover.length > 0;
  lastCover = !has
    ? null
    : typeof cover === "string"
      ? cover
      : (prepareBufferCover(cover!) ?? null);
  if (service) pushCover(lastCover);
};
