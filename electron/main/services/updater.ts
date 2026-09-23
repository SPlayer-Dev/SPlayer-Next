import electronUpdater, { type UpdateInfo } from "electron-updater";
import { app, shell } from "electron";
import { sendToMain } from "@main/utils/broadcast";
import { store } from "@main/store";
import { isDev, isMac, isPortable, isAppX } from "@main/utils/config";
import { updaterLog } from "@main/utils/logger";
import type { UpdateEvent, UpdateMeta } from "@shared/types/update";
import type { UpdateChannel } from "@shared/types/settings";

const { autoUpdater } = electronUpdater;

/**
 * 是否支持内置下载安装
 * AppX 由 Store 管理更新，Mac/Portable 无自动安装能力
 */
const canSelfInstall = !isMac && !isPortable && !isAppX;

/** Releases 页 */
const RELEASES_URL = "https://github.com/SPlayer-Dev/SPlayer-Next/releases";

/** 仓库信息，切回 GitHub provider 时使用 */
const GITHUB_REPO = { owner: "SPlayer-Dev", repo: "SPlayer-Next" } as const;

/** nightly 固定滚动 tag 的发布资源地址 */
const NIGHTLY_FEED_URL = `${RELEASES_URL}/download/nightly`;

/** Microsoft Store 更新页 */
const STORE_UPDATES_URL = "ms-windows-store://updates";

/** 定时检查间隔（6 小时） */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** 本次检查是否由用户手动触发 */
let manualCheck = false;

/** 进行中的检查 Promise */
let currentCheck: Promise<unknown> | null = null;

/** 当前检查结束后需要执行的检查 */
let pendingCheck: { manual: boolean } | null = null;

/** 最近一次检测到的可用版本 */
let availableVersion: string | null = null;

let intervalTimer: ReturnType<typeof setInterval> | null = null;

const emit = (event: UpdateEvent): void => sendToMain("update:event", event);

/**
 * 读取当前更新通道
 * @returns 更新通道
 */
const getChannel = (): UpdateChannel => {
  const channel = store.get("update.channel");
  if (channel === "beta" || channel === "alpha" || channel === "nightly") return channel;
  if (app.getVersion().includes("-nightly.")) return "nightly";
  return "stable";
};

/**
 * 将当前通道应用到 electron-updater
 * nightly 发布在固定滚动 tag 上，该 tag 不是合法 semver，GitHub provider 会因此找不到
 * release，故改用 generic provider 直接取清单；其余通道继续使用 GitHub provider
 */
const applyChannel = (): void => {
  const channel = getChannel();
  autoUpdater.channel = channel === "stable" ? "latest" : channel;
  autoUpdater.allowPrerelease = channel !== "stable";
  autoUpdater.allowDowngrade = false;
  autoUpdater.setFeedURL(
    channel === "nightly"
      ? { provider: "generic", url: NIGHTLY_FEED_URL }
      : { provider: "github", ...GITHUB_REPO },
  );
};

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
    availableVersion = info.version;
    emit({
      type: "available",
      meta: toMeta(info),
      manual: manualCheck,
      canInstall: canSelfInstall,
    });
  });
  autoUpdater.on("update-not-available", () => {
    availableVersion = null;
    emit({ type: "notAvailable", manual: manualCheck });
  });
  autoUpdater.on("download-progress", (progress) =>
    emit({ type: "progress", percent: Math.round(progress.percent) }),
  );
  autoUpdater.on("update-downloaded", (info) => emit({ type: "downloaded", meta: toMeta(info) }));
  autoUpdater.on("error", (error) => {
    updaterLog.error("更新出错", error);
    emit({ type: "error", message: error?.message ?? String(error), manual: manualCheck });
  });
};

/**
 * 执行更新检查
 * @param manual - 是否由用户手动触发
 */
const runCheck = (manual: boolean): void => {
  if (currentCheck) {
    pendingCheck = {
      manual: manual || pendingCheck?.manual === true,
    };
    return;
  }
  applyChannel();
  manualCheck = manual;
  currentCheck = autoUpdater
    .checkForUpdates()
    .catch(() => {})
    .finally(() => {
      currentCheck = null;
      const pending = pendingCheck;
      pendingCheck = null;
      if (pending) runCheck(pending.manual);
    });
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

/**
 * 应用更新通道变更并立即重新检查
 * 平滑过渡策略：切换通道不触发版本回退/降级，仅在目标通道有更高版本时提示更新
 * @param previous - 原通道
 * @param channel - 新通道
 */
export const applyChannelChange = (previous: UpdateChannel, channel: UpdateChannel): void => {
  if (previous === channel) return;
  updaterLog.info(`切换更新通道: ${previous} -> ${channel}`);
  runCheck(true);
};

/** 退出并安装 */
export const quitAndInstall = (): void => {
  if (!canSelfInstall) return;
  autoUpdater.quitAndInstall();
};

/** 打开下载页：AppX 引导 Store 更新，其余跳 Releases */
export const openDownloadPage = (): void => {
  // nightly 发布在固定 tag 上，无法用版本号拼出对应的 tag 链接
  const isNightly = getChannel() === "nightly";
  const tag = isNightly ? "nightly" : availableVersion ? `v${availableVersion}` : null;
  const releaseUrl = tag ? `${RELEASES_URL}/tag/${encodeURIComponent(tag)}` : RELEASES_URL;
  void shell.openExternal(isAppX ? STORE_UPDATES_URL : releaseUrl);
};

/** 初始化更新器 */
export const initUpdater = (): void => {
  autoUpdater.logger = updaterLog;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  applyChannel();
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
