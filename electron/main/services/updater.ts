import electronUpdater, { CancellationToken, type UpdateInfo } from "electron-updater";
import { app, shell } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sendToMain } from "@main/utils/broadcast";
import { store } from "@main/store";
import { isDev, isMac, isPortable, isAppX } from "@main/utils/config";
import { updaterLog } from "@main/utils/logger";
import type { UpdateEvent, UpdateMeta, UpdateMode, UpdateState } from "@shared/types/update";
import { UPDATE_CHANNELS, type UpdateChannel } from "@shared/types/settings";

const { autoUpdater } = electronUpdater;
const RELEASES_URL = "https://github.com/SPlayer-Dev/SPlayer-Next/releases";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** 根据实际安装形式决定能力，解压版和开发环境只允许检查 */
const getMode = (): UpdateMode => {
  if (isAppX) return "store";
  if (!app.isPackaged || isDev || isMac || isPortable) return "external";
  if (process.platform === "win32") return "inApp";
  if (process.platform === "linux") {
    if (process.env.APPIMAGE) return "inApp";
    const identity = join(process.resourcesPath, "package-type");
    if (
      existsSync(identity) &&
      ["deb", "rpm", "pacman"].includes(readFileSync(identity, "utf8").trim())
    ) {
      return "inApp";
    }
  }
  return "external";
};

/** 使用已保存的更新通道，未配置或无效时默认稳定版 */
const getChannel = (): UpdateChannel => {
  const value = store.get("update.channel");
  return UPDATE_CHANNELS.includes(value) ? value : "stable";
};

let state: UpdateState = {
  revision: 0,
  channel: getChannel(),
  phase: "idle",
  mode: getMode(),
  meta: null,
  percent: 0,
  error: null,
};
let generation = 0;
let disposed = false;
let task: {
  kind: "check" | "download";
  generation: number;
  manual: boolean;
  cancel?: CancellationToken;
} | null = null;
let pendingCheck: { manual: boolean } | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;

/** 返回副本，避免 IPC 调用者修改内部状态。 */
export const getUpdateState = (): UpdateState => structuredClone(state);

/**
 * 提交完整快照，递增版本用于丢弃迟到的 IPC 响应
 * @param patch - 本次状态变更
 * @param notification - 需要向用户展示的结果提示
 * @param manual - 是否由用户主动触发
 */
const publish = (
  patch: Partial<UpdateState>,
  notification?: UpdateEvent["notification"],
  manual = false,
): void => {
  state = { ...state, ...patch, revision: state.revision + 1 };
  sendToMain("update:event", {
    state: getUpdateState(),
    notification,
    manual,
  } satisfies UpdateEvent);
};

/** 只在更新器空闲时修改 provider，避免进行中的任务读取另一个通道。 */
const applyChannel = (): void => {
  autoUpdater.channel = state.channel === "stable" ? "latest" : state.channel;
  autoUpdater.allowPrerelease = state.channel !== "stable";
  autoUpdater.allowDowngrade = false;
  autoUpdater.setFeedURL(
    state.channel === "nightly"
      ? { provider: "generic", url: `${RELEASES_URL}/download/nightly` }
      : { provider: "github", owner: "SPlayer-Dev", repo: "SPlayer-Next" },
  );
};

/**
 * 将发布元数据转换为界面快照，不向渲染进程暴露下载器对象
 * @param info - 更新器返回的发布信息
 * @returns 当前检查结果的版本信息和发布页
 */
const toMeta = (info: UpdateInfo): UpdateMeta => {
  const notes = info.releaseNotes;
  const tag = state.channel === "nightly" ? "nightly" : `v${info.version}`;
  return {
    version: info.version,
    releaseNotes:
      typeof notes === "string" ? notes : (notes ?? []).map((item) => item.note ?? "").join("\n\n"),
    releaseDate: info.releaseDate,
    size: Math.max(0, ...info.files.map((file) => file.size ?? 0)),
    releaseUrl: `${RELEASES_URL}/tag/${encodeURIComponent(tag)}`,
  };
};

/**
 * 串行检查，仅保留通道切换后最后一次待执行请求
 * @param manual - 手动检查允许重新获取下载失败的目标，避免 Nightly 覆盖后反复使用旧链接
 */
const runCheck = (manual: boolean): void => {
  if (disposed || state.mode === "store") return;
  if (task) {
    if (task.generation !== generation)
      pendingCheck = { manual: manual || pendingCheck?.manual === true };
    else if (task.kind === "check") task.manual ||= manual;
    return;
  }
  const retryDownload = manual && state.phase === "error" && state.error?.source === "download";
  if ((state.meta && !retryDownload) || state.phase === "installing") return;
  const current = { kind: "check" as const, generation, manual };
  task = current;
  publish({ phase: "checking", meta: null, percent: 0, error: null });
  void (async () => {
    try {
      applyChannel();
      const result = await autoUpdater.checkForUpdates();
      if (disposed || current.generation !== generation) return;
      if (!result) throw new Error("当前安装形式无法检查更新");
      if (result.isUpdateAvailable) {
        publish(
          { phase: "available", meta: toMeta(result.updateInfo) },
          "available",
          current.manual,
        );
      } else {
        publish({ phase: "upToDate", meta: null }, "upToDate", current.manual);
      }
    } catch (error) {
      if (!disposed && current.generation === generation) {
        publish(
          { phase: "error", error: { source: "check", message: String(error) } },
          "error",
          current.manual,
        );
      }
    } finally {
      if (task === current) task = null;
      const pending = pendingCheck;
      pendingCheck = null;
      if (pending && !disposed) runCheck(pending.manual);
      if (disposed && !task) removeListeners();
    }
  })();
};

/**
 * 自动检查遵循设置，重复请求不覆盖正在下载或已就绪的安装包
 * @param manual - 是否绕过自动检查开关并提示检查结果
 * @returns 请求处理后的即时快照，后续进展通过事件推送
 */
export const checkForUpdates = (manual: boolean): UpdateState => {
  if (manual || store.get("update.autoCheck")) runCheck(manual);
  return getUpdateState();
};

/**
 * 只下载当前有效目标，下载期间禁止修改更新器配置
 * @returns 即时快照，下载完成或失败通过事件推送
 */
export const downloadUpdate = (): UpdateState => {
  if (
    disposed ||
    task ||
    state.mode !== "inApp" ||
    !state.meta ||
    !(
      state.phase === "available" ||
      (state.phase === "error" && state.error?.source === "download")
    )
  ) {
    return getUpdateState();
  }
  const current = {
    kind: "download" as const,
    generation,
    manual: true,
    cancel: new CancellationToken(),
  };
  task = current;
  publish({ phase: "downloading", percent: 0, error: null });
  void (async () => {
    try {
      await autoUpdater.downloadUpdate(current.cancel);
      if (!disposed && current.generation === generation) {
        publish({ phase: "downloaded", percent: 100 }, "downloaded", true);
      }
    } catch (error) {
      if (!disposed && current.generation === generation) {
        publish(
          { phase: "error", error: { source: "download", message: String(error) } },
          "error",
          true,
        );
      }
    } finally {
      if (task === current) task = null;
      const pending = pendingCheck;
      pendingCheck = null;
      if (pending && !disposed) runCheck(pending.manual);
      if (disposed && !task) removeListeners();
    }
  })();
  return getUpdateState();
};

/** 配置写入、重置与导入共用此入口，撤销旧包资格并等待旧任务退出 */
export const syncUpdateChannel = (): void => {
  const channel = getChannel();
  if (state.channel === channel) return;
  generation++;
  publish({
    channel,
    phase: task?.kind === "download" ? "cancelling" : "idle",
    meta: null,
    percent: 0,
    error: null,
  });
  pendingCheck = { manual: true };
  task?.cancel?.cancel();
  if (!task) {
    pendingCheck = null;
    runCheck(true);
  }
};

/**
 * 只有当前通道已完成下载的包可以显式安装，失败保留重试资格
 * @returns 启动安装后的即时快照
 */
export const quitAndInstall = (): UpdateState => {
  if (
    disposed ||
    task ||
    state.mode !== "inApp" ||
    !state.meta ||
    !(
      state.phase === "downloaded" ||
      (state.phase === "error" && state.error?.source === "install")
    )
  ) {
    return getUpdateState();
  }
  publish({ phase: "installing", error: null });
  try {
    autoUpdater.quitAndInstall();
  } catch (error) {
    onError(error instanceof Error ? error : new Error(String(error)));
  }
  return getUpdateState();
};

/** 下载链接来自已验证的检查结果，商店版交给商店管理。 */
export const openDownloadPage = (): void => {
  void shell.openExternal(
    state.mode === "store"
      ? "ms-windows-store://updates"
      : (state.meta?.releaseUrl ??
          (state.channel === "nightly" ? `${RELEASES_URL}/tag/nightly` : RELEASES_URL)),
  );
};

/**
 * 只接受当前下载代次的进度，通道切换后丢弃旧任务事件
 * @param progress - 底层更新器的下载进度
 */
const onProgress = (progress: { percent: number }): void => {
  if (!disposed && task?.kind === "download" && task.generation === generation) {
    const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
    if (percent !== state.percent) publish({ percent });
  }
};

/**
 * 检查和下载通过 Promise 处理错误，安装器使用事件回调
 * @param error - 底层更新器报告的错误
 */
const onError = (error: Error): void => {
  updaterLog.error("更新出错", error);
  if (!disposed && state.phase === "installing") {
    publish(
      { phase: "error", error: { source: "install", message: error.message } },
      "error",
      true,
    );
  }
};

/** 初始化更新器；解压版只绕过安装形式检查，所有安装入口仍由 mode 拦截。 */
export const initUpdater = (): void => {
  disposed = false;
  autoUpdater.logger = updaterLog;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.forceDevUpdateConfig = isDev || state.mode === "external";
  removeListeners();
  autoUpdater.on("download-progress", onProgress);
  autoUpdater.on("error", onError);
  if (!isDev && state.mode !== "store")
    intervalTimer = setInterval(() => checkForUpdates(false), CHECK_INTERVAL_MS);
};

/** 退出时取消任务并解绑监听，不让迟到结果重新启动检查。 */
export const disposeUpdater = (): void => {
  disposed = true;
  generation++;
  pendingCheck = null;
  task?.cancel?.cancel();
  if (intervalTimer) clearInterval(intervalTimer);
  intervalTimer = null;
  if (!task) removeListeners();
};

/** 在途任务结算前保留 error 监听，避免 EventEmitter 抛出未处理异常。 */
const removeListeners = (): void => {
  autoUpdater.removeListener("download-progress", onProgress);
  autoUpdater.removeListener("error", onError);
};
