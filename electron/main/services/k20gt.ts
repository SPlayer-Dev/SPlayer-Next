import { BrowserWindow, ipcMain, session } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { store } from "@main/store";
import { coreLog } from "@main/utils/logger";
import { sendToMain } from "@main/utils/broadcast";
import * as nowPlaying from "@main/services/nowPlaying";
import type { K20GTStatus } from "@shared/types/k20gt";
import type { NowPlayingPositionSync } from "@shared/types/nowPlaying";
import {
  K20GT_VENDOR_ID,
  K20GT_PRODUCT_ID,
  encodeK20GTReport,
  prepareK20GTCaptions,
  selectK20GTCaption,
  type K20GTCaption,
} from "@shared/utils/k20gt";

let worker: BrowserWindow | null = null;
let status: K20GTStatus = { state: "disabled" };
let captions: K20GTCaption[] = [];
let anchor: NowPlayingPositionSync | null = null;
let offsetMs = 0;
let lastCaption: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let unsubscribers: Array<() => void> = [];
let transition = Promise.resolve();
let shuttingDown = false;

/**
 * 更新设置页状态并停止离线设备的定时任务
 * @param next - 最新连接状态
 */
function setStatus(next: K20GTStatus): void {
  status = next;
  if (next.state !== "connected") {
    if (timer) clearInterval(timer);
    timer = null;
    captions = [];
    anchor = null;
    lastCaption = null;
  }
  sendToMain("k20gt:status", next);
  if (next.state === "error") coreLog.warn("K20 GT 设备错误", next.error);
}

/** 根据当前锚点更新显示，仅向设备页面发送变化后的短报文 */
function tick(): void {
  if (!worker || status.state !== "connected" || !anchor) return;
  const caption = selectK20GTCaption(captions, anchor, offsetMs);
  if (caption === lastCaption) return;
  lastCaption = caption;
  worker.webContents.send("k20gt:report", encodeK20GTReport(caption));
}

/**
 * 应用播放锚点，暂停和停止时取消定时计算
 * @param next - 主进程播放锚点
 */
function updateAnchor(next: NowPlayingPositionSync): void {
  if (status.state !== "connected") return;
  anchor = {
    position: next.position,
    playing: next.playing,
    state: next.state,
    speed: next.speed,
    sendTimestamp: next.sendTimestamp,
  };
  if (next.playing && captions.length && !timer) timer = setInterval(tick, 100);
  if ((!next.playing || !captions.length) && timer) {
    clearInterval(timer);
    timer = null;
  }
  tick();
}

/** 从统一播放服务重建当前曲目的分页，避免持有完整歌词副本 */
function refreshCaptions(): void {
  if (status.state !== "connected") return;
  const snap = nowPlaying.snapshot();
  captions = snap.track
    ? prepareK20GTCaptions(snap.lyric, store.get("k20gt.language"), snap.track.duration)
    : [];
  offsetMs = snap.lyricOffsetMs;
  updateAnchor(snap);
}

/** 清屏后销毁设备页面，并解除全部播放订阅 */
async function stopWorker(): Promise<void> {
  const win = worker;
  worker = null;
  for (const off of unsubscribers) off();
  unsubscribers = [];
  setStatus({ state: "disabled" });
  if (!win || win.isDestroyed()) return;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // USB 写入异常时仍需允许退出，销毁页面会释放剩余的系统句柄
    await Promise.race([
      win.webContents.executeJavaScript("window.stopK20GT?.()"),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 1500);
      }),
    ]);
  } catch (error) {
    coreLog.debug("K20 GT 页面释放", error);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (!win.isDestroyed()) win.destroy();
  }
}

/** 创建只负责 WebHID 写入的独立页面，不向隐藏界面广播播放进度 */
async function startWorker(): Promise<void> {
  const deviceSession = session.fromPartition("k20gt-device");
  const pageUrl = process.env.ELECTRON_RENDERER_URL
    ? new URL("windows/k20gt/index.html", `${process.env.ELECTRON_RENDERER_URL}/`).href
    : pathToFileURL(join(__dirname, "../renderer/windows/k20gt/index.html")).href;
  const origin = new URL(pageUrl).origin;
  deviceSession.setPermissionCheckHandler((contents, permission, _origin, details) => {
    return (
      permission === "hid" &&
      contents === worker?.webContents &&
      details.isMainFrame &&
      details.requestingUrl === pageUrl
    );
  });
  deviceSession.setDevicePermissionHandler((details) => {
    return (
      details.deviceType === "hid" &&
      details.origin === (origin === "null" ? "file://" : origin) &&
      worker?.webContents.getURL() === pageUrl &&
      details.device.vendorId === K20GT_VENDOR_ID &&
      details.device.productId === K20GT_PRODUCT_ID
    );
  });
  deviceSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const win = new BrowserWindow({
    title: "K20 GT",
    width: 160,
    height: 100,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      session: deviceSession,
      preload: join(__dirname, "../preload/k20gt.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webgl: false,
      spellcheck: false,
      // 设备页面需要在托盘播放时响应 USB 写入，不运行界面动画或进度定时器
      backgroundThrottling: false,
    },
  });
  worker = win;
  setStatus({ state: "connecting" });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.on("render-process-gone", (_event, details) => {
    if (worker !== win) return;
    for (const off of unsubscribers) off();
    unsubscribers = [];
    worker = null;
    setStatus({ state: "error", error: details.reason });
    win.destroy();
  });
  unsubscribers = [
    nowPlaying.onLyricChange(refreshCaptions),
    nowPlaying.onPositionSync(updateAnchor),
    nowPlaying.onLyricOffsetChange((data) => {
      offsetMs = data.offsetMs;
      tick();
    }),
  ];
  try {
    await win.loadURL(pageUrl);
  } catch (error) {
    if (worker !== win) return;
    await stopWorker();
    setStatus({ state: "error", error: String(error) });
  }
}

/**
 * 串行应用开关和语言配置，避免快速切换残留设备页面
 * @returns 配置应用完成后结束
 */
export function reloadK20GTConfig(): Promise<void> {
  transition = transition
    .then(async () => {
      if (shuttingDown || !store.get("k20gt.enabled")) await stopWorker();
      else if (!worker) await startWorker();
      else refreshCaptions();
    })
    .catch((error) => {
      setStatus({ state: "error", error: String(error) });
    });
  return transition;
}

/**
 * 关闭音箱功能并等待清屏释放
 * @returns 清理结束后完成
 */
export async function shutdownK20GT(): Promise<void> {
  shuttingDown = true;
  await transition;
  await stopWorker();
}

/** 注册音箱设置接口及可信设备页面的状态回调 */
export function registerK20GTIpc(): void {
  ipcMain.handle("k20gt:getStatus", () => status);
  ipcMain.handle("k20gt:reconnect", () => {
    transition = transition
      .then(async () => {
        await stopWorker();
        if (!shuttingDown && store.get("k20gt.enabled")) await startWorker();
      })
      .catch((error) => setStatus({ state: "error", error: String(error) }));
    return transition;
  });
  ipcMain.on("k20gt:worker-status", (event, next: K20GTStatus) => {
    if (event.sender !== worker?.webContents) return;
    setStatus(next);
    if (next.state === "connected") refreshCaptions();
  });
}
