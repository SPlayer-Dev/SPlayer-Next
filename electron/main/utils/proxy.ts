import { store } from "@main/store";
import { systemLog } from "@main/utils/logger";
import type { Dispatcher } from "undici";
import crypto from "node:crypto";

const PROXY_TEST_URL = "https://www.baidu.com";

let proxyAgent: Dispatcher | null = null;
let proxyAgentUrl = "";
let defaultDispatcher: Dispatcher | null = null;

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

/** Node fetch 包装：首次请求才加载网络库，并复用当前代理连接池 */
export const fetchWithProxy = async (
  input: string | URL,
  init?: RequestInit,
): Promise<Response> => {
  const { fetch, Agent, ProxyAgent, Socks5ProxyAgent } = await import("undici");
  const url = getNetworkProxyUrl();
  let dispatcher: Dispatcher;
  if (url) {
    if (!proxyAgent || proxyAgentUrl !== url) {
      proxyAgent?.close().catch(() => {});
      proxyAgent = url.startsWith("socks5://") ? new Socks5ProxyAgent(url) : new ProxyAgent(url);
      proxyAgentUrl = url;
      systemLog.info(`[proxy] node fetch proxy=${url}`);
    }
    dispatcher = proxyAgent;
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
