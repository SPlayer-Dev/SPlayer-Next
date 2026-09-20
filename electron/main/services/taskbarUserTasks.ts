import { app, nativeTheme } from "electron";
import { join } from "node:path";
import { sendToMain } from "@main/utils/broadcast";
import { t } from "@main/utils/i18n";
import { isWin } from "@main/utils/config";
import { coreLog, thumbarLog } from "@main/utils/logger";
import {
  TASKBAR_ACTION_ARG_PREFIX,
  TASKBAR_PORTABLE_DIR_ARG_PREFIX,
  type TaskbarAction,
} from "@shared/utils/taskbarAction";

/** 冷启动阶段捕获、但渲染层尚未就绪时暂存的动作 */
let pendingActions: TaskbarAction[] = [];
/** 渲染层是否已建立 player:event 订阅 */
let rendererReady = false;
/** 当前是否正在播放，决定中间任务项显示播放还是暂停 */
let isPlaying = false;
/** 是否已挂载主题变化监听 */
let themeListenerBound = false;

/** Jump List 图标目录（public 走 asarUnpack，是真实文件路径，Shell API 可读） */
const TASK_ICON_DIR = join(__dirname, "../../public/icons/taskbar-tasks");

/**
 * 按当前系统主题取任务项图标的绝对路径
 *
 * 深色菜单用白色图标（-dark），浅色菜单用黑色图标（-light），与 hover 工具栏一致。
 * @param name - 动作名（prev / play / pause / next）
 */
const taskIcon = (name: string): string => {
  const suffix = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  return join(TASK_ICON_DIR, `${name}-${suffix}.ico`);
};

/**
 * 生成 Jump List 任务项的启动参数
 *
 * 开发模式下 process.execPath 是 electron.exe，需把应用入口一并回传；
 * 便携版透传外层目录以复用同一 userData 与单例锁。
 * @param action - 播放动作
 */
const taskArguments = (action: TaskbarAction): string => {
  const parts: string[] = [];
  if (process.defaultApp && process.argv[1]) parts.push(`"${process.argv[1]}"`);
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir) parts.push(`"${TASKBAR_PORTABLE_DIR_ARG_PREFIX}${portableDir}"`);
  parts.push(`${TASKBAR_ACTION_ARG_PREFIX}${action}`);
  return parts.join(" ");
};

/**
 * Jump List 应启动的程序
 *
 * 统一用内层 process.execPath。便携版不指向外层自解压壳：外层每次点击都会把
 * ~100MB 运行时重新解压到临时目录再拉起，导致桌面明显卡顿；改用内层 exe 并透传
 * 便携目录后，单例锁仍能命中，second-instance 正常投递动作。
 */
const taskProgram = (): string => process.execPath;

/**
 * 创建 Windows 用户任务
 * @param action - 触发的播放动作
 * @param iconName - 图标名（可与 action 不同，如播放暂停切换）
 * @param title - 显示文案
 */
const userTask = (action: TaskbarAction, iconName: string, title: string): Electron.Task => ({
  program: taskProgram(),
  arguments: taskArguments(action),
  title,
  description: title,
  iconPath: taskIcon(iconName),
  iconIndex: 0,
});

/**
 * 刷新 Windows 任务栏图标右键的用户任务
 *
 * 顺序对齐 UI：上一首 / 播放·暂停（随状态切换）/ 下一首。
 */
export const refreshTaskbarUserTasks = (): void => {
  if (!isWin) return;
  const middle: TaskbarAction = isPlaying ? "pause" : "play";
  const tasks: Electron.Task[] = [
    userTask("prev", "prev", t("prev")),
    userTask(middle, middle, t(middle)),
    userTask("next", "next", t("next")),
  ];
  if (!app.setUserTasks(tasks)) coreLog.warn("注册 Windows 任务栏用户任务失败");
};

/** 初始化 Windows 任务栏图标右键任务 */
export const initTaskbarUserTasks = (): void => {
  if (!isWin) return;
  // 系统主题切换时刷新图标（深色菜单白图标 / 浅色菜单黑图标）
  if (!themeListenerBound) {
    nativeTheme.on("updated", refreshTaskbarUserTasks);
    themeListenerBound = true;
  }
  refreshTaskbarUserTasks();
};

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
 * 捕获任务栏唤起的播放动作
 *
 * 渲染层就绪则实时投递到 player:event，否则暂存待渲染层拉取（冷启动场景）。
 * @param action - 任务栏传入的播放动作
 */
export const captureTaskbarAction = (action: TaskbarAction): void => {
  if (!rendererReady) {
    pendingActions.push(action);
    thumbarLog.info(`任务栏动作已暂存，等待渲染层就绪: ${action}`);
    return;
  }
  thumbarLog.info(`转发任务栏动作到渲染层: ${action}`);
  sendToMain("player:event", { type: action });
};

/**
 * 取走冷启动暂存的任务栏动作，并标记渲染层已就绪
 * @returns 暂存的动作列表（取走即清空）
 */
export const consumePendingTaskbarAction = (): TaskbarAction[] => {
  rendererReady = true;
  const actions = pendingActions;
  pendingActions = [];
  if (actions.length > 0) thumbarLog.info(`渲染层已就绪，消费启动任务栏动作: ${actions.join(", ")}`);
  return actions;
};
