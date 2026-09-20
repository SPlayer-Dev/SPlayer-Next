import assert from "node:assert/strict";
import { constants } from "node:crypto";
import { getDefaultResultOrder, setDefaultResultOrder } from "node:dns";
import { lookup } from "node:dns/promises";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";

const defaultDnsResultOrder = getDefaultResultOrder();

const configModule = `data:text/javascript,${encodeURIComponent(`
  export const config = { protocol: "off", host: "127.0.0.1", port: 10808, preferIPv4: false };
  export const store = { get: key => key === "system.preferIPv4" ? config.preferIPv4 : config };
`)}`;

// 使用内存配置和调度器替身，不读写用户配置或访问网络。
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@main/store") return { url: configModule, shortCircuit: true };
    const stubs: Record<string, string> = {
      "@main/utils/logger": "export const systemLog = { info() {}, warn() {} }",
      undici: `
        export class Agent {
          constructor(options) { this.options = options; }
          close() { return Promise.resolve(); }
          destroy() { this.destroyed = true; return Promise.resolve(); }
        }
        export class ProxyAgent extends Agent {}
        export class Socks5ProxyAgent extends Agent {}
        export const fetch = (...args) => globalThis.fetch(...args);
      `,
    };
    if (stubs[specifier]) {
      return {
        url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});
const { applyIPv4Preference, fetchWithProxy, resetNetworkDispatchers } =
  await import("./proxy").finally(() => hooks.deregister());
const { config } = (await import(configModule)) as {
  config: { protocol: string; host: string; port: number; preferIPv4: boolean };
};

describe("IPv4 连接偏好与重试回退", () => {
  beforeEach(() => {
    config.protocol = "off";
    config.preferIPv4 = false;
    resetNetworkDispatchers();
  });

  afterEach(() => {
    setDefaultResultOrder(defaultDnsResultOrder);
  });

  it("开启 IPv4 优先后，新解析优先返回 IPv4 且仍能解析 IPv6 地址", async () => {
    config.preferIPv4 = true;
    applyIPv4Preference();

    const addresses = await lookup("localhost", { all: true });
    assert.equal(addresses[0].family, 4);
    assert.deepEqual(await lookup("::1"), { address: "::1", family: 6 });
  });

  it("关闭或重置 IPv4 偏好后恢复启动时的地址顺序", () => {
    config.preferIPv4 = true;
    applyIPv4Preference();
    assert.equal(getDefaultResultOrder(), "ipv4first");

    config.preferIPv4 = false;
    applyIPv4Preference();
    assert.equal(getDefaultResultOrder(), defaultDnsResultOrder);
  });

  it("IPv4 优先仍允许双栈建连并保留 TLS 兼容选项", async (t) => {
    config.preferIPv4 = true;
    applyIPv4Preference();
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ code: 200 }));
    const options = { method: "POST", body: "test=1" };

    await fetchWithProxy("https://music.163.com/api/test", options);

    const { dispatcher, ...requestOptions } = fetchMock.mock.calls[0]
      .arguments[1] as RequestInit & {
      dispatcher: { options: unknown };
    };
    assert.deepEqual(requestOptions, options);
    assert.deepEqual(dispatcher.options, {
      connect: {
        autoSelectFamily: true,
        secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
      },
    });
  });

  it("普通直连复用支持 TLS 兼容选项的默认调度器", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ code: 200 }));
    const options = { method: "POST", body: "test=1" };

    await fetchWithProxy("https://music.163.com/api/test", options);
    await fetchWithProxy("https://interfacepc.music.163.com/api/test", options);

    const requests = fetchMock.mock.calls.map(
      (call) => call.arguments[1] as RequestInit & { dispatcher: { options: unknown } },
    );
    assert.equal(requests[0].dispatcher, requests[1].dispatcher);
    assert.deepEqual(requests[0].dispatcher.options, {
      connect: {
        autoSelectFamily: true,
        secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
      },
    });
  });

  it("直连失败后的重试强制 IPv4，并复用同一个调度器", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ code: 200 }));

    await fetchWithProxy("https://music.163.com/api/test", undefined, true);
    await fetchWithProxy("https://interfacepc.music.163.com/api/test", undefined, true);

    const options = fetchMock.mock.calls.map(
      (call) => call.arguments[1] as RequestInit & { dispatcher: { options: unknown } },
    );
    assert.deepEqual(options[0].dispatcher.options, {
      connect: {
        family: 4,
        autoSelectFamily: false,
        secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
      },
    });
    assert.equal(options[0].dispatcher, options[1].dispatcher);
  });

  it("切换网络配置后销毁旧连接池并使用新的默认调度器", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ code: 200 }));
    await fetchWithProxy("https://music.163.com/api/test");
    await fetchWithProxy("https://music.163.com/api/test", undefined, true);

    const oldDispatchers = fetchMock.mock.calls.map(
      (call) =>
        (call.arguments[1] as RequestInit & { dispatcher: { destroyed?: boolean } }).dispatcher,
    );
    const dispatcher = resetNetworkDispatchers();
    assert.ok(oldDispatchers.every((old) => old.destroyed && old !== dispatcher));

    await fetchWithProxy("https://music.163.com/api/test");
    assert.equal(
      (fetchMock.mock.calls[2].arguments[1] as RequestInit & { dispatcher: unknown }).dispatcher,
      dispatcher,
    );
  });

  for (const protocol of ["http", "https", "socks5"]) {
    it(`${protocol} 手动代理不会被 IPv4 回退绕过`, async (t) => {
      config.protocol = protocol;
      config.preferIPv4 = true;
      applyIPv4Preference();
      const fetchMock = t.mock.method(globalThis, "fetch", async () =>
        Response.json({ code: 200 }),
      );

      await fetchWithProxy("https://music.163.com/api/test", undefined, true);

      const options = fetchMock.mock.calls[0].arguments[1] as RequestInit & {
        dispatcher: { options: string; constructor: { name: string } };
      };
      assert.equal(options.dispatcher.options, `${protocol}://127.0.0.1:10808`);
      assert.equal(
        options.dispatcher.constructor.name,
        protocol === "socks5" ? "Socks5ProxyAgent" : "ProxyAgent",
      );
    });
  }
});
