import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  sdkHangs: false,
  emptyToken: false,
  mainAvailable: true,
  sdkVersion: "test-version",
  sdkTtl: 60_000,
  writeCode: 200,
  writeFault: false,
  invalidBody: false,
  invalidPolicy: false,
  staticHost: "acstatic-dun.126.net",
  tokenCount: 0,
  sdkStarts: 0,
  sdkStops: 0,
  sdkInstances: 0,
  sdkModules: 0,
  sdkRefreshes: 0,
  sdkConfig: "sdk-config",
  constructorFails: false,
  stopFails: false,
  requestsAborted: 0,
  rules: [] as Array<{ businessId: string; list: string[] }>,
  requests: [] as Array<{
    origin: string;
    path: string;
    data: Record<string, unknown>;
    headers: Record<string, string>;
    referrerPolicy?: string;
    credentials?: string;
  }>,
  sdkKeys: [] as string[],
  scripts: [] as string[],
  resources: [] as string[],
  cookies: [] as Array<{ name: string; value: string }>,
  createWindow: vi.fn(() => {
    throw new Error("API 请求不应创建窗口");
  }),
  clearStorage: vi.fn(async () => {}),
  setProxy: vi.fn(async () => {}),
  mainSetProxy: vi.fn(async () => {}),
  resetContext: () => {},
  emit: (_event: string, ..._args: unknown[]) => {},
  listenerCount: (_event: string): number => 0,
}));

vi.mock("@main/utils/proxy", () => ({ getNetworkProxyUrl: () => null }));
vi.mock("@main/utils/logger", () => ({ neteaseLog: { warn: vi.fn() } }));
vi.mock("./crypto", () => ({
  weapi: (data: Record<string, unknown>) => ({ params: JSON.stringify(data), encSecKey: "test" }),
}));
vi.mock("@main/window/main", async () => {
  const { createContext, runInContext } = await import("node:vm");
  const { EventEmitter } = await import("node:events");
  const createRealm = () => {
    const Request = class extends EventTarget {
      onerror: (() => void) | null = null;
      abort = (): void => {
        api.requestsAborted++;
        this.onerror?.();
        this.dispatchEvent(new Event("loadend"));
      };
    };
    Object.assign(Request.prototype, { send: () => undefined });
    const context = createContext({
      __testApi: api,
      setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
      setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
      XMLHttpRequest: Request,
    });
    runInContext("window = globalThis", context);
    return context;
  };
  let realm = createRealm();
  api.resetContext = () => {
    realm = createRealm();
  };
  const contents = Object.assign(new EventEmitter(), {
    session: { setProxy: api.mainSetProxy },
    isDestroyed: () => false,
    getUserAgent: () => "test-browser",
    executeJavaScriptInIsolatedWorld: async (worldId: number, scripts: Array<{ code: string }>) => {
      expect(worldId).toBe(1007);
      let result: unknown;
      for (const { code } of scripts) {
        api.scripts.push(code);
        result = await runInContext(code, realm);
      }
      return result;
    },
  });
  api.emit = (event, ...args) => {
    contents.emit(event, ...args);
  };
  api.listenerCount = (event) => contents.listenerCount(event);
  return { getMainWindow: () => (api.mainAvailable ? { webContents: contents } : null) };
});
vi.mock("electron", () => ({
  app: { whenReady: async () => {}, once: vi.fn() },
  BrowserWindow: api.createWindow,
  session: {
    fromPartition: () => ({
      clearStorageData: api.clearStorage,
      setProxy: api.setProxy,
      cookies: {
        get: async () => api.cookies,
        set: async ({ name, value }: { name: string; value: string }) => {
          api.cookies = api.cookies.filter((cookie) => cookie.name !== name);
          api.cookies.push({ name, value });
        },
      },
      fetch: async (
        url: string,
        init?: {
          body?: string;
          headers?: Record<string, string>;
          referrerPolicy?: string;
          credentials?: string;
        },
      ) => {
        const parsed = new URL(url);
        if (parsed.hostname === "ac.dun.163.com" || parsed.hostname === "acstatic-dun.126.net") {
          api.resources.push(url);
          let text: string;
          if (parsed.pathname === "/v2/config/js")
            text =
              "splayerWatchmanConfig(" +
              JSON.stringify({
                code: 200,
                result: {
                  conf: api.sdkConfig,
                  s: api.staticHost,
                  as: "ac.dun.163.com",
                  v: api.sdkVersion,
                  luv: "config-version",
                  ivp: api.sdkTtl,
                },
              }) +
              ");";
          else if (parsed.pathname === "/tool.min.js") text = "window.initWatchman = {}";
          else
            text = `(() => {
        __testApi.sdkModules++;
        const repeat = window.setInterval;
        window.Watchman = class {
          /** 模拟初始化产生的后台资源，验证暂停与重建时的清理 */
          constructor() {
            __testApi.sdkInstances++;
            repeat(() => __testApi.sdkRefreshes++, 300000);
            const request = new window.XMLHttpRequest();
            request.onerror = () => repeat(() => __testApi.sdkRefreshes++, 100);
            request.send();
            if (__testApi.constructorFails) throw new Error("构造失败");
          }
          /** 记录采样启动，以检查请求间是否保持静默 */
          _start = () => { __testApi.sdkStarts++; };
          /** 模拟停止异常，以验证清理流程仍然释放资源 */
          _stop = () => {
            __testApi.sdkStops++;
            if (__testApi.stopFails) throw new Error("停止失败");
          };
          /**
           * 模拟当前业务凭据，并允许测试阻塞或空值响应
           * @param key - 当前业务标识
           * @param callback - 接收凭据的回调
           */
          _getToken = (key,callback) => {
            __testApi.sdkKeys.push(key);
            if (!__testApi.sdkHangs) callback(__testApi.emptyToken ? "" : "sdk-" + (++__testApi.tokenCount));
          };
        }
        })()`;
          return { status: 200, ok: true, text: async () => text };
        }
        const path = parsed.pathname.replace("/weapi/", "/api/");
        const data = JSON.parse(new URLSearchParams(init!.body).get("params")!);
        api.requests.push({
          origin: parsed.origin,
          path,
          data,
          headers: init!.headers!,
          referrerPolicy: init!.referrerPolicy,
          credentials: init!.credentials,
        });
        if (path === "/api/middle/clientcfg/config/list")
          return {
            status: 200,
            ok: true,
            json: async () =>
              api.invalidPolicy
                ? { code: 200, data: {} }
                : JSON.parse(
                    JSON.stringify({
                      code: 200,
                      data: {
                        "yidun#paths": { productNumber: "official-product", whiteList: api.rules },
                      },
                    }),
                  ),
          };
        if (api.writeFault) throw new Error("网络请求失败");
        return {
          status: 200,
          ok: true,
          json: async () => {
            if (api.invalidBody) throw new Error("HTML 响应");
            return { code: api.writeCode, playlistId: 10 };
          },
        };
      },
    }),
  },
}));

import { requestWithWebClient, resetWebClientSession } from "./webClient";
import recordRecentSong from "../modules/record_recent_song";

const options = {
  client: "web" as const,
  cookie: { MUSIC_U: "test-session", __csrf: "test-csrf" },
};
const like = (value: boolean = true) =>
  requestWithWebClient(
    "/api/song/like",
    { trackId: "1", userid: "1", like: String(value) },
    options,
  );
const writes = () =>
  api.requests.filter(({ path }) => path !== "/api/middle/clientcfg/config/list");
let caseVersion = 0;

describe("公共网页请求与 SDK 凭据", () => {
  it("网页日志使用独立出口，配置仍走主域名且未匹配时不启动 SDK", async () => {
    await requestWithWebClient(
      "/api/feedback/weblog",
      { logs: "[]" },
      {
        ...options,
        domain: "https://clientlogusf.music.163.com",
      },
    );
    expect(api.requests.map(({ origin, path }) => [origin, path])).toEqual([
      ["https://music.163.com", "/api/middle/clientcfg/config/list"],
      ["https://clientlogusf.music.163.com", "/api/feedback/weblog"],
    ]);
    expect(api.sdkStarts).toBe(0);
    expect(writes()[0].headers.Cookie).toContain("MUSIC_U=test-session");
    expect(writes()[0].headers.Referer).toBe("https://music.163.com/");
    expect(writes()[0].referrerPolicy).toBe("strict-origin-when-cross-origin");
    expect(writes()[0].headers.Origin).toBe("https://music.163.com");
    expect(writes()[0].credentials).toBe("include");
    await expect(
      requestWithWebClient(
        "/api/song/like",
        {},
        {
          ...options,
          domain: "https://untrusted.example",
        },
      ),
    ).rejects.toThrow("网页业务出口无效");
    expect(api.requests).toHaveLength(2);
  });
  beforeEach(() => {
    resetWebClientSession();
    api.resetContext();
    api.sdkHangs = false;
    api.emptyToken = false;
    api.mainAvailable = true;
    api.sdkVersion = "test-" + ++caseVersion;
    api.sdkTtl = 60_000;
    api.writeCode = 200;
    api.writeFault = false;
    api.invalidBody = false;
    api.invalidPolicy = false;
    api.staticHost = "acstatic-dun.126.net";
    api.tokenCount = 0;
    api.sdkStarts = 0;
    api.sdkStops = 0;
    api.sdkInstances = 0;
    api.sdkModules = 0;
    api.sdkRefreshes = 0;
    api.sdkConfig = "sdk-config";
    api.constructorFails = false;
    api.stopFails = false;
    api.requestsAborted = 0;
    api.rules = [
      { businessId: "old-business", list: ["/api/song/like"] },
      {
        businessId: "current-business",
        list: [
          "/api/song/",
          "/api/artist/sub",
          "/api/playlist/subscribe",
          "/api/playlist/manipulate/tracks",
        ],
      },
    ];
    api.requests.length = 0;
    api.resources.length = 0;
    api.sdkKeys.length = 0;
    api.scripts.length = 0;
    api.cookies = [];
    api.createWindow.mockClear();
  });
  afterEach(() => {
    resetWebClientSession();
    vi.useRealTimers();
    expect(api.createWindow).not.toHaveBeenCalled();
    expect(api.listenerCount("did-start-navigation")).toBe(0);
    expect(api.listenerCount("destroyed")).toBe(0);
  });

  it("业务模块的默认空域名回退到主域名", async () => {
    await recordRecentSong({ cookie: options.cookie, limit: 1 }, requestWithWebClient);
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({
      origin: "https://music.163.com",
      path: "/api/play-record/song/list",
      data: { limit: 1, csrf_token: "test-csrf" },
    });
    expect(api.sdkStarts).toBe(0);
    expect(writes()[0].headers.Referer).toBe("https://music.163.com/st/webplayer");
  });

  it("最后匹配的规则统一装配两层凭据，直接返回业务 200", async () => {
    expect((await like()).body).toEqual({ code: 200, playlistId: 10 });
    expect(api.sdkKeys).toEqual(["current-business", "current-business"]);
    const written = writes()[0];
    expect(written.data).toEqual({
      trackId: "1",
      userid: "1",
      like: "true",
      token: "sdk-1",
      checkToken: "sdk-2",
      csrf_token: "test-csrf",
    });
    expect(written.headers["X-antiCheatToken"]).toBe("sdk-2");
    expect(written.headers.Cookie).toContain("MUSIC_U=test-session");
    expect(
      api.requests.some(
        ({ path }) => path === "/api/song/like/check" || path === "/api/w/nuser/account/get",
      ),
    ).toBe(false);
    expect(
      api.scripts.every((code) => !code.includes("test-session") && !code.includes("test-csrf")),
    ).toBe(true);
    expect(api.sdkStarts).toBe(1);
    expect(api.sdkStops).toBe(1);
  });
  it("歌手、歌单和歌曲共用队列、配置与 SDK 实例", async () => {
    const paths = [
      "/api/song/like",
      "/api/artist/sub",
      "/api/playlist/subscribe",
      "/api/playlist/manipulate/tracks",
    ];
    await Promise.all(paths.map((path) => requestWithWebClient(path, { id: 1 }, options)));
    expect(writes().map(({ path }) => path)).toEqual(paths);
    expect(
      api.requests.filter(({ path }) => path === "/api/middle/clientcfg/config/list"),
    ).toHaveLength(1);
    expect(api.resources.filter((url) => url.includes("/v2/config/js"))).toHaveLength(1);
    expect(api.resources.filter((url) => url.endsWith("watchman.min.js"))).toHaveLength(1);
    expect(api.sdkInstances).toBe(1);
    expect(api.sdkStarts).toBe(4);
    expect(api.sdkStops).toBe(4);
    expect(
      writes().every(({ data, headers }) => data.checkToken === headers["X-antiCheatToken"]),
    ).toBe(true);
  });
  it("暂停构造时捕获的周期定时器和残留请求，空闲不触发刷新", async () => {
    vi.useFakeTimers();
    await like();
    expect(api.requestsAborted).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(api.sdkRefreshes).toBe(0);
    await like(false);
    expect(api.sdkInstances).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("成功请求复用初始化环境，失败、配置变化和账号切换会释放私有缓存", async () => {
    vi.useFakeTimers();
    await like();
    await like(false);
    expect(api.sdkModules).toBe(1);
    api.writeFault = true;
    await expect(like()).rejects.toThrow("网络请求失败");
    api.writeFault = false;
    await like();
    expect(api.sdkModules).toBe(2);
    api.sdkConfig = "updated-config";
    vi.setSystemTime(Date.now() + 61_000);
    await like();
    expect(api.sdkModules).toBe(3);
    resetWebClientSession();
    await like();
    expect(api.sdkModules).toBe(4);
    expect(api.resources.filter((url) => url.endsWith("watchman.min.js"))).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("配置变化、账号切换和失败重建不会留下旧实例的定时器", async () => {
    vi.useFakeTimers();
    await like();
    api.sdkConfig = "updated-config";
    vi.setSystemTime(Date.now() + 61_000);
    await like();
    expect(api.sdkInstances).toBe(2);
    for (let attempt = 0; attempt < 3; attempt++) {
      resetWebClientSession();
      api.writeFault = true;
      await expect(like()).rejects.toThrow("网络请求失败");
      expect(vi.getTimerCount()).toBe(0);
      api.writeFault = false;
      await like();
      expect(vi.getTimerCount()).toBe(0);
    }
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(api.sdkRefreshes).toBe(0);
  });
  it.each(["constructorFails", "stopFails"] as const)(
    "%s 异常也会释放原生任务，下一次仍可重建",
    async (failure) => {
      vi.useFakeTimers();
      api[failure] = true;
      await expect(like()).rejects.toThrow();
      expect(vi.getTimerCount()).toBe(0);
      expect(api.requestsAborted).toBe(1);
      api[failure] = false;
      await like();
      expect(api.sdkInstances).toBe(2);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("未匹配路径无需 SDK 或主窗口，也不附加凭据", async () => {
    api.mainAvailable = false;
    await requestWithWebClient("/api/album/sub", { id: 1 }, options);
    expect(api.resources).toEqual([]);
    expect(api.sdkStarts).toBe(0);
    expect(writes()[0].data).toEqual({ id: 1, csrf_token: "test-csrf" });
    expect(writes()[0].headers["X-antiCheatToken"]).toBeUndefined();
  });
  it("精确路径不匹配相似路径，查询串和末尾斜杠不改变规则", async () => {
    api.rules = [{ businessId: "exact", list: ["/api/song/like"] }];
    await requestWithWebClient("/api/song/like-extra", {}, options);
    expect(api.sdkStarts).toBe(0);
    await requestWithWebClient("/api/song/like/?source=app", {}, options);
    expect(api.sdkKeys).toEqual(["exact", "exact"]);
  });
  it("SDK 配置按服务端有效期刷新，脚本与实例仍可复用", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    await like();
    vi.setSystemTime(now + 59_000);
    await like(false);
    expect(api.resources.filter((url) => url.includes("/v2/config/js"))).toHaveLength(1);
    vi.setSystemTime(now + 61_000);
    await like();
    expect(api.resources.filter((url) => url.includes("/v2/config/js"))).toHaveLength(2);
    expect(api.sdkInstances).toBe(1);
    expect(api.resources.filter((url) => url.endsWith("watchman.min.js"))).toHaveLength(1);
  });
  it("路径配置在有效期内稳定，过期后采用更新后的业务标识", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    await like();
    api.rules = [{ businessId: "updated-business", list: ["/api/song/like"] }];
    vi.setSystemTime(now + 299_000);
    await like();
    expect(api.sdkKeys.slice(-2)).toEqual(["current-business", "current-business"]);
    vi.setSystemTime(now + 301_000);
    await like();
    expect(api.sdkKeys.slice(-2)).toEqual(["updated-business", "updated-business"]);
    expect(
      api.requests.filter(({ path }) => path === "/api/middle/clientcfg/config/list"),
    ).toHaveLength(2);
  });
  it("切换会话会清理配置和旧任务，后续请求重新加载", async () => {
    api.sdkHangs = true;
    const outcomes = Promise.allSettled([
      like(),
      requestWithWebClient("/api/artist/sub", { id: 2 }, options),
    ]);
    await vi.waitFor(() => expect(api.sdkKeys).toHaveLength(1));
    resetWebClientSession();
    expect((await outcomes).every(({ status }) => status === "rejected")).toBe(true);
    expect(writes()).toEqual([]);
    api.sdkHangs = false;
    await like();
    expect(
      api.requests.filter(({ path }) => path === "/api/middle/clientcfg/config/list"),
    ).toHaveLength(2);
    expect(api.resources.filter((url) => url.includes("/v2/config/js"))).toHaveLength(2);
  });
  it.each([301, 401, 512, 502])("业务 %s 原样抛出，不核验或补发写入", async (code) => {
    api.writeCode = code;
    await expect(like()).rejects.toMatchObject({ response: { status: code, body: { code } } });
    expect(writes()).toHaveLength(1);
  });
  it("网络异常只发送一次业务写入", async () => {
    api.writeFault = true;
    await expect(like()).rejects.toThrow("网络请求失败");
    expect(writes()).toHaveLength(1);
  });
  it("失败清理完成前不能启动下一个排队任务", async () => {
    vi.useFakeTimers();
    const { getMainWindow } = await import("@main/window/main");
    const contents = getMainWindow()!.webContents;
    const execute = contents.executeJavaScriptInIsolatedWorld.bind(contents);
    let finishReset!: () => void;
    let resetStarted = false;
    const reset = new Promise<void>((resolve) => {
      finishReset = resolve;
    });
    const spy = vi
      .spyOn(contents, "executeJavaScriptInIsolatedWorld")
      .mockImplementation(async (worldId, scripts) => {
        if (scripts.some(({ code }) => code.includes("state.job.reject?."))) {
          resetStarted = true;
          await reset;
        }
        return execute(worldId, scripts);
      });
    try {
      api.writeFault = true;
      const failed = expect(like()).rejects.toThrow("网络请求失败");
      await vi.waitFor(() => expect(resetStarted).toBe(true));
      api.writeFault = false;
      const next = like(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(api.sdkStarts).toBe(1);
      expect(writes()).toHaveLength(1);
      finishReset();
      await failed;
      expect((await next).body.code).toBe(200);
      expect(api.sdkInstances).toBe(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      finishReset();
      spy.mockRestore();
    }
  });
  it("响应无法解析时返回业务错误，不伪装成功", async () => {
    api.invalidBody = true;
    await expect(like()).rejects.toMatchObject({ response: { status: 502, body: { code: 502 } } });
    expect(writes()).toHaveLength(1);
  });
  it("空 SDK 凭据或无效规则都不能继续写入", async () => {
    api.emptyToken = true;
    await expect(like()).rejects.toThrow("凭据为空");
    expect(writes()).toEqual([]);
    api.emptyToken = false;
    api.invalidPolicy = true;
    resetWebClientSession();
    await expect(like()).rejects.toThrow("请求凭据规则无效");
    expect(writes()).toEqual([]);
  });
  it("无登录会话时不请求配置或创建 SDK", async () => {
    await expect(
      requestWithWebClient("/api/song/like", {}, { client: "web" }),
    ).rejects.toMatchObject({ response: { status: 301 } });
    expect(api.requests).toEqual([]);
    expect(api.sdkStarts).toBe(0);
  });
  it("主窗口不可用或脚本来源异常时停止 SDK 写入", async () => {
    api.mainAvailable = false;
    await expect(like()).rejects.toThrow("主窗口尚未就绪");
    expect(writes()).toEqual([]);
    api.mainAvailable = true;
    api.staticHost = "untrusted.test";
    await expect(like()).rejects.toThrow("凭据脚本来源无效");
    expect(writes()).toEqual([]);
  });
  it("SDK 超时只取消任务，队列仍可继续", async () => {
    vi.useFakeTimers();
    api.sdkHangs = true;
    const pending = like();
    const rejected = expect(pending).rejects.toThrow("超时");
    await vi.waitFor(() => expect(api.sdkKeys).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(45_000);
    await rejected;
    api.sdkHangs = false;
    expect((await like()).body.code).toBe(200);
  });
  it("队列有界，取消后释放任务和监听器", async () => {
    api.sdkHangs = true;
    const settled = Promise.allSettled(Array.from({ length: 16 }, () => like()));
    await expect(like()).rejects.toThrow("请求过多");
    await vi.waitFor(() => expect(api.sdkKeys).toHaveLength(1));
    resetWebClientSession();
    await settled;
  });
  it("多次取消后重新进入任务，原生定时器数量仍保持一个 SDK 周期和一个截止计时", async () => {
    vi.useFakeTimers();
    api.sdkHangs = true;
    for (let attempt = 0; attempt < 4; attempt++) {
      const pending = like();
      const canceled = expect(pending).rejects.toThrow("会话已变更");
      await vi.waitFor(() => expect(api.sdkKeys).toHaveLength(attempt + 1));
      expect(vi.getTimerCount()).toBe(2);
      resetWebClientSession();
      await canceled;
      expect(vi.getTimerCount()).toBe(0);
    }
  });
  it("主窗口重载后重新初始化隔离环境，复用已下载脚本", async () => {
    await like();
    api.resetContext();
    await like(false);
    expect(api.sdkInstances).toBe(2);
    expect(api.resources.filter((url) => url.endsWith("watchman.min.js"))).toHaveLength(1);
  });
  it("主窗口失效和跨文档导航会取消任务，同页路由不会取消", async () => {
    api.sdkHangs = true;
    const pending = like();
    const rejected = expect(pending).rejects.toThrow("重载");
    await vi.waitFor(() => expect(api.sdkKeys).toHaveLength(1));
    api.emit("did-start-navigation", {}, "file://app/#/liked", true, true);
    expect(api.sdkStops).toBe(0);
    api.emit("did-start-navigation", {}, "file://app/", false, true);
    await rejected;
    const next = like();
    const gone = expect(next).rejects.toThrow("主窗口已退出");
    await vi.waitFor(() => expect(api.sdkKeys).toHaveLength(2));
    api.emit("render-process-gone");
    await gone;
  });
});
