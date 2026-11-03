import { BrowserWindow, nativeImage, type NativeImage } from "electron";
import { join } from "path";
import { loadNativeModule } from "@main/utils/nativeLoader";
import { store } from "@main/store";
import { isWin } from "@main/utils/config";
import { nativeLog } from "@main/utils/logger";

type ThumbnailNative = typeof import("@splayer/taskbar-thumbnail");

let native: ThumbnailNative | null = null;
let enabled = false;
/** 主窗引用，供运行时开关重新启用 */
let mainWin: BrowserWindow | null = null;
/** 最近一次封面 */
let lastCover: Buffer | string | null = null;
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
  if (!defaultImg) {
    defaultImg = nativeImage.createFromPath(
      join(import.meta.dirname, "../../public/images/song.jpg"),
    );
  }
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

/** 解码封面（路径或字节，无则回退默认图）为 BGRA 并下发给原生模块 */
const pushCover = (cover: Buffer | string | null): void => {
  if (!native) return;
  try {
    let img: NativeImage;
    if (typeof cover === "string") img = nativeImage.createFromPath(cover);
    else if (cover && cover.length) img = nativeImage.createFromBuffer(cover);
    else img = getDefaultImg();
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
 * 在主窗上启用自定义任务栏缩略图（仅 Windows，受设置 system.taskbarThumbnailCover 控制）
 * @param win - 主窗口
 */
export const enableTaskbarThumbnail = (win: BrowserWindow): void => {
  if (!isWin) return;
  // 记住主窗，供设置开关运行时重新启用
  mainWin = win;
  if (enabled) return;
  // 设置关闭则不接管任务栏缩略图（保留系统默认的实时窗口预览）
  if (!store.get("system.taskbarThumbnailCover")) return;
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

/** 关闭自定义任务栏缩略图，恢复系统默认的实时窗口预览 */
export const disableTaskbarThumbnail = (): void => {
  if (!isWin || !enabled || !native) return;
  native.disable();
  enabled = false;
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
  lastCover = has ? cover! : null;
  if (enabled) pushCover(lastCover);
};
