import electronUpdater, { type UpdateInfo } from "electron-updater";
import { shell } from "electron";
import { sendToMain } from "@main/utils/broadcast";
import { store } from "@main/store";
import { isDev, isMac, isPortable } from "@main/utils/config";
import { updaterLog } from "@main/utils/logger";
import type { UpdateEvent, UpdateMeta } from "@shared/types/update";

const { autoUpdater } = electronUpdater;

/** 是否支持内置下载安装 */
const canSelfInstall = !isMac && !isPortable;

/** Releases 页：手动下载与兜底跳转 */
const RELEASES_URL = "https://github.com/SPlayer-Dev/SPlayer-Next/releases/latest";

/** 定时检查间隔（6 小时） */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** 本次检查是否由用户手动触发 */
let manualCheck = false;

/** 是否有检查正在进行 */
let checking = false;

let intervalTimer: ReturnType<typeof setInterval> | null = null;

const emit = (event: UpdateEvent): void => sendToMain("update:event", event);

/**
 * 规范化更新日志格式
 * @param notes 更新日志，可能是字符串或数组
 * @returns 规范化后的更新日志字符串
 */
const normalizeNotes = (notes: UpdateInfo["releaseNotes"]): string => {
  if (!notes) return "";
  if (typeof notes === "string") return notes;
  return notes
    .map((item) => item.note ?? "")
    .filter(Boolean)
    .join("\n\n");
};

/**
 * 将 electron-updater 的 UpdateInfo 转换为 UpdateMeta
 * @param info 更新信息
 * @returns 更新元数据
 */
const toMeta = (info: UpdateInfo): UpdateMeta => ({
  version: info.version,
  releaseNotes: normalizeNotes(info.releaseNotes),
  releaseDate: info.releaseDate,
  size: Math.max(0, ...(info.files ?? []).map((file) => file.size ?? 0)),
});

const bindEvents = (): void => {
  autoUpdater.on("checking-for-update", () => emit({ type: "checking" }));
  autoUpdater.on("update-available", (info) => {
    checking = false;
    emit({
      type: "available",
      meta: toMeta(info),
      manual: manualCheck,
      canInstall: canSelfInstall,
    });
  });
  autoUpdater.on("update-not-available", () => {
    checking = false;
    emit({ type: "notAvailable", manual: manualCheck });
  });
  autoUpdater.on("download-progress", (progress) =>
    emit({ type: "progress", percent: Math.round(progress.percent) }),
  );
  autoUpdater.on("update-downloaded", (info) => emit({ type: "downloaded", meta: toMeta(info) }));
  autoUpdater.on("error", (error) => {
    checking = false;
    updaterLog.error("更新出错", error);
    emit({ type: "error", message: error?.message ?? String(error), manual: manualCheck });
  });
};

/**
 * 执行更新检查
 * @param manual 是否由用户手动触发
 */
const runCheck = (manual: boolean): void => {
  if (checking) {
    if (manual) manualCheck = true;
    return;
  }
  checking = true;
  manualCheck = manual;
  autoUpdater.checkForUpdates().catch();
};

/**
 * 检查更新：自动检查受设置开关约束，手动检查始终执行
 * @param manual 是否由用户手动触发
 */
export const checkForUpdates = (manual: boolean): void => {
  if (!manual && !store.get("update.autoCheck")) return;
  runCheck(manual);
};

/** 下载更新 */
export const downloadUpdate = (): void => {
  if (!canSelfInstall) return;
  autoUpdater.downloadUpdate().catch((error) => {
    updaterLog.error("下载更新失败", error);
    emit({ type: "error", message: error?.message ?? String(error), manual: true });
  });
};

/** 退出并安装 */
export const quitAndInstall = (): void => {
  if (!canSelfInstall) return;
  autoUpdater.quitAndInstall();
};

/** 打开 Releases 下载页 */
export const openDownloadPage = (): void => {
  void shell.openExternal(RELEASES_URL);
};

/** 初始化更新器 */
export const initUpdater = (): void => {
  autoUpdater.logger = updaterLog;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  bindEvents();
  if (isDev) {
    autoUpdater.forceDevUpdateConfig = true;
    updaterLog.info("开发模式，仅支持手动检查更新");
    return;
  }
  // 定时检查
  intervalTimer = setInterval(() => checkForUpdates(false), CHECK_INTERVAL_MS);
};

/** 清理定时器 */
export const disposeUpdater = (): void => {
  if (intervalTimer) clearInterval(intervalTimer);
  intervalTimer = null;
};
