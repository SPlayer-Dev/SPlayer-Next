import { store } from "@main/store";
import { systemLog } from "@main/utils/logger";
import { fetch as undiciFetch, Agent, ProxyAgent, Socks5ProxyAgent } from "undici";
import type { Dispatcher } from "undici";
import crypto from "node:crypto";

const PROXY_TEST_URL = "https://www.baidu.com";

let proxyAgent: Dispatcher | null = null;
let proxyAgentUrl = "";
let defaultDispatcher: Dispatcher | null = null;

const isManualProxyProtocol = (value: string): value is "http" | "https" | "socks5" =>
  value === "http" || value === "https" || value === "socks5";

/** 默认直连 dispatcher（允许 legacy renegotiation） */
const getDefaultDispatcher = (): Dispatcher => {
  if (!defaultDispatcher) {
    defaultDispatcher = new Agent({
      connect: {
        secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
      },
    });
  }
  return defaultDispatcher;
};

/** 当前手动代理地址；off 或配置无效时返回 null，保持原生直连行为 */
export const getNetworkProxyUrl = (): string | null => {
  const config = store.get("system.networkProxy");
  if (!isManualProxyProtocol(config.protocol)) return null;
  const host = config.host.trim();
  const port = Number(config.port);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return `${config.protocol}://${host}:${port}`;
};

const getProxyDispatcher = (): Dispatcher => {
  const url = getNetworkProxyUrl();
  if (!url) return getDefaultDispatcher();
  if (!proxyAgent || proxyAgentUrl !== url) {
    proxyAgent?.close().catch(() => {});
    proxyAgent = url.startsWith("socks5://") ? new Socks5ProxyAgent(url) : new ProxyAgent(url);
    proxyAgentUrl = url;
    systemLog.info(`[proxy] node fetch proxy=${url}`);
  }
  return proxyAgent;
};

/** Node fetch 包装：统一使用 undici 并注入支持 legacy SSL 的 dispatcher */
export const fetchWithProxy = (input: string | URL, init?: RequestInit): Promise<Response> => {
  const dispatcher = getProxyDispatcher();
  return undiciFetch(input, { ...(init as RequestInit), dispatcher } as Parameters<
    typeof undiciFetch
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
