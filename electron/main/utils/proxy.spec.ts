import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: { protocol: "off", host: "127.0.0.1", port: 7890 },
  load: vi.fn(),
  fetch: vi.fn(),
  direct: vi.fn(),
  http: vi.fn(),
  socks: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@main/store", () => ({ store: { get: () => mocks.config } }));
vi.mock("@main/utils/logger", () => ({ systemLog: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("undici", () => {
  mocks.load();
  return {
    fetch: mocks.fetch,
    Agent: class {
      constructor(options: unknown) {
        mocks.direct(options);
      }
    },
    ProxyAgent: class {
      close = mocks.close;
      constructor(url: string) {
        mocks.http(url);
      }
    },
    Socks5ProxyAgent: class {
      close = mocks.close;
      constructor(url: string) {
        mocks.socks(url);
      }
    },
  };
});

describe("延迟加载网络库", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.config = { protocol: "off", host: "127.0.0.1", port: 7890 };
    mocks.fetch.mockResolvedValue(new Response("ok"));
    mocks.close.mockResolvedValue(undefined);
  });

  it("读取代理配置不加载网络库，在途请求共用直连连接池", async () => {
    const proxy = await import("./proxy");
    expect(proxy.getNetworkProxyUrl()).toBeNull();
    expect(mocks.load).not.toHaveBeenCalled();
    let complete!: (response: Response) => void;
    mocks.fetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
    );
    const first = proxy.fetchWithProxy("https://example.test/a");
    await vi.dynamicImportSettled();
    await proxy.fetchWithProxy("https://example.test/b");
    complete(new Response("ok"));
    await first;
    expect(mocks.direct).toHaveBeenCalledOnce();
    expect(mocks.fetch.mock.calls[0][1].dispatcher).toBe(mocks.fetch.mock.calls[1][1].dispatcher);
  });

  it("代理切换关闭旧连接池，HTTP 和 SOCKS 请求保留请求参数", async () => {
    const proxy = await import("./proxy");
    mocks.config.protocol = "http";
    const signal = new AbortController().signal;
    await proxy.fetchWithProxy("https://example.test", { method: "POST", signal });
    await proxy.fetchWithProxy("https://example.test");
    expect(mocks.http).toHaveBeenCalledOnce();
    mocks.config.protocol = "socks5";
    await proxy.fetchWithProxy("https://example.test");
    expect(mocks.socks).toHaveBeenCalledWith("socks5://127.0.0.1:7890");
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.fetch.mock.calls[0][1]).toMatchObject({ method: "POST", signal });
  });
});
