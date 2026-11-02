import { app, session, webContents, type Session } from "electron";
import { store } from "@main/store";
import { systemLog } from "@main/utils/logger";
import type { Dispatcher } from "undici";
import crypto from "node:crypto";

const PROXY_TEST_URL = "https://www.baidu.com";

let proxyAgent: Dispatcher | null = null;
let proxyAgentUrl = "";
let defaultDispatcher: Dispatcher | null = null;
let globalProxyUrl: string | null = null;

const isManualProxyProtocol = (value: string): value is "http" | "https" | "socks5" =>
  value === "http" || value === "https" || value === "socks5";

/** 当前手动代理地址；off 或配置无效时返回 null，保持原生直连行为 */
export const getNetworkProxyUrl = (): string | null => {
  const config = store.get("system.networkProxy");
  if (!isManualProxyProtocol(config.protocol)) return null;
  const host = config.host.trim();
  const port = Number(config.port);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return `${config.protocol}://${host}:${port}`;
};

/**
 * 获取代理连接池，地址变化时重建并关闭旧连接池
 * @param url - 代理地址
 * @returns 与全局 fetch 共用的代理连接池
 */
const getProxyAgent = async (url: string): Promise<Dispatcher> => {
  const { ProxyAgent, Socks5ProxyAgent } = await import("undici");
  if (!proxyAgent || proxyAgentUrl !== url) {
    proxyAgent?.close().catch(() => {});
    proxyAgent = url.startsWith("socks5://") ? new Socks5ProxyAgent(url) : new ProxyAgent(url);
    proxyAgentUrl = url;
    systemLog.info(`[proxy] node fetch proxy=${url}`);
  }
  return proxyAgent;
};

/** Node fetch 包装：首次请求才加载网络库，并复用当前代理连接池 */
export const fetchWithProxy = async (
  input: string | URL,
  init?: RequestInit,
): Promise<Response> => {
  const { fetch, Agent } = await import("undici");
  const url = getNetworkProxyUrl();
  let dispatcher: Dispatcher;
  if (url) {
    dispatcher = await getProxyAgent(url);
  } else {
    defaultDispatcher ??= new Agent({
      connect: {
        secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
      },
    });
    dispatcher = defaultDispatcher;
  }
  return fetch(input, { ...(init as RequestInit), dispatcher } as Parameters<
    typeof fetch
  >[1]) as unknown as Promise<Response>;
};

/** 让全局 fetch 跟随代理设置；从未配置代理时不加载网络库 */
export const applyGlobalFetchProxy = async (): Promise<void> => {
  const url = getNetworkProxyUrl();
  if (url === globalProxyUrl) return;
  const { setGlobalDispatcher, Agent } = await import("undici");
  if (url) {
    setGlobalDispatcher(await getProxyAgent(url));
  } else {
    // 恢复内置 fetch 的默认直连行为，旧代理连接池随之关闭
    setGlobalDispatcher(new Agent());
    proxyAgent?.close().catch(() => {});
    proxyAgent = null;
  }
  globalProxyUrl = url;
};

/**
 * 为 Chromium 会话应用代理设置；关闭时强制直连，不跟随系统代理
 * @param ses - 目标会话
 */
const applySessionProxy = (ses: Session): Promise<void> => {
  const url = getNetworkProxyUrl();
  return ses.setProxy(url ? { mode: "fixed_servers", proxyRules: url } : { mode: "direct" });
};

/** 将代理设置同步到所有已存在的 Chromium 会话 */
export const applySessionsProxy = async (): Promise<void> => {
  const sessions = new Set([
    session.defaultSession,
    ...webContents.getAllWebContents().map((contents) => contents.session),
  ]);
  await Promise.all([...sessions].map(applySessionProxy));
};

/** 新建的会话创建时即应用代理设置，需在 app ready 之前调用 */
export const initNetworkProxy = (): void => {
  applyGlobalFetchProxy().catch((err) => systemLog.warn("[proxy] apply fetch proxy failed", err));
  app.on("session-created", (ses) => {
    applySessionProxy(ses).catch((err) =>
      systemLog.warn("[proxy] apply session proxy failed", err),
    );
  });
};

/** 测试当前代理是否可用 */
export const testNetworkProxy = async (): Promise<boolean> => {
  if (!getNetworkProxyUrl()) return false;
  try {
    const res = await fetchWithProxy(PROXY_TEST_URL, { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch (err) {
    systemLog.warn("[proxy] test failed", err);
    return false;
  }
};
