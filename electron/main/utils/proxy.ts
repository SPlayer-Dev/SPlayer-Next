import { getDefaultResultOrder, setDefaultResultOrder } from "node:dns";
import { store } from "@main/store";
import { systemLog } from "@main/utils/logger";
import { fetch as undiciFetch, Agent, ProxyAgent, Socks5ProxyAgent } from "undici";
import type { Dispatcher } from "undici";
import crypto from "node:crypto";

const PROXY_TEST_URL = "https://www.baidu.com";
const defaultDnsResultOrder = getDefaultResultOrder();

let proxyAgent: Dispatcher | null = null;
let proxyAgentUrl = "";
let ipv4Agent: Agent | null = null;
let defaultDispatcher: Dispatcher | null = null;

const isManualProxyProtocol = (value: string): value is "http" | "https" | "socks5" =>
  value === "http" || value === "https" || value === "socks5";

/** 应用新建连接的地址族优先级，关闭时恢复进程启动时的解析顺序 */
export const applyIPv4Preference = (): void => {
  const order = store.get("system.preferIPv4") ? "ipv4first" : defaultDnsResultOrder;
  setDefaultResultOrder(order);
  systemLog.info(`[network] DNS address order=${order}`);
};

/** 默认直连 dispatcher（允许 legacy renegotiation） */
const getDefaultDispatcher = (): Dispatcher => {
  if (!defaultDispatcher) {
    defaultDispatcher = new Agent({
      connect: {
        autoSelectFamily: true,
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

const getProxyDispatcher = (): Dispatcher | undefined => {
  const url = getNetworkProxyUrl();
  if (!url) return undefined;
  if (!proxyAgent || proxyAgentUrl !== url) {
    proxyAgent?.close().catch(() => {});
    proxyAgent = url.startsWith("socks5://") ? new Socks5ProxyAgent(url) : new ProxyAgent(url);
    proxyAgentUrl = url;
    systemLog.info(`[proxy] node fetch proxy=${url}`);
  }
  return proxyAgent;
};

/** 丢弃旧连接池，显式选择应用代理或直连，避免全局 fetch 继承环境代理。 */
export const resetNetworkDispatchers = (): Dispatcher => {
  for (const agent of [proxyAgent, defaultDispatcher, ipv4Agent]) {
    void agent?.destroy().catch(() => {});
  }
  proxyAgent = null;
  proxyAgentUrl = "";
  ipv4Agent = null;
  defaultDispatcher = null;
  return getProxyDispatcher() ?? getDefaultDispatcher();
};

/**
 * 按应用配置发送请求，直连重试时可回退到 IPv4
 * @param input - 请求地址
 * @param init - 请求选项
 * @param ipv4Only - 仅在没有手动代理时使用 IPv4，不改变代理服务器的解析策略
 * @returns HTTP 响应
 */
export const fetchWithProxy = (
  input: string | URL,
  init?: RequestInit,
  ipv4Only = false,
): Promise<Response> => {
  let dispatcher = getProxyDispatcher();
  if (!dispatcher && ipv4Only) {
    // 复用连接池；Undici 在空闲连接断开后移除对应域名的池。
    dispatcher = ipv4Agent ??= new Agent({
      connect: {
        family: 4,
        autoSelectFamily: false,
        secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
      },
    });
  }
  dispatcher ??= getDefaultDispatcher();
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
