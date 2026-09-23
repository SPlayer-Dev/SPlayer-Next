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

/** 可用版本所属的更新通道，避免跨通道复用旧检查结果 */
let availableChannel: UpdateChannel | null = null;

/**
 * 失效代次：通道切换时自增，使进行中的检查与下载的结果立即失效
 * 事件回调只接受代次仍有效的任务，避免用即时配置去推断任务归属
 */
let generation = 0;

/** 进行中检查的身份，在发起时捕获，不随配置变化 */
let checkContext: { channel: UpdateChannel; generation: number } | null = null;

/** 进行中下载的身份，在发起时捕获；非空即表示有任务在跑 */
let downloadContext: { channel: UpdateChannel; generation: number } | null = null;

/** 已下载完成且仍具备安装资格的包所属通道 */
let downloadedChannel: UpdateChannel | null = null;

/** 已生效的更新通道，用于识别配置层发生的通道变化 */
let activeChannel: UpdateChannel | null = null;

/** 是否正在执行显式安装，用于归属安装阶段的失败 */
let installing = false;

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
  autoUpdater.on("checking-for-update", () => {
    if (checkContext?.generation !== generation) return;
    emit({ type: "checking" });
  });
  autoUpdater.on("update-available", (info) => {
    const context = checkContext;
    if (!context || context.generation !== generation) {
      updaterLog.info("忽略已失效代次的检查结果");
      return;
    }
    availableVersion = info.version;
    availableChannel = context.channel;
    emit({
      type: "available",
      meta: toMeta(info),
      manual: manualCheck,
      canInstall: canSelfInstall,
    });
  });
  autoUpdater.on("update-not-available", () => {
    if (checkContext?.generation !== generation) return;
    availableVersion = null;
    availableChannel = null;
    emit({ type: "notAvailable", manual: manualCheck });
  });
  autoUpdater.on("download-progress", (progress) => {
    // 失效任务的进度不再推给界面，避免旧通道的进度覆盖新通道状态
    if (downloadContext?.generation !== generation) return;
    emit({ type: "progress", percent: Math.round(progress.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    const context = downloadContext;
    // 下载期间切换过通道，该安装包不再具备安装资格
    if (!context || context.generation !== generation) {
      updaterLog.info("忽略已失效代次的下载结果");
      return;
    }
    downloadedChannel = context.channel;
    autoUpdater.autoInstallOnAppQuit = true;
    emit({ type: "downloaded", meta: toMeta(info) });
  });
  autoUpdater.on("error", (error) => {
    // 检查与下载的失败各自在任务上下文中反馈；全局事件没有来源信息，
    // 仅记录日志，避免无来源的错误被当前活跃任务错误认领
    updaterLog.error("更新出错", error);
    // 安装阶段没有对应的 Promise，需要单独反馈
    if (installing) {
      installing = false;
      emit({
        type: "error",
        message: error?.message ?? String(error),
        manual: true,
        source: "install",
      });
    }
  });
};

/**
 * 执行更新检查
 * @param manual - 是否由用户手动触发
 */
const runCheck = (manual: boolean): void => {
  if (
    !currentCheck &&
    (downloadContext?.generation === generation || downloadedChannel === getChannel())
  ) {
    return;
  }
  if (currentCheck) {
    pendingCheck = {
      manual: manual || pendingCheck?.manual === true,
    };
    return;
  }
  applyChannel();
  manualCheck = manual;
  checkContext = { channel: getChannel(), generation };
  currentCheck = autoUpdater
    .checkForUpdates()
    .catch((error) => {
      const context = checkContext;
      // 已失效代次的检查失败不再反馈，避免旧通道的失败覆盖当前状态
      if (!context || context.generation !== generation) return;
      updaterLog.error("检查更新失败", error);
      emit({
        type: "error",
        message: error?.message ?? String(error),
        manual: manualCheck,
        source: "check",
      });
    })
    .finally(() => {
      currentCheck = null;
      checkContext = null;
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
  // electron-updater 对已有的下载任务会直接返回原 Promise，因此必须拒绝并发请求，
  // 否则新通道的下载请求会与旧任务共用同一份结果与归属
  if (downloadContext) {
    updaterLog.warn("已有进行中的下载，忽略本次下载请求");
    emit({ type: "downloadRejected", reason: "busy" });
    return;
  }
  // 检查尚未结算时底层可下载目标仍可能被它更新，不能启动下载
  if (currentCheck) {
    updaterLog.warn("检查尚未完成，忽略下载请求");
    emit({ type: "downloadRejected", reason: "checking" });
    return;
  }
  // 结果必须仍属于当前通道，避免切换通道后误下载旧通道的包
  if (!availableVersion || availableChannel !== getChannel()) {
    updaterLog.warn("当前通道没有可下载的更新，忽略下载请求");
    emit({ type: "downloadRejected", reason: "unavailable" });
    return;
  }
  downloadContext = { channel: availableChannel, generation };
  emit({ type: "downloading" });
  const task = downloadContext;
  autoUpdater
    .downloadUpdate()
    .catch((error) => {
      updaterLog.error("下载更新失败", error);
      // 任务已失效（期间切过通道）时不再反馈
      if (task.generation !== generation) return;
      emit({
        type: "error",
        message: error?.message ?? String(error),
        manual: true,
        source: "download",
      });
    })
    .finally(() => {
      downloadContext = null;
    });
};

/**
 * 同步通道变化带来的失效
 * 配置可能经 reset / replaceAll 等批量入口改写而不经过通道切换回调，因此这些入口统一
 * 调用本函数：只要有效通道发生变化，就作废旧结果、失效进行中任务并撤销安装资格
 * @returns 通道是否发生变化
 */
export const syncChannel = (): boolean => {
  const channel = getChannel();
  if (channel === activeChannel) return false;
  activeChannel = channel;
  generation += 1;
  availableVersion = null;
  availableChannel = null;
  downloadedChannel = null;
  autoUpdater.autoInstallOnAppQuit = false;
  emit({ type: "invalidated" });
  applyChannel();
  updaterLog.info(`更新通道已变更为 ${channel}，进行中的检查与下载已失效`);
  // 立即通知界面失效；新通道检查如遇旧检查在途则排队执行
  runCheck(true);
  return true;
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
  syncChannel();
};

/** 退出并安装 */
export const quitAndInstall = (): void => {
  if (!canSelfInstall) return;
  // 显式安装同样受资格约束，避免切换通道后仍安装旧通道的包
  if (downloadedChannel !== getChannel()) {
    updaterLog.warn("已下载的更新不属于当前通道，忽略安装请求");
    return;
  }
  installing = true;
  autoUpdater.quitAndInstall();
};

/** 打开下载页：AppX 引导 Store 更新，其余跳 Releases */
export const openDownloadPage = (): void => {
  // 链接跟随产生结果的通道：nightly 发布在固定 tag 上，无法用版本号拼出链接
  let tag: string | null = null;
  if (availableVersion) {
    tag = availableChannel === "nightly" ? "nightly" : `v${availableVersion}`;
  }
  const releaseUrl = tag ? `${RELEASES_URL}/tag/${encodeURIComponent(tag)}` : RELEASES_URL;
  void shell.openExternal(isAppX ? STORE_UPDATES_URL : releaseUrl);
};

/** 初始化更新器 */
export const initUpdater = (): void => {
  autoUpdater.logger = updaterLog;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  activeChannel = getChannel();
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

/** 清理定时器与内部状态 */
export const disposeUpdater = (): void => {
  if (intervalTimer) clearInterval(intervalTimer);
  intervalTimer = null;
  // 作废在途任务并清空状态，避免销毁后残留的旧任务影响后续流程
  generation += 1;
  currentCheck = null;
  pendingCheck = null;
  manualCheck = false;
  checkContext = null;
  downloadContext = null;
  availableVersion = null;
  availableChannel = null;
  downloadedChannel = null;
  activeChannel = null;
  installing = false;
};
