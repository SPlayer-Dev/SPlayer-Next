import type { Session, WebContents } from "electron";
import { installWatchmanRuntime } from "./watchmanRuntime";

export const WATCHMAN_WORLD_ID = 1007;
const POLICY_CACHE_TTL_MS = 5 * 60_000;
const TOOL_URL = "https://acstatic-dun.126.net/tool.min.js";

interface WatchmanRequest {
  contents: WebContents;
  session: Session;
  productNumber: string;
  businessId: string;
  signal: AbortSignal;
}

interface WatchmanConfig {
  conf: string;
  s: string;
  as: string;
  v: string;
  luv: string;
  ss?: string[];
  ass?: string[];
  ivp?: number | string;
}

interface WatchmanPolicy {
  productNumber: string;
  whiteList: Array<{ businessId: string; list: string[] }>;
}

interface WatchmanRule {
  productNumber: string;
  businessId: string;
}

let policyCache: { value: WatchmanPolicy; expiresAt: number } | null = null;
let configCache: { productNumber: string; value: WatchmanConfig; expiresAt: number } | null = null;

/**
 * 依据官方路径规则选择最后匹配的业务标识，配置只保留一份并限时复用
 * @param path - 加密前的 API 路径
 * @param request - 不附加 SDK 凭据的配置请求
 * @returns 匹配的产品和业务标识，未匹配时不启用 SDK
 */
export const resolveWatchmanRule = async (
  path: string,
  request: (path: string, data: Record<string, unknown>) => Promise<Record<string, unknown>>,
): Promise<WatchmanRule | null> => {
  if (!policyCache || policyCache.expiresAt <= Date.now()) {
    const response = await request("/api/middle/clientcfg/config/list", { moduleName: "yidun" });
    const value = (response.data as Record<string, unknown> | undefined)?.["yidun#paths"] as
      WatchmanPolicy | undefined;
    if (
      typeof value?.productNumber !== "string" ||
      !value.productNumber ||
      !Array.isArray(value.whiteList) ||
      value.whiteList.some(
        (rule) =>
          typeof rule.businessId !== "string" ||
          !Array.isArray(rule.list) ||
          rule.list.some((item) => typeof item !== "string"),
      )
    ) {
      throw new Error("请求凭据规则无效");
    }
    policyCache = { value, expiresAt: Date.now() + POLICY_CACHE_TTL_MS };
  }
  const normalized = path.split(/[?#]/, 1)[0].replace(/\/$/, "");
  let businessId = "";
  for (const rule of policyCache.value.whiteList) {
    if (
      rule.list.some((item) =>
        item.endsWith("/") ? normalized.startsWith(item) : normalized === item,
      )
    ) {
      businessId = rule.businessId;
    }
  }
  return businessId ? { productNumber: policyCache.value.productNumber, businessId } : null;
};

let sourceCache: { url: string; tool: string; sdk: string } | null = null;

/**
 * 停止采样并释放 SDK 私有缓存的引用，保留主进程中的脚本文本
 * @param contents - 承载凭据 SDK 的主窗口内容
 * @returns 清理脚本的执行结果，窗口已退出时直接结束
 */
export const resetWatchman = async (contents: WebContents | null): Promise<void> => {
  policyCache = null;
  configCache = null;
  if (!contents || contents.isDestroyed()) return;
  await contents.executeJavaScriptInIsolatedWorld(WATCHMAN_WORLD_ID, [
    {
      code: `(() => {
      const state = window.__splayerWatchman;
      if (state?.job) {
        state.job.canceled = true;
        state.job.reject?.(new Error("凭据任务已取消"));
      }
      try {
        state?.sdk._stop();
      } finally {
        window.__splayerWatchmanRuntime?.dispose();
        delete window.__splayerWatchman;
        delete window.Watchman;
        delete window.__splayerWatchmanVersion;
        delete window.__splayerWatchmanSignature;
      }
    })()`,
    },
  ]);
};

/**
 * 复用主窗口的隔离环境生成凭据，登录信息与业务请求不进入该环境
 * @param request - 主窗口、网络会话、产品配置和取消信号
 * @returns 两层请求封装使用的实时凭据
 */
export const getWatchmanTokens = async (
  request: WatchmanRequest,
): Promise<{ token: string; checkToken: string }> => {
  const { contents, session: ses, productNumber, businessId, signal } = request;
  signal.throwIfAborted();
  let onAbort!: () => void;
  const canceled = new Promise<never>((_, reject) => {
    onAbort = () => {
      reject(signal.reason);
      void resetWatchman(contents).catch(() => {});
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  void canceled.catch(() => {});

  /**
   * 窗口重载或任务取消后，不再继续执行旧任务的脚本
   * @param code - 只在专用隔离环境执行的代码
   * @returns 脚本的可序列化结果
   */
  const execute = async (code: string): Promise<unknown> => {
    signal.throwIfAborted();
    return Promise.race([
      contents.executeJavaScriptInIsolatedWorld(WATCHMAN_WORLD_ID, [{ code }]),
      canceled,
    ]);
  };

  /**
   * 读取 SDK 配置与脚本，复用主进程的代理设置和取消信号
   * @param url - 官方配置或静态资源地址
   * @returns 已校验状态码的响应文本
   */
  const fetchText = async (url: string): Promise<string> => {
    const response = await ses.fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    });
    if (!response.ok) throw new Error("凭据资源加载失败");
    return response.text();
  };

  try {
    if (configCache?.productNumber !== productNumber || configCache.expiresAt <= Date.now()) {
      const text = await fetchText(
        `https://ac.dun.163.com/v2/config/js?pn=${encodeURIComponent(productNumber)}&cb=splayerWatchmanConfig&t=${Date.now()}`,
      );
      signal.throwIfAborted();
      const match = text.match(/^\s*splayerWatchmanConfig\s*\(([\s\S]*)\)\s*;?\s*$/);
      if (!match) throw new Error("凭据配置格式无效");
      const config = JSON.parse(match[1]) as { code?: number; result?: WatchmanConfig };
      if (config.code !== 200 || !config.result) throw new Error("凭据配置未就绪");
      const ttl = Number(config.result.ivp);
      configCache = {
        productNumber,
        value: config.result,
        expiresAt: Date.now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : 0),
      };
    }
    const result = configCache.value;
    const origin = new URL(`https://${result.s.replace(/^https?:\/\//, "")}`);
    if (origin.hostname !== "acstatic-dun.126.net" || !/^[\w.-]+$/.test(result.v)) {
      throw new Error("凭据脚本来源无效");
    }
    const sdkUrl = `${origin.origin}/${result.v}/watchman.min.js`;
    const options = {
      productNumber,
      pn: productNumber,
      protocol: "https",
      auto: false,
      configHash: result.conf,
      sConfig: result.conf,
      lastUsedVersion: result.luv,
      staticServer: result.s,
      apiServer: result.as,
      staticServers: result.ss || [result.s, result.s],
      apiServers: result.ass || [result.as, result.as],
      buildVersion: result.v,
    };
    const signature = JSON.stringify(options);
    await execute(`void (${installWatchmanRuntime.toString()})()`);
    const loaded = await execute(
      `window.__splayerWatchmanVersion === ${JSON.stringify(sdkUrl)} && window.__splayerWatchmanSignature === ${JSON.stringify(signature)} && typeof window.Watchman === "function"`,
    );
    if (!loaded) {
      if (sourceCache?.url !== sdkUrl) {
        const [tool, sdk] = await Promise.all([fetchText(TOOL_URL), fetchText(sdkUrl)]);
        sourceCache = { url: sdkUrl, tool, sdk };
      }
      await execute(`(() => {
        try { window.__splayerWatchman?.sdk._stop(); }
        finally {
          delete window.__splayerWatchman;
          delete window.Watchman;
          window.__splayerWatchmanRuntime.dispose();
          window.__splayerWatchmanRuntime.start(true);
        }
      })()`);
      await execute(sourceCache.tool);
      await execute(sourceCache.sdk);
      await execute(`
        window.__splayerWatchmanVersion = ${JSON.stringify(sdkUrl)};
        window.__splayerWatchmanSignature = ${JSON.stringify(signature)};
        void 0;
      `);
    }
    const resultTokens = (await execute(`(async () => {
      const options = ${JSON.stringify(options)};
      const runtime = window.__splayerWatchmanRuntime;
      let state = window.__splayerWatchman;
      if (!state) {
        runtime.start(true);
        state = window.__splayerWatchman = { sdk: new window.Watchman(options), job: null };
      }
      runtime.start();
      const job = { canceled: false, reject: null };
      state.job = job;
      const getToken = () => {
        if (job.canceled) throw new Error("凭据任务已取消");
        return new Promise((resolve, reject) => {
          job.reject = reject;
          state.sdk._getToken(${JSON.stringify(businessId)}, (token) => {
            if (job.canceled) return;
            if (typeof token !== "string" || !token) reject(new Error("凭据为空"));
            else resolve(token);
          }, () => reject(new Error("凭据获取失败")));
        });
      };
      try {
        state.sdk._start();
        return { token: await getToken(), checkToken: await getToken() };
      } finally {
        try { state.sdk._stop(); }
        finally {
          runtime.stop();
          if (state.job === job) state.job = null;
        }
      }
    })()`)) as { token?: unknown; checkToken?: unknown } | undefined;
    if (
      typeof resultTokens?.token !== "string" ||
      !resultTokens.token ||
      typeof resultTokens.checkToken !== "string" ||
      !resultTokens.checkToken
    ) {
      throw new Error("凭据未就绪");
    }
    return { token: resultTokens.token, checkToken: resultTokens.checkToken };
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (!contents.isDestroyed()) {
      await contents.executeJavaScriptInIsolatedWorld(WATCHMAN_WORLD_ID, [
        { code: "window.__splayerWatchmanRuntime?.stop()" },
      ]);
    }
  }
};
