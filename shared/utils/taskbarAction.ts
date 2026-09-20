/** Windows 任务栏用户任务传递给应用实例的命令行参数前缀 */
export const TASKBAR_ACTION_ARG_PREFIX = "--splayer-taskbar-action=";

export const TASKBAR_ACTIONS = ["prev", "play", "pause", "next"] as const;

export type TaskbarAction = (typeof TASKBAR_ACTIONS)[number];

/**
 * 从命令行参数提取第一个有效的任务栏播放动作
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
