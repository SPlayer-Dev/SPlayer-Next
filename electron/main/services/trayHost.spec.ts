import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock("@main/utils/dbus", () => ({ SessionBus: { connect: mocks.connect } }));
vi.mock("@main/utils/logger", () => ({ trayLog: { info: vi.fn(), warn: vi.fn() } }));

const { watchTrayHostReady } = await import("./trayHost");

/** 等待挂起的微任务执行完 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** 构造可控的伪总线连接 */
const createBus = () => {
  let signalHandler: ((message: { interface?: string; member?: string }) => void) | null = null;
  let closeHandler: (() => void) | null = null;
  const bus = {
    nameHasOwner: vi.fn(),
    getBoolProperty: vi.fn(),
    match: vi.fn(async () => undefined),
    onSignal: (handler: (message: { interface?: string; member?: string }) => void) => {
      signalHandler = handler;
      return () => undefined;
    },
    onClose: (handler: () => void) => {
      closeHandler = handler;
      return () => undefined;
    },
    close: vi.fn(),
    emitSignal: (member: string) =>
      signalHandler?.({ interface: "org.kde.StatusNotifierWatcher", member }),
    emitClose: () => closeHandler?.(),
  };
  return bus;
};

beforeEach(() => {
  mocks.connect.mockReset();
});

describe("Linux 托盘宿主就绪检测", () => {
  it("宿主已注册时立即创建托盘", async () => {
    const bus = createBus();
    bus.nameHasOwner.mockResolvedValue(true);
    bus.getBoolProperty.mockResolvedValue(true);
    mocks.connect.mockResolvedValue(bus);
    const onReady = vi.fn();

    watchTrayHostReady(onReady);
    await flush();

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(bus.close).toHaveBeenCalledTimes(1);
  });

  it("watcher 未出现时保持等待，出现后再创建托盘", async () => {
    const bus = createBus();
    bus.nameHasOwner.mockResolvedValueOnce(false).mockResolvedValue(true);
    bus.getBoolProperty.mockResolvedValue(true);
    mocks.connect.mockResolvedValue(bus);
    const onReady = vi.fn();

    watchTrayHostReady(onReady);
    await flush();
    expect(onReady).not.toHaveBeenCalled();

    bus.emitSignal("NameOwnerChanged");
    await flush();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("watcher 存在但宿主未注册时等待宿主信号", async () => {
    const bus = createBus();
    bus.nameHasOwner.mockResolvedValue(true);
    bus.getBoolProperty.mockResolvedValue(false);
    mocks.connect.mockResolvedValue(bus);
    const onReady = vi.fn();

    watchTrayHostReady(onReady);
    await flush();
    expect(onReady).not.toHaveBeenCalled();

    bus.emitSignal("StatusNotifierHostRegistered");
    await flush();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("无法连接总线时按原有行为直接创建托盘", async () => {
    mocks.connect.mockRejectedValue(new Error("缺少 DBUS_SESSION_BUS_ADDRESS"));
    const onReady = vi.fn();

    watchTrayHostReady(onReady);
    await flush();

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("连接中断时降级创建托盘", async () => {
    const bus = createBus();
    bus.nameHasOwner.mockResolvedValue(false);
    mocks.connect.mockResolvedValue(bus);
    const onReady = vi.fn();

    watchTrayHostReady(onReady);
    await flush();
    bus.emitClose();
    await flush();

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("取消等待后不再创建托盘", async () => {
    const bus = createBus();
    bus.nameHasOwner.mockResolvedValue(false);
    mocks.connect.mockResolvedValue(bus);
    const onReady = vi.fn();

    const stop = watchTrayHostReady(onReady);
    await flush();
    stop();
    bus.emitSignal("NameOwnerChanged");
    await flush();

    expect(onReady).not.toHaveBeenCalled();
    expect(bus.close).toHaveBeenCalledTimes(1);
  });
});
