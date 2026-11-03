import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import { SessionBus } from "./dbus";

/** 私有总线地址，启动失败时保持 null 并跳过用例 */
let address: string | null = null;
let daemon: ChildProcess | null = null;

/**
 * 读取子进程输出的第一行
 * @param stream - 子进程标准输出
 * @returns 首行内容
 */
const readFirstLine = (stream: Readable): Promise<string> =>
  new Promise((resolve, reject) => {
    let received = "";
    const onData = (chunk: Buffer): void => {
      received += chunk.toString("utf8");
      const end = received.indexOf("\n");
      if (end === -1) return;
      stream.off("data", onData);
      resolve(received.slice(0, end).trim());
    };
    stream.on("data", onData);
    stream.once("error", reject);
  });

/**
 * 在新连接上申请总线名
 * @param busAddress - 私有总线地址
 * @param name - 待申请的总线名
 * @returns 申请完成后关闭的连接
 */
const requestName = async (busAddress: string, name: string): Promise<SessionBus> => {
  const probe = await SessionBus.connect(busAddress);
  await probe.call(
    "org.freedesktop.DBus",
    "/org/freedesktop/DBus",
    "org.freedesktop.DBus",
    "RequestName",
    "su",
    (writer) => {
      writer.writeString(name);
      writer.writeUint32(0);
    },
  );
  return probe;
};

/**
 * 等待信号，超时则失败
 * @param register - 注册回调
 * @param timeoutMs - 超时毫秒数
 * @returns 回调结果
 */
const waitFor = <T>(
  register: (resolve: (value: T) => void) => void,
  timeoutMs = 5000,
): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("等待信号超时")), timeoutMs);
    register((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });

before(async () => {
  if (process.platform !== "linux") return;
  try {
    daemon = spawn("dbus-daemon", ["--session", "--print-address=1", "--nofork"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    address = await readFirstLine(daemon.stdout!);
  } catch {
    daemon = null;
    address = null;
  }
});

after(() => {
  daemon?.kill();
});

describe("会话总线客户端", () => {
  it("查询总线名持有者", async (t) => {
    if (!address) {
      t.skip("环境缺少 dbus-daemon");
      return;
    }
    const bus = await SessionBus.connect(address);
    assert.equal(await bus.nameHasOwner("org.freedesktop.DBus"), true);
    assert.equal(await bus.nameHasOwner("org.splayer.Missing"), false);
    bus.close();
  });

  it("订阅 NameOwnerChanged 并解析出信号参数", async (t) => {
    if (!address) {
      t.skip("环境缺少 dbus-daemon");
      return;
    }
    const bus = await SessionBus.connect(address);
    const name = "org.splayer.TrayProbe";
    const changed = waitFor<string>((resolve) => {
      bus.onSignal((message) => {
        if (message.member !== "NameOwnerChanged" || message.body[0] !== name) return;
        resolve(String(message.body[1]));
      });
    });
    await bus.match(
      `type='signal',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='${name}'`,
    );
    const probe = await requestName(address, name);
    assert.equal(await changed, "");
    assert.equal(await bus.nameHasOwner(name), true);
    probe.close();
    bus.close();
  });

  it("属性读取失败时返回 undefined", async (t) => {
    if (!address) {
      t.skip("环境缺少 dbus-daemon");
      return;
    }
    const bus = await SessionBus.connect(address);
    const value = await bus.getBoolProperty(
      "org.splayer.Missing",
      "/StatusNotifierWatcher",
      "org.kde.StatusNotifierWatcher",
      "IsStatusNotifierHostRegistered",
    );
    assert.equal(value, undefined);
    bus.close();
  });
});
