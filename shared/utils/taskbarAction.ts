/**
 * Windows 任务栏 Jump List 播放控制的命令行契约
 *
 * Jump List 任务项点击后由系统重新拉起应用进程并附带参数，靠单例锁命中原进程、
 * 经 second-instance 把动作投递回运行中的窗口。本文件集中定义参数格式与解析，
 * 供主进程与渲染层（类型）共享，纯函数便于单测。
 */

/** 播放动作参数前缀 */
export const TASKBAR_ACTION_ARG_PREFIX = "--splayer-taskbar-action=";

/** 便携目录参数前缀
 *
 * 便携版由外层自解压壳注入 PORTABLE_EXECUTABLE_DIR。Jump List 直接拉起内层 exe
 * （不走外层壳，避免每次重解压 ~100MB 造成的卡顿），此时内层进程读不到该环境
 * 变量。故把外层目录随参数透传，让新进程重定向到同一 userData，从而命中同一把
 * 单例锁、正确投递动作到原进程。
 */
export const TASKBAR_PORTABLE_DIR_ARG_PREFIX = "--splayer-portable-dir=";

/** 支持的任务栏播放动作，顺序对齐 UI（上一首 / 播放暂停 / 下一首） */
export const TASKBAR_ACTIONS = ["prev", "play", "pause", "next"] as const;

export type TaskbarAction = (typeof TASKBAR_ACTIONS)[number];

/**
 * 从命令行参数提取首个有效的任务栏播放动作
 * @param argv - 进程命令行参数
 * @returns 有效动作；未携带或非法时返回 null
 */
export const extractTaskbarAction = (argv: readonly string[]): TaskbarAction | null => {
  for (const arg of argv) {
    if (!arg.startsWith(TASKBAR_ACTION_ARG_PREFIX)) continue;
    const action = arg.slice(TASKBAR_ACTION_ARG_PREFIX.length);
    if ((TASKBAR_ACTIONS as readonly string[]).includes(action)) return action as TaskbarAction;
  }
  return null;
};

/**
 * 从命令行参数提取便携目录
 * @param argv - 进程命令行参数
 * @returns 便携目录绝对路径；未携带或为空时返回 null
 */
export const extractPortableDir = (argv: readonly string[]): string | null => {
  for (const arg of argv) {
    if (!arg.startsWith(TASKBAR_PORTABLE_DIR_ARG_PREFIX)) continue;
    const dir = arg.slice(TASKBAR_PORTABLE_DIR_ARG_PREFIX.length);
    if (dir) return dir;
  }
  return null;
};
