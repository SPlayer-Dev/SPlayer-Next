/**
 * lx-music-desktop user_api 脚本兼容垫片
 *
 * 在沙箱里注入 `window.lx` / `globalThis.lx`，把 lx 的 `EVENT_NAMES` / `request` / `on` / `send` / `utils`
 * / `currentScriptInfo` / `version` / `env` 桥接到 splayer 宿主 API。
 *
 * 被 sandbox.worker.ts 导入，运行在 utilityProcess + vm.Context 外层（注入前）。
 */

import crypto from "node:crypto";
import zlib from "node:zlib";
import type { HostApi, PluginAction, PluginQuality, SourceCapability } from "@shared/types/plugin";

/**
 * lx 原生音质枚举 → 宿主 PluginQuality 的映射
 * lx 用 128k/192k/320k/flac/flac24bit/ape/wav 这种具体编码描述，
 * 宿主按 lq/sq/hq/lossless/hi-res 等级分类，两端做一次转换即可对齐
 */
const LX_TO_HOST_QUALITY: Record<string, PluginQuality> = {
  "128k": "lq",
  "192k": "sq",
  "320k": "hq",
  flac: "lossless",
  ape: "lossless",
  wav: "lossless",
  flac24bit: "hi-res",
};

const HOST_TO_LX_QUALITY: Record<PluginQuality, string> = {
  lq: "128k",
  sq: "192k",
  hq: "320k",
  lossless: "flac",
  "hi-res": "flac24bit",
};

const mapLxQualityToHost = (q: string): PluginQuality | null => LX_TO_HOST_QUALITY[q] ?? null;

const mapHostQualityToLx = (q: PluginQuality): string => HOST_TO_LX_QUALITY[q] ?? "320k";

const EVENT_NAMES = {
  request: "request",
  inited: "inited",
  updateAlert: "updateAlert",
} as const;

const eventNames: readonly string[] = Object.values(EVENT_NAMES);

/** lx.request 回调签名（与 lx-music-desktop preload 对齐） */
type LxRequestCallback = (
  err: Error | null,
  resp?: {
    statusCode: number;
    statusMessage?: string;
    headers: Record<string, string>;
    bytes?: number;
    raw?: Buffer;
    body?: unknown;
  },
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

/** lx.utils — 对齐 lx-music-desktop 的签名（不同于 splayer.utils） */
const buildLxUtils = (): object => ({
  crypto: {
    // 注意：lx 的参数顺序是 (buffer, mode, key, iv)，与我们自家 splayer.utils 不同
    aesEncrypt: (
      buffer: Buffer | Uint8Array,
      mode: string,
      key: Buffer | Uint8Array,
      iv: Buffer | Uint8Array,
    ): Buffer => {
      const cipher = crypto.createCipheriv(mode, key as crypto.CipherKey, iv as crypto.BinaryLike);
      return Buffer.concat([cipher.update(Buffer.from(buffer)), cipher.final()]);
    },
    rsaEncrypt: (buffer: Buffer | Uint8Array, key: string): Buffer => {
      // lx 行为：先左填充 0 到 128 字节，再用 RSA_NO_PADDING 加密
      const padded = Buffer.concat([Buffer.alloc(128 - buffer.length), Buffer.from(buffer)]);
      return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, padded);
    },
    randomBytes: (size: number): Buffer => crypto.randomBytes(size),
    md5: (str: string | Uint8Array): string =>
      crypto
        .createHash("md5")
        .update(str as crypto.BinaryLike)
        .digest("hex"),
  },
  buffer: {
    from: (
      data: ArrayBuffer | SharedArrayBuffer | string | Uint8Array | number[],
      encoding?: BufferEncoding,
    ): Buffer =>
      typeof data === "string" ? Buffer.from(data, encoding) : Buffer.from(data as ArrayBuffer),
    bufToString: (buf: Buffer | Uint8Array | string, format: BufferEncoding): string =>
      typeof buf === "string"
        ? Buffer.from(buf, "binary").toString(format)
        : Buffer.from(buf).toString(format),
  },
  zlib: {
    // lx 的 zlib API 是异步 Promise 版本
    inflate: (buf: Buffer | Uint8Array): Promise<Buffer> =>
      new Promise((resolve, reject) => {
        zlib.inflate(buf, (err, data) => {
          if (err) reject(new Error(err.message));
          else resolve(data);
        });
      }),
    deflate: (data: Buffer | Uint8Array | string): Promise<Buffer> =>
      new Promise((resolve, reject) => {
        zlib.deflate(data, (err, buf) => {
          if (err) reject(new Error(err.message));
          else resolve(buf);
        });
      }),
  },
});

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
  let updateAlerted = false;

  const lxApi = {
    EVENT_NAMES,
    version: "2.0.0",
    env: "desktop",

    request(
      url: string,
      opts: Record<string, unknown> | undefined,
      callback: LxRequestCallback,
    ): () => void {
      const o = opts ?? {};
      const method = ((o.method as string) ?? "GET").toUpperCase() as "GET" | "POST";
      const timeout = typeof o.timeout === "number" ? (o.timeout as number) : undefined;
      const headers = (o.headers as Record<string, string>) ?? {};
      const body = (o.body ?? o.form ?? o.formData) as
        | string
        | Uint8Array
        | ArrayBuffer
        | undefined;

      let aborted = false;

      splayer
        .request(url, {
          method,
          headers,
          body,
          timeout,
          responseType: "text",
        })
        .then((resp) => {
          if (aborted) return;
          const rawText = typeof resp.body === "string" ? (resp.body as string) : "";
          let parsedBody: unknown = rawText;
          try {
            parsedBody = JSON.parse(rawText);
          } catch {
            /* 保留原字符串 */
          }
          const raw = Buffer.from(rawText, "utf-8");
          callback(
            null,
            {
              statusCode: resp.status,
              statusMessage: "",
              headers: resp.headers,
              bytes: raw.byteLength,
              raw,
              body: parsedBody,
            },
            parsedBody,
          );
        })
        .catch((err: Error) => {
          if (aborted) return;
          callback(err);
        });

      // lx 返回一个 abort 函数；当前无法真正取消底层 fetch，置 aborted 丢弃结果
      return () => {
        aborted = true;
      };
    },

    on(eventName: string, handler: LxRequestHandler): Promise<void> {
      if (!eventNames.includes(eventName)) {
        return Promise.reject(new Error("The event is not supported: " + eventName));
      }
      if (eventName === EVENT_NAMES.request) {
        requestHandler = handler;
        return Promise.resolve();
      }
      return Promise.reject(new Error("The event is not supported: " + eventName));
    },

    send(eventName: string, data: Record<string, unknown>): Promise<void> {
      return new Promise((resolve, reject) => {
        if (!eventNames.includes(eventName)) {
          reject(new Error("The event is not supported: " + eventName));
          return;
        }
        switch (eventName) {
          case EVENT_NAMES.inited: {
            if (inited) {
              reject(new Error("Script is inited"));
              return;
            }
            inited = true;
            // lx 脚本上报的 sources.qualitys / qualities 是 lx 原生音质字符串，
            // 转成宿主 PluginQuality 去重后再注册给 router
            const rawSources =
              (data?.sources as Record<
                string,
                {
                  name?: string;
                  actions?: string[];
                  qualitys?: string[];
                  qualities?: string[];
                  [key: string]: unknown;
                }
              >) ?? {};
            const normalized: Record<string, SourceCapability> = {};
            for (const [key, cap] of Object.entries(rawSources)) {
              const rawQualities = cap.qualitys ?? cap.qualities ?? [];
              const mapped = new Set<PluginQuality>();
              for (const q of rawQualities) {
                const host = mapLxQualityToHost(q);
                if (host) mapped.add(host);
              }
              // lx 只支持 musicUrl/lyric/pic，过滤掉其他值
              const actions = (cap.actions ?? []).filter(
                (a): a is PluginAction => a === "musicUrl" || a === "lyric" || a === "pic",
              );
              normalized[key] = {
                name: cap.name ?? key,
                actions,
                qualities: Array.from(mapped),
              };
            }
            onSources(normalized);
            resolve();
            return;
          }
          case EVENT_NAMES.updateAlert: {
            if (updateAlerted) {
              reject(new Error("The update alert can only be called once."));
              return;
            }
            updateAlerted = true;
            splayer.log.info("[lx] updateAlert:", data);
            resolve();
            return;
          }
          default:
            reject(new Error("Unknown event name: " + eventName));
        }
      });
    },

    utils: buildLxUtils(),

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
      // lx 对 musicUrl/lyric/pic 统一传 { type, musicInfo }
      // 宿主的 quality 是 lq/sq/hq/lossless/hi-res，lx 脚本期待 128k/320k/flac/... 做一次翻译
      const hostQuality = reqObj.quality as PluginQuality | undefined;
      const info: Record<string, unknown> = {
        type: hostQuality ? mapHostQualityToLx(hostQuality) : undefined,
        musicInfo: reqObj.musicInfo ?? {},
      };

      const raw = await Promise.resolve(requestHandler({ source, action, info }));

      // 转换返回值以对齐 splayer HostApi 的响应形状
      switch (action) {
        case "musicUrl":
        case "pic":
          if (typeof raw === "string") return { url: raw };
          return raw;
        default:
          return raw;
      }
    });
  };

  (["musicUrl", "lyric", "pic"] as PluginAction[]).forEach(registerAction);
};
