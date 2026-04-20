/**
 * lx-music-desktop user_api 脚本兼容垫片
 *
 * 在沙箱里注入 `window.lx` / `globalThis.lx`，把 lx 的 `request` / `on` / `send` 桥接到
 * splayer 的 Host API 上。
 *
 * 被 sandbox.worker.ts 导入，运行在 utilityProcess + vm.Context 外层（注入前）。
 */

import type { HostApi, PluginAction, SourceCapability } from "@shared/types/plugin";

/** lx.request 回调签名 */
type LxRequestCallback = (
  err: Error | null,
  resp?: { statusCode: number; headers: Record<string, string> },
  body?: unknown,
) => void;

/** lx.on('request', handler) 的 handler 形状 */
type LxRequestHandler = (req: {
  source: string;
  action: string;
  info: Record<string, unknown>;
}) => unknown | Promise<unknown>;

export interface LxCurrentScriptInfo {
  name: string;
  description: string;
  version: string;
  author: string;
  homepage: string;
  rawScript: string;
}

/**
 * 安装 lx 垫片
 * @param sandboxGlobal 沙箱上下文对象（vm.createContext 前的 plain object）
 * @param splayer 宿主 API 实例
 * @param handlers 共享的 action handler 注册表
 * @param onSources 脚本通过 lx.send('inited', {sources}) 注册能力时的回调
 * @param scriptInfo lx 脚本 currentScriptInfo（主进程解析完头注释后传入）
 */
export const installLxShim = (
  sandboxGlobal: Record<string, unknown>,
  splayer: HostApi,
  handlers: Map<PluginAction, (req: unknown) => Promise<unknown>>,
  onSources: (sources: Record<string, SourceCapability>) => void,
  scriptInfo?: LxCurrentScriptInfo,
): void => {
  let requestHandler: LxRequestHandler | null = null;
  let inited = false;

  const lxApi = {
    version: "2.0.0",

    request(url: string, opts: Record<string, unknown>, callback: LxRequestCallback): void {
      splayer
        .request(url, {
          method: (opts?.method as "GET" | "POST") ?? "GET",
          headers: (opts?.headers as Record<string, string>) ?? {},
          body: opts?.body as string | Uint8Array | ArrayBuffer | undefined,
          timeout: (opts?.timeout as number) ?? undefined,
          responseType: (opts?.responseType as "text" | "json" | "arraybuffer") ?? "text",
        })
        .then((resp) => {
          callback(null, { statusCode: resp.status, headers: resp.headers }, resp.body);
        })
        .catch((err: Error) => callback(err));
    },

    on(eventName: string, handler: LxRequestHandler): void {
      if (eventName === "request") requestHandler = handler;
    },

    send(eventName: string, data: Record<string, unknown>): void {
      if (eventName === "inited" && !inited) {
        inited = true;
        const sources = (data?.sources as Record<string, SourceCapability>) ?? {};
        onSources(sources);
      } else if (eventName === "updateAlert") {
        splayer.log.info("[lx] updateAlert:", data);
      }
    },

    // lx.utils 形状和 splayer.utils 基本一致（crypto/buffer/zlib）
    // 直接复用（worker 把 utils 挂在了 splayer 对象上）
     
    utils: (splayer as any).utils,

    currentScriptInfo: scriptInfo ?? {
      name: "",
      description: "",
      version: "",
      author: "",
      homepage: "",
      rawScript: "",
    },
  };

  sandboxGlobal.lx = lxApi;
  // 部分脚本通过 window.lx 访问
  sandboxGlobal.window = { lx: lxApi };

  // 为每个 action 安装一个通用分派器：把 router 的 call 转译成 lx 的 request 形状
  const registerAction = (action: PluginAction): void => {
    handlers.set(action, async (req: unknown) => {
      if (!requestHandler) {
        throw Object.assign(new Error("lx plugin has not registered request handler"), {
          code: "PLUGIN_NOT_READY",
        });
      }
      const reqObj = req as Record<string, unknown>;
      const source = (reqObj.source as string) ?? "";
      let info: Record<string, unknown>;

      switch (action) {
        case "musicUrl":
          info = {
            type: reqObj.quality,
            musicInfo: reqObj.musicInfo ?? {},
          };
          break;
        case "lyric":
        case "pic":
        case "meta":
          info = { musicInfo: reqObj.musicInfo ?? {} };
          break;
        case "search":
          info = {
            keyword: reqObj.keyword,
            page: reqObj.page ?? 1,
            limit: reqObj.limit ?? 30,
          };
          break;
        default:
          info = reqObj;
      }

      const raw = await Promise.resolve(requestHandler({ source, action, info }));

      // 转换返回值以对齐 splayer HostApi 的响应形状
      switch (action) {
        case "musicUrl":
          if (typeof raw === "string") return { url: raw };
          return raw;
        case "pic":
          if (typeof raw === "string") return { url: raw };
          return raw;
        case "search": {
          if (Array.isArray(raw)) return { list: raw };
          return raw;
        }
        default:
          return raw;
      }
    });
  };

  (["search", "musicUrl", "lyric", "pic", "meta"] as PluginAction[]).forEach(registerAction);
};
