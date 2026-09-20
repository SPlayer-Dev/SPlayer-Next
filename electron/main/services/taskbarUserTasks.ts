import { app } from "electron";
import { sendToMain } from "@main/utils/broadcast";
import { t } from "@main/utils/i18n";
import { isWin } from "@main/utils/config";
import { coreLog } from "@main/utils/logger";
import { TASKBAR_ACTION_ARG_PREFIX, type TaskbarAction } from "@shared/utils/taskbarAction";

let pendingAction: TaskbarAction | null = null;
let rendererReady = false;
let isPlaying = false;

/**
 * 生成 Jump List 任务的启动参数
 * @param action - 用户选择的播放动作
 * @returns 传给应用进程的参数字符串
 */
const taskArguments = (action: TaskbarAction): string => {
  const actionArg = `${TASKBAR_ACTION_ARG_PREFIX}${action}`;
  // 开发版的 process.execPath 是 electron.exe，需把应用入口一并传回。
  return process.defaultApp ? `"${process.argv[1]}" ${actionArg}` : actionArg;
};

/** 创建带当前应用图标的 Windows 用户任务 */
const userTask = (action: TaskbarAction, title: string): Electron.Task => ({
  program: process.execPath,
  arguments: taskArguments(action),
  title,
  description: title,
  iconPath: process.execPath,
  iconIndex: 0,
});

/** 刷新 Windows 任务栏图标右键的用户任务 */
export const refreshTaskbarUserTasks = (): void => {
  if (!isWin) return;
  const tasks: Electron.Task[] = [
    userTask("prev", t("prev")),
    userTask(isPlaying ? "pause" : "play", t(isPlaying ? "pause" : "play")),
    userTask("next", t("next")),
  ];
  if (!app.setUserTasks(tasks)) coreLog.warn("注册 Windows 任务栏用户任务失败");
};

/** 初始化 Windows 任务栏图标右键任务 */
export const initTaskbarUserTasks = (): void => refreshTaskbarUserTasks();

/**
 * 按播放状态刷新中间任务项
 * @param playing - 是否正在播放
 */
export const updateTaskbarUserTasks = (playing: boolean): void => {
  if (isPlaying === playing) return;
  isPlaying = playing;
  refreshTaskbarUserTasks();
};

/**
 * 捕获外部唤起的播放动作，渲染端就绪后再分发
 * @param action - 任务栏传入的播放动作
 */
export const captureTaskbarAction = (action: TaskbarAction): void => {
  if (rendererReady) {
    sendToMain("player:event", { type: action });
    return;
  }
  pendingAction = action;
};

/**
 * 取走冷启动暂存的播放动作，并标记渲染端已就绪
 * @returns 冷启动时捕获的动作
 */
export const consumePendingTaskbarAction = (): TaskbarAction | null => {
  rendererReady = true;
  const action = pendingAction;
  pendingAction = null;
  return action;
};
