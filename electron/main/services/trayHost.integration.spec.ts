import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SessionBus } from "@main/utils/dbus";

vi.mock("@main/utils/logger", () => ({ trayLog: { info: vi.fn(), warn: vi.fn() } }));

const { watchTrayHostReady } = await import("./trayHost");

/** 私有总线进程 */
let daemon: ChildProcess | null = null;
/** 原始会话总线地址 */
let previousAddress: string | undefined;

/**
 * 读取子进程输出的第一行
 * @param stream - 子进程标准输出
 * @returns 首行内容
 */
const readFirstLine = (stream: Readable): Promise<string> =>
  new Promise((resolve) => {
    let received = "";
    stream.on("data", (chunk: Buffer) => {
      received += chunk.toString("utf8");
      const end = received.indexOf("\n");
      if (end !== -1) resolve(received.slice(0, end).trim());
    });
  });

beforeAll(async () => {
  previousAddress = process.env["DBUS_SESSION_BUS_ADDRESS"];
  try {
    daemon = spawn("dbus-daemon", ["--session", "--print-address=1", "--nofork"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    process.env["DBUS_SESSION_BUS_ADDRESS"] = await readFirstLine(daemon.stdout!);
  } catch {
    daemon = null;
  }
});

afterAll(() => {
  daemon?.kill();
  if (previousAddress === undefined) delete process.env["DBUS_SESSION_BUS_ADDRESS"];
  else process.env["DBUS_SESSION_BUS_ADDRESS"] = previousAddress;
});

describe("托盘宿主就绪检测接入真实总线", () => {
  it("watcher 晚于应用出现时仍能创建托盘", async (t) => {
    if (!daemon) {
      t.skip("环境缺少 dbus-daemon");
      return;
    }
    const onReady = vi.fn();
    watchTrayHostReady(onReady);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(onReady).not.toHaveBeenCalled();

    const probe = await SessionBus.connect(process.env["DBUS_SESSION_BUS_ADDRESS"]);
    await probe.call(
      "org.freedesktop.DBus",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus",
      "RequestName",
      "su",
      (writer) => {
        writer.writeString("org.kde.StatusNotifierWatcher");
        writer.writeUint32(0);
      },
    );
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1), { timeout: 6000 });
    probe.close();
  });
});
