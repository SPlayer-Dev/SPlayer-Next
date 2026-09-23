/**
 * 下载任务镜像 store
 *
 * 权威态在主进程；本 store 拉取全量后订阅 onState/onProgress 增量更新，供下载页与侧边栏角标使用。
 * 用 shallowRef 持有任务数组，进度更新只替换对应元素。
 */

import type { DownloadTask, DownloadProgress, DownloadStatus } from "@shared/types/download";
import { initDownloadResolver } from "@/services/download/resolver";

export const useDownloadStore = defineStore("download", () => {
  /** 是否尚未结束 */
  const isActive = (status: DownloadStatus): boolean =>
    status === "queued" || status === "downloading";

  /** 活跃队列：下载中置顶，其余按实际入队顺序 */
  const compareActive = (a: DownloadTask, b: DownloadTask): number => {
    if (a.status !== b.status) return a.status === "downloading" ? -1 : 1;
    return a.createdAt - b.createdAt;
  };

  /** 已结束历史：最新完成的在前 */
  const compareHistory = (a: DownloadTask, b: DownloadTask): number =>
    (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt);

  const activeTasks = shallowRef<DownloadTask[]>([]);
  const historyTasks = shallowRef<DownloadTask[]>([]);
  const initialized = ref(false);
  const unsubscribers: Array<() => void> = [];

  /** 进行中任务数（侧边栏角标） */
  const activeCount = computed(() => activeTasks.value.length);

  /** 替换或插入一条任务 */
  const applyTask = (task: DownloadTask): void => {
    const active = activeTasks.value.filter((item) => item.taskId !== task.taskId);
    const history = historyTasks.value.filter((item) => item.taskId !== task.taskId);
    if (isActive(task.status)) {
      activeTasks.value = [...active, task].sort(compareActive);
      historyTasks.value = history;
      return;
    }
    activeTasks.value = active;
    historyTasks.value = [task, ...history].sort(compareHistory);
  };

  /** 更新进度 */
  const applyProgress = (data: DownloadProgress): void => {
    const idx = activeTasks.value.findIndex((item) => item.taskId === data.taskId);
    if (idx === -1) return;
    const next = activeTasks.value.slice();
    next[idx] = { ...next[idx], received: data.received, total: data.total };
    activeTasks.value = next;
  };

  /** 拉取全量并订阅增量 */
  const init = async (): Promise<void> => {
    if (initialized.value) return;
    initialized.value = true;
    unsubscribers.push(initDownloadResolver());
    const tasks = await window.api.download.list();
    activeTasks.value = tasks.filter((task) => isActive(task.status)).sort(compareActive);
    historyTasks.value = tasks.filter((task) => !isActive(task.status)).sort(compareHistory);
    unsubscribers.push(window.api.download.onState(applyTask));
    unsubscribers.push(window.api.download.onProgress(applyProgress));
  };

  const cancel = (taskId: string): void => void window.api.download.cancel(taskId);

  const remove = (taskId: string): void => {
    activeTasks.value = activeTasks.value.filter((item) => item.taskId !== taskId);
    historyTasks.value = historyTasks.value.filter((item) => item.taskId !== taskId);
    void window.api.download.remove(taskId);
  };

  const clearFinished = (): void => {
    historyTasks.value = [];
    void window.api.download.clearFinished();
  };

  onScopeDispose(() => {
    for (const off of unsubscribers) off();
    unsubscribers.length = 0;
  });

  return { activeTasks, historyTasks, activeCount, init, cancel, remove, clearFinished };
});
