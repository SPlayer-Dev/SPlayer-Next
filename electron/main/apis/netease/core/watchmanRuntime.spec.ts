import { createContext, runInContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installWatchmanRuntime } from "./watchmanRuntime";

describe("凭据隔离环境的任务生命周期", () => {
  const abort = vi.fn();
  const log = vi.fn();
  let execute: (code: string) => unknown;

  beforeEach(() => {
    vi.useFakeTimers();
    abort.mockClear();
    log.mockClear();
    const Request = class extends EventTarget {
      onerror: (() => void) | null = null;
      abort = (): void => {
        abort();
        this.onerror?.();
        this.dispatchEvent(new Event("loadend"));
      };
    };
    Object.assign(Request.prototype, { send: () => undefined });
    const context = createContext({
      console: { log },
      setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
      setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
      XMLHttpRequest: Request,
      Event,
    });
    execute = (code) => runInContext(code, context);
    execute(`window = globalThis; runtime = (${installWatchmanRuntime.toString()})()`);
  });

  it("调试缓冲区不会通过日志对象持有旧 SDK 环境", () => {
    execute('console.log("SDK", { callback: () => {} }, /probe/);');
    expect(log).toHaveBeenCalledWith("SDK", "[object Object]", "[object RegExp]");
  });

  afterEach(() => {
    execute("runtime.dispose()");
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("SDK 捕获的周期任务可以暂停和恢复，空闲期间没有原生定时器", async () => {
    execute(`
      const captured = window.setInterval;
      let calls = 0;
      runtime.start(true);
      captured(() => calls++, 300000);
    `);
    expect(vi.getTimerCount()).toBe(1);
    execute("runtime.stop()");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(900_000);
    expect(execute("calls")).toBe(0);
    execute("runtime.start()");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(execute("calls")).toBe(1);
  });

  it("操作期间新增的周期任务不会随着实例复用累积", () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      execute("runtime.start(); setInterval(() => {}, 10)");
      expect(vi.getTimerCount()).toBe(1);
      execute("runtime.stop()");
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("一次性任务结束或暂停时释放，清除接口支持交叉取消", async () => {
    execute(`
      let calls = 0;
      runtime.start();
      setTimeout(() => calls++, 10);
      clearInterval(setTimeout(() => calls++, 10));
      clearTimeout(setInterval(() => calls++, 10));
    `);
    await vi.advanceTimersByTimeAsync(10);
    expect(execute("calls")).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    execute("setTimeout(() => calls++, 10); runtime.stop(); runtime.start()");
    await vi.advanceTimersByTimeAsync(10);
    expect(execute("calls")).toBe(1);
  });

  it("释放旧实例后不恢复其周期回调，反复安装也不重复包装", async () => {
    execute(`
      let oldCalls = 0;
      let newCalls = 0;
      runtime.start();
      setInterval(() => oldCalls++, 10);
      runtime.dispose();
      runtime.start();
      setInterval(() => newCalls++, 10);
    `);
    expect(execute(`(${installWatchmanRuntime.toString()})() === runtime`)).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(execute("oldCalls")).toBe(0);
    expect(execute("newCalls")).toBe(1);
  });

  it("先撤销网络回调再中止残留请求，不触发重试", () => {
    execute(`
      runtime.start();
      let retries = 0;
      const request = new XMLHttpRequest();
      request.onerror = () => { retries++; setTimeout(() => retries++, 1); };
      request.send();
      runtime.stop();
    `);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(execute("retries")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    execute("runtime.start()");
    expect(() => execute("request.send()")).toThrow("凭据任务已结束");
  });

  it("已完成请求不再持有，空闲期间迟到的任务也不会被调度", () => {
    execute(`
      runtime.start();
      const request = new XMLHttpRequest();
      request.send();
      request.dispatchEvent(new Event("loadend"));
      runtime.stop();
      setTimeout(() => { throw new Error("迟到任务"); }, 1);
      setInterval(() => { throw new Error("迟到任务"); }, 1);
    `);
    expect(abort).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
