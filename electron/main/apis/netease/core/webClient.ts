import { app, session, type Session, type WebContents } from "electron";
import { getMainWindow } from "@main/window/main";
import { getNetworkProxyUrl } from "@main/utils/proxy";
import { neteaseLog } from "@main/utils/logger";
import { DOMAIN, UA_MAP, WEB_LOG_DOMAIN } from "./config";
import { cookieToJson } from "./cookie";
import { weapi } from "./crypto";
import { NeteaseRequestError, type RequestResponse } from "./response";
import type { RequestOptions } from "./request";
import { getWatchmanTokens, resetWatchman, resolveWatchmanRule } from "./watchman";

const REQUEST_TIMEOUT_MS = 45_000;
const MAX_PENDING_REQUESTS = 16;

interface ActiveRequest {
  contents: WebContents | null;
  cancel: (error: Error) => void;
  alive: boolean;
}

let webSession: Session | null = null;
let sessionDirty = true;
let generation = 0;
let pendingRequests = 0;
let queue: Promise<unknown> = Promise.resolve();
let activeRequest: ActiveRequest | null = null;
let quitting = false;

/** 取消旧账号的任务并清理业务会话，不关闭或重载主窗口 */
export const resetWebClientSession = (): void => {
  generation++;
  sessionDirty = true;
  activeRequest?.cancel(new Error("平台会话已变更，请求已取消"));
  void resetWatchman(getMainWindow()?.webContents ?? null).catch(() => {});
  if (webSession) {
    const ses = webSession;
    const resetGeneration = generation;
    queue = queue
      .then(async () => {
        if (resetGeneration !== generation) return;
        await ses.clearStorageData();
        if (resetGeneration === generation) sessionDirty = false;
      })
      .catch(() => neteaseLog.warn("网页业务会话清理失败"));
  }
};

app.once("before-quit", () => {
  quitting = true;
  resetWebClientSession();
});

/**
 * 统一排队网页写请求，按路径装配 SDK 凭据并直接返回业务结果
 * @param uri - 加密前的 API 路径
 * @param data - 业务模块提供的请求参数
 * @param options - 当前账号的请求配置
 * @returns 服务端业务响应与会话 Cookie，不重复发送业务写入
 */
export const requestWithWebClient = (
  uri: string,
  data: Record<string, unknown>,
  options: RequestOptions,
): Promise<RequestResponse> => {
  if (quitting) return Promise.reject(new Error("应用正在退出"));
  if (options.domain && options.domain !== DOMAIN && options.domain !== WEB_LOG_DOMAIN)
    return Promise.reject(new Error("网页业务出口无效"));
  if (pendingRequests >= MAX_PENDING_REQUESTS)
    return Promise.reject(new Error("平台请求过多，请稍后重试"));
  const requestGeneration = generation;
  pendingRequests++;
  const pending = queue.then(async () => {
    if (requestGeneration !== generation || quitting) throw new Error("平台会话已变更，请求已取消");
    const cookie =
      typeof options.cookie === "string" ? cookieToJson(options.cookie) : options.cookie || {};
    if (!cookie.MUSIC_U) {
      throw new NeteaseRequestError({
        status: 301,
        body: { code: 301, msg: "请先登录音乐平台" },
        cookie: [],
      });
    }
    const controller = new AbortController();
    let cancel!: (error: Error) => void;
    const canceled = new Promise<never>((_, reject) => {
      cancel = reject;
    });
    const operation: ActiveRequest = {
      contents: null,
      alive: true,
      cancel: (error) => {
        operation.alive = false;
        controller.abort(error);
        cancel(error);
        void resetWatchman(operation.contents).catch(() => {});
      },
    };
    activeRequest = operation;
    const timer = setTimeout(() => operation.cancel(new Error("平台请求超时")), REQUEST_TIMEOUT_MS);

    /** 任务取消或切换账号后，旧任务不能继续发送请求 */
    const ensureCurrent = (): void => {
      if (!operation.alive || requestGeneration !== generation || quitting)
        throw new Error("平台会话已变更，请求已取消");
    };
    /** 渲染环境失效时仅取消凭据任务，不关闭主窗口 */
    const onGone = (): void => operation.cancel(new Error("主窗口已退出，请求已取消"));
    /**
     * 主文档重载时取消任务，应用内部的同页路由继续使用原有环境
     * @param _event - 页面导航事件
     * @param _url - 导航目标地址
     * @param inPlace - 是否在当前文档内导航
     * @param isMainFrame - 是否为主文档
     */
    const onNavigation = (
      _event: Electron.Event,
      _url: string,
      inPlace: boolean,
      isMainFrame: boolean,
    ): void => {
      if (isMainFrame && !inPlace) operation.cancel(new Error("主窗口正在重载，请求已取消"));
    };

    /**
     * 业务和配置请求使用同一个原生会话，认证 Cookie 不进入 SDK 环境
     * @returns 服务端原始业务结果
     */
    const run = async (): Promise<RequestResponse> => {
      await Promise.race([app.whenReady(), canceled]);
      ensureCurrent();
      webSession ??= session.fromPartition("netease-web-api", { cache: false });
      const ses = webSession;
      if (sessionDirty) {
        await ses.clearStorageData();
        ensureCurrent();
        sessionDirty = false;
      }
      const proxy = getNetworkProxyUrl();
      const proxyConfig = proxy
        ? { mode: "fixed_servers" as const, proxyRules: proxy }
        : { mode: "direct" as const };
      await ses.setProxy(proxyConfig);
      ensureCurrent();
      const existing = await ses.cookies.get({ url: DOMAIN });
      for (const [name, value] of Object.entries(cookie)) {
        /** 保留服务端生成的状态，认证 Cookie 始终采用当前主进程会话 */
        if (
          !value ||
          (name !== "MUSIC_U" && name !== "__csrf" && existing.some((c) => c.name === name))
        )
          continue;
        await ses.cookies.set({ url: DOMAIN, name, value, path: "/", secure: true });
        ensureCurrent();
      }
      const mainContents = getMainWindow()?.webContents;
      const userAgent =
        mainContents && !mainContents.isDestroyed() ? mainContents.getUserAgent() : UA_MAP.weapi.pc;

      /**
       * 配置请求不经过凭据匹配，避免配置加载递归进入业务队列
       * @param path - API 路径
       * @param payload - 加密前的参数
       * @param antiCheatToken - SDK 第二次调用结果
       * @param domain - 业务出口，配置请求始终使用默认域名
       * @returns 已校验业务状态码的响应体
       */
      const send = async (
        path: string,
        payload: Record<string, unknown>,
        antiCheatToken?: string,
        domain = DOMAIN,
      ): Promise<Record<string, unknown>> => {
        ensureCurrent();
        const cookies = await ses.cookies.get({ url: DOMAIN });
        ensureCurrent();
        const csrf = cookies.find((c) => c.name === "__csrf")?.value ?? "";
        const body = new URLSearchParams(weapi({ ...payload, csrf_token: csrf })).toString();
        const url = new URL(path.replace(/^\/api\//, "/weapi/"), domain);
        url.searchParams.set("csrf_token", csrf);
        const headers: Record<string, string> = {
          "Content-Type": "application/x-www-form-urlencoded",
          "x-music-web-os": "web3",
          Origin: DOMAIN,
          /** 跨域请求只携带来源域名，避免被浏览器的来源策略拦截 */
          Referer: domain === DOMAIN ? `${DOMAIN}/st/webplayer` : `${DOMAIN}/`,
          "User-Agent": userAgent,
          Cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; "),
        };
        if (antiCheatToken) headers["X-antiCheatToken"] = antiCheatToken;
        const response = await ses.fetch(url.toString(), {
          method: "POST",
          credentials: "include",
          referrerPolicy: "strict-origin-when-cross-origin",
          headers,
          body,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        });
        let result: Record<string, unknown>;
        try {
          result = (await response.json()) as Record<string, unknown>;
          if (!result || typeof result !== "object" || Array.isArray(result))
            throw new Error("响应不是有效对象");
        } catch {
          throw new NeteaseRequestError({
            status: response.status >= 400 ? response.status : 502,
            body: { code: response.status >= 400 ? response.status : 502, msg: "平台响应解析失败" },
            cookie: [],
          });
        }
        ensureCurrent();
        if (response.status !== 200 || Number(result.code) !== 200) {
          throw new NeteaseRequestError({
            status: response.status === 200 ? Number(result.code) || 502 : response.status,
            body: result,
            cookie: [],
          });
        }
        return result;
      };

      const rule = await resolveWatchmanRule(uri, send);
      ensureCurrent();
      let payload = { ...data };
      let antiCheatToken: string | undefined;
      if (rule) {
        if (!mainContents || mainContents.isDestroyed()) throw new Error("主窗口尚未就绪");
        operation.contents = mainContents;
        mainContents.once("render-process-gone", onGone);
        mainContents.once("destroyed", onGone);
        mainContents.on("did-start-navigation", onNavigation);
        /** 采样和业务请求沿用同一代理出口，避免环境信息与请求出口不一致 */
        await mainContents.session.setProxy(proxyConfig);
        ensureCurrent();
        const tokens = await getWatchmanTokens({
          contents: mainContents,
          session: ses,
          ...rule,
          signal: controller.signal,
        });
        ensureCurrent();
        payload = { ...payload, ...tokens };
        antiCheatToken = tokens.checkToken;
      }
      const body = await send(uri, payload, antiCheatToken, options.domain || DOMAIN);
      const cookies = await ses.cookies.get({ url: DOMAIN });
      ensureCurrent();
      return { status: 200, body, cookie: cookies.map(({ name, value }) => `${name}=${value}`) };
    };

    const running = run();
    let succeeded = false;
    try {
      const result = await Promise.race([running, canceled]);
      succeeded = true;
      return result;
    } finally {
      operation.alive = false;
      clearTimeout(timer);
      if (!succeeded) controller.abort(new Error("请求任务已结束"));
      await running.catch(() => {});
      if (operation.contents && !operation.contents.isDestroyed()) {
        operation.contents.removeListener("render-process-gone", onGone);
        operation.contents.removeListener("destroyed", onGone);
        operation.contents.removeListener("did-start-navigation", onNavigation);
        if (!succeeded) await resetWatchman(operation.contents).catch(() => {});
      }
      if (activeRequest === operation) activeRequest = null;
    }
  });
  queue = pending.catch(() => {});
  return pending.finally(() => {
    pendingRequests--;
  });
};
