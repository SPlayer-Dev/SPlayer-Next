import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn, default: { spawn: mocks.spawn } }));
vi.mock("electron", () => ({ app: { once: vi.fn() } }));
vi.mock("@main/utils/logger", () => ({ playerLog: { info: vi.fn() } }));
vi.mock("./assets", () => ({ AUTOMIX_WORKER: "automix-worker.exe" }));
vi.mock("@main/utils/paths", () => ({
  automixDirs: { beat: "beat", demucs: "demucs", runtime: "runtime" },
}));

const windows = [{ input: "a.mel", output: "a.beats" }];

describe("独立模型进程与串行任务", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it("旧模型取消后等待关闭再启动下一模型", async () => {
    const [firstChild, secondChild] = Array.from({ length: 2 }, () =>
      Object.assign(new EventEmitter(), {
        kill: vi.fn(),
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
      }),
    );
    mocks.spawn.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
    const { runAutoMixTask, runAutoMixModel } = await import("./inference");
    const controller = new AbortController();
    const first = runAutoMixTask(controller.signal, () =>
      runAutoMixModel("beat", windows, controller.signal),
    ).catch((error: Error) => error);
    await flushPromises();
    controller.abort();
    const signal = new AbortController().signal;
    const second = runAutoMixTask(signal, () => runAutoMixModel("demucs", windows, signal));
    await flushPromises();
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(firstChild.kill).toHaveBeenCalledOnce();
    firstChild.emit("close", null);
    expect(await first).toBeInstanceOf(Error);
    await flushPromises();
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    secondChild.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ windows: [{ frames: 100 }], memoryMb: 100, seconds: 1 })),
    );
    secondChild.emit("close", 0);
    expect(await second).toEqual([{ frames: 100 }]);
  });

  it("排队期间已失效的任务不运行，后续有效任务仍可执行", async () => {
    const { runAutoMixTask } = await import("./inference");
    let release!: () => void;
    const first = runAutoMixTask(
      new AbortController().signal,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const controller = new AbortController();
    const task = vi.fn();
    const skipped = runAutoMixTask(controller.signal, task).catch((error: Error) => error);
    await flushPromises();
    controller.abort();
    release();
    await first;
    expect(await skipped).toBeInstanceOf(Error);
    expect(task).not.toHaveBeenCalled();
    expect(await runAutoMixTask(new AbortController().signal, async () => 1)).toBe(1);
  });
});
