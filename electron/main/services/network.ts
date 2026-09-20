import { app, net, session, type Session } from "electron";
import { inspect } from "node:util";
import { setGlobalDispatcher } from "undici";
import { store } from "@main/store";
import { systemLog } from "@main/utils/logger";
import {
  applyIPv4Preference,
  getNetworkProxyUrl,
  resetNetworkDispatchers,
} from "@main/utils/proxy";
import { ConnectionGateway, GATEWAY_CHECK_URL } from "@main/utils/connectionGateway";

const proxyKeys = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
];
const sessions = new Set<WeakRef<Session>>();
const sessionCleanup = new FinalizationRegistry<WeakRef<Session>>((ref) => sessions.delete(ref));
let browserGateway: ConnectionGateway | undefined;
let nativeGateway: ConnectionGateway | undefined;
let changes = Promise.resolve();
let active = false;

/** 关闭代理即直连，不继承系统代理、PAC 或环境变量。 */
const resolveAppProxy = async (): Promise<string[]> => [getNetworkProxyUrl() ?? "DIRECT"];

/** 为会话设置连接层，清理切换前的连接以应用新的地址族顺序。 */
const configureSession = async (ses: Session, resetConnections = true): Promise<void> => {
  if (active) {
    await ses.setProxy({
      mode: "fixed_servers",
      proxyRules: `http://127.0.0.1:${browserGateway!.port}`,
      proxyBypassRules: "<-loopback>",
    });
  } else {
    await ses.setProxy({ mode: "direct" });
  }
  if (resetConnections) await ses.closeAllConnections();
  if (active) {
    // net.fetch 不处理代理认证回调，预先通过 net.request 为此会话建立认证缓存。
    await new Promise<void>((resolve, reject) => {
      const request = net.request({ url: GATEWAY_CHECK_URL, session: ses });
      request.on("login", (_auth, callback) =>
        callback(browserGateway!.username, browserGateway!.password),
      );
      request.once("error", reject);
      request.once("response", (response) => {
        response.on("data", () => {});
        response.once("end", () => {
          if (response.statusCode === 204) resolve();
          else reject(new Error(`连接层认证失败: ${response.statusCode}`));
        });
      });
      request.end();
    });
  }
};

/** 在创建窗口、加载原生引擎之前初始化所有网络栈的连接策略。 */
export const initializeNetwork = async (): Promise<void> => {
  browserGateway = new ConnectionGateway({
    resolveProxy: resolveAppProxy,
    onError: (host, error) =>
      systemLog.warn(`[network] Chromium ${host} connection failed`, inspect(error, { depth: 5 })),
    onConnect: (host, socket, proxied) =>
      systemLog.debug(
        `[network] Chromium ${host} via=${proxied ? "proxy" : "direct"} remote=${socket.remoteAddress} family=${socket.remoteFamily}`,
      ),
  });
  nativeGateway = new ConnectionGateway({
    onError: (host, error) =>
      systemLog.warn(`[network] native ${host} connection failed`, inspect(error, { depth: 5 })),
    resolveProxy: resolveAppProxy,
    onConnect: (host, socket, proxied) =>
      systemLog.debug(
        `[network] native ${host} via=${proxied ? "proxy" : "direct"} remote=${socket.remoteAddress} family=${socket.remoteFamily}`,
      ),
  });
  await Promise.all([browserGateway.listen(), nativeGateway.listen()]);
  app.on("login", (event, _contents, _details, auth, callback) => {
    if (auth.isProxy && auth.host === "127.0.0.1" && auth.port === browserGateway!.port) {
      event.preventDefault();
      callback(browserGateway!.username, browserGateway!.password);
    }
  });
  const existing = [
    session.defaultSession,
    session.fromPartition("persist:main"),
    session.fromPartition("persist:netease-login"),
  ];
  for (const ses of existing) {
    const ref = new WeakRef(ses);
    sessions.add(ref);
    sessionCleanup.register(ses, ref);
  }
  app.on("session-created", (ses) => {
    const ref = new WeakRef(ses);
    sessions.add(ref);
    sessionCleanup.register(ses, ref);
    const ready = configureSession(ses, false);
    // setProxy 异步完成；先拦住首个请求，防止认证发生在会话配置就绪之前。
    ses.webRequest.onBeforeRequest((details, callback) => {
      if (details.url === GATEWAY_CHECK_URL) callback({});
      else
        void ready.then(
          () => callback({}),
          () => callback({ cancel: true }),
        );
    });
    void ready.then(
      () => ses.webRequest.onBeforeRequest(null),
      (error) => systemLog.error("[network] 配置会话失败", error),
    );
  });
  await applyNetworkPreferences();
};

/** 串行应用切换、重置和配置导入，调用方等待所有网络栈完成同步。 */
export const applyNetworkPreferences = (): Promise<void> => {
  changes = changes
    .catch(() => {})
    .then(async () => {
      applyIPv4Preference();
      const preferIPv4 = store.get("system.preferIPv4");
      active = preferIPv4 || getNetworkProxyUrl() !== null;
      if (!browserGateway || !nativeGateway) return;
      setGlobalDispatcher(resetNetworkDispatchers());
      browserGateway.resetConnections();
      nativeGateway.resetConnections();
      // 原生客户端缓存代理配置，固定经过应用连接层，让每次请求都服从当前设置。
      for (const key of proxyKeys) {
        process.env[key] = key.toLowerCase() === "no_proxy" ? "" : nativeGateway.url;
      }
      const pending: Promise<void>[] = [];
      for (const ref of sessions) {
        const ses = ref.deref();
        if (ses) pending.push(configureSession(ses));
        else sessions.delete(ref);
      }
      await Promise.all(pending);
      systemLog.info(
        `[network] IPv4 preference=${preferIPv4}, proxy=${getNetworkProxyUrl() ?? "off (direct)"}, applied to Node, Chromium and native HTTP`,
      );
    });
  return changes;
};

/** 关闭应用自有的回环监听器和连接。 */
export const closeNetwork = (): void => {
  browserGateway?.close();
  nativeGateway?.close();
};
