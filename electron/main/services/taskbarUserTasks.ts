import { app } from "electron";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { sendToMain } from "@main/utils/broadcast";
import { t } from "@main/utils/i18n";
import { isWin } from "@main/utils/config";
import { coreLog, thumbarLog } from "@main/utils/logger";
import { TASKBAR_ACTION_ARG_PREFIX, type TaskbarAction } from "@shared/utils/taskbarAction";

export type TaskbarPlayerEvent = TaskbarAction | "toggleLike";

let pendingEvents: TaskbarPlayerEvent[] = [];
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

/** 获取 Jump List 应启动的程序。便携版必须经外层启动器保留数据目录与单实例锁。 */
const taskProgram = (): string => {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (!portableDir) return process.execPath;
  try {
    const launcher = readdirSync(portableDir).find((name) => name.endsWith("-portable.exe"));
    if (launcher) return join(portableDir, launcher);
  } catch (error) {
    coreLog.warn("读取便携版启动器目录失败", error);
  }
  coreLog.warn("未找到便携版启动器，Jump List 将回退到内部可执行文件");
  return process.execPath;
};

/** 创建带当前应用图标的 Windows 用户任务 */
const userTask = (action: TaskbarAction, title: string): Electron.Task => {
  const program = taskProgram();
  return {
    program,
    arguments: taskArguments(action),
    title,
    description: title,
    iconPath: program,
    iconIndex: 0,
  };
};

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
 * 将任务栏播放事件转发给渲染层；渲染层订阅尚未建立时先暂存。
 * 缩略图工具栏与 Jump List 共用这里，避免启动阶段事件静默丢失。
 */
export const dispatchTaskbarPlayerEvent = (event: TaskbarPlayerEvent): void => {
  if (!rendererReady) {
    pendingEvents.push(event);
    thumbarLog.info(`任务栏事件已暂存，等待渲染层就绪: ${event}`);
    return;
  }
  thumbarLog.info(`转发任务栏事件到渲染层: ${event}`);
  sendToMain("player:event", { type: event });
};

/**
 * 捕获外部唤起的播放动作，渲染端就绪后再分发
 * @param action - 任务栏传入的播放动作
 */
export const captureTaskbarAction = (action: TaskbarAction): void => {
  dispatchTaskbarPlayerEvent(action);
};

/**
 * 取走启动阶段暂存的任务栏事件，并标记渲染端已就绪
 * @returns 冷启动时捕获的事件
 */
export const consumePendingTaskbarAction = (): TaskbarPlayerEvent[] => {
  rendererReady = true;
  const events = pendingEvents;
  pendingEvents = [];
  if (events.length > 0) thumbarLog.info(`渲染层已就绪，消费启动任务栏事件: ${events.join(", ")}`);
  return events;
};
