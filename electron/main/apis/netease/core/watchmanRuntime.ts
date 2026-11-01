interface WatchmanRuntime {
  /**
   * 恢复任务，只有初始化阶段的周期回调需要跨任务复用
   * @param retainIntervals - 是否保留本次初始化产生的周期回调
   */
  start: (retainIntervals?: boolean) => void;
  stop: () => void;
  dispose: () => void;
}

/**
 * 在专用隔离环境中管理 SDK 捕获的定时器与请求，不改动应用环境
 * @returns 可恢复的任务环境，释放时移除旧实例持有的回调
 */
export const installWatchmanRuntime = (): WatchmanRuntime => {
  const host = window as Window &
    typeof globalThis & { __splayerWatchmanRuntime?: WatchmanRuntime };
  if (host.__splayerWatchmanRuntime) return host.__splayerWatchmanRuntime;

  const timeout = host.setTimeout.bind(host) as (callback: () => void, delay: number) => number;
  const interval = host.setInterval.bind(host) as (callback: () => void, delay: number) => number;
  const clear = host.clearTimeout.bind(host);
  const NativeRequest = host.XMLHttpRequest;
  /** SDK 的调试对象可能携带整个初始化环境，日志只向原生缓冲区传递文本 */
  host.console = new Proxy(host.console, {
    get: (target, key) => {
      const value = Reflect.get(target, key);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) =>
        Reflect.apply(
          value,
          target,
          args.map((arg) =>
            arg instanceof Error
              ? arg.stack || arg.message
              : arg !== null && (typeof arg === "object" || typeof arg === "function")
                ? Object.prototype.toString.call(arg)
                : arg,
          ),
        );
    },
  });
  const timers = new Map<
    number,
    { callback: () => void; delay: number; repeat: boolean; persistent: boolean; handle?: number }
  >();
  const requests = new Set<XMLHttpRequest>();
  let running = false;
  let retaining = false;
  let cycle = 0;
  let nextId = 0;

  /**
   * 每次恢复任务时重新绑定周期，已取消周期的回调不能进入新任务
   * @param id - SDK 使用的逻辑定时器标识
   */
  const arm = (id: number): void => {
    const task = timers.get(id)!;
    const taskCycle = cycle;
    const callback = (): void => {
      if (!running || taskCycle !== cycle || timers.get(id) !== task) return;
      if (!task.repeat) timers.delete(id);
      task.callback();
    };
    task.handle = task.repeat ? interval(callback, task.delay) : timeout(callback, task.delay);
  };

  /**
   * 暂停期间拒绝迟到任务，周期回调只在当前凭据操作期间执行
   * @param handler - SDK 回调
   * @param delay - 延迟毫秒数
   * @param repeat - 是否为周期任务
   * @param args - 回调参数
   * @returns SDK 使用的逻辑定时器标识
   */
  const schedule = (
    handler: TimerHandler,
    delay: number = 0,
    repeat: boolean,
    args: unknown[],
  ): number => {
    if (!running) return 0;
    const id = ++nextId;
    timers.set(id, {
      callback: typeof handler === "function" ? () => handler(...args) : () => host.eval(handler),
      delay,
      repeat,
      persistent: repeat && retaining,
    });
    arm(id);
    return id;
  };
  /**
   * 同时撤销原生调度和保留回调，避免清理后被下一次任务恢复
   * @param id - SDK 使用的逻辑定时器标识
   */
  const cancelTimer = (id?: number): void => {
    if (id === undefined) return;
    const task = timers.get(id);
    if (task?.handle !== undefined) clear(task.handle);
    timers.delete(id);
  };

  host.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
    schedule(handler, delay, false, args)) as typeof host.setTimeout;
  host.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
    schedule(handler, delay, true, args)) as typeof host.setInterval;
  host.clearTimeout = cancelTimer as typeof host.clearTimeout;
  host.clearInterval = cancelTimer as typeof host.clearInterval;
  host.XMLHttpRequest = class extends NativeRequest {
    private readonly taskCycle = cycle;

    /**
     * 旧任务构造的请求不能在新任务恢复时继续发送
     * @param body - SDK 提交的请求体
     */
    override send = (body?: Document | XMLHttpRequestBodyInit | null): void => {
      if (!running || this.taskCycle !== cycle) throw new Error("凭据任务已结束");
      requests.add(this);
      this.addEventListener("loadend", () => requests.delete(this), { once: true });
      try {
        super.send(body);
      } catch (error) {
        requests.delete(this);
        throw error;
      }
    };
  };

  const runtime: WatchmanRuntime = {
    start: (retainIntervals = false) => {
      retaining = retainIntervals;
      if (running) return;
      running = true;
      cycle++;
      for (const id of timers.keys()) arm(id);
    },
    /** 暂停原生调度，只保留初始化阶段的周期描述供后续请求复用 */
    stop: () => {
      running = false;
      for (const [id, task] of timers) {
        if (task.handle !== undefined) clear(task.handle);
        task.handle = undefined;
        if (!task.persistent) timers.delete(id);
      }
      /** 先撤销回调再中止请求，避免取消事件重新触发 SDK 的重试 */
      for (const request of requests) {
        request.onreadystatechange = null;
        request.onload = null;
        request.onerror = null;
        request.onabort = null;
        request.ontimeout = null;
        request.onprogress = null;
        request.onloadstart = null;
        request.onloadend = null;
        request.abort();
      }
      requests.clear();
    },
    /** 清除保留周期的回调引用，旧实例不再被调度器持有 */
    dispose: () => {
      runtime.stop();
      timers.clear();
    },
  };
  host.__splayerWatchmanRuntime = runtime;
  return runtime;
};
