/**
 * lx-music-desktop user_api 脚本兼容兼容层
 *
 * 在沙箱里注入 `window.lx` / `globalThis.lx`，把 lx 的 `EVENT_NAMES` / `request` / `on` / `send` / `utils`
 * / `currentScriptInfo` / `version` / `env` 桥接到 splayer 宿主 API。
 *
 * 被 host.worker.ts 导入，运行在 utilityProcess + vm.Context 外层（注入前）。
 */

import crypto from "node:crypto";
import zlib from "node:zlib";
import type {
  HostApi,
  MusicUrlReq,
  MusicUrlRes,
  PluginAction,
  PluginQuality,
  PluginUpdateInfo,
  SourceCapability,
} from "@shared/types/plugin";

/**
 * lx 原生音质枚举 → 宿主 PluginQuality 的映射
 * 兼容 128k/320k/flac/flac24bit 以及各类别名
 */
const LX_TO_HOST_QUALITY: Record<string, PluginQuality> = {
  "128k": "lq",
  "128": "lq",
  standard: "lq",
  "192k": "sq",
  "192": "sq",
  "320k": "hq",
  "320": "hq",
  high: "hq",
  hq: "hq",
  flac: "lossless",
  ape: "lossless",
  wav: "lossless",
  lossless: "lossless",
  sq: "lossless",
  flac24bit: "hi-res",
  hires: "hi-res",
  "hi-res": "hi-res",
};

const HOST_TO_LX_QUALITY: Record<PluginQuality, string> = {
  lq: "128k",
  sq: "192k",
  hq: "320k",
  lossless: "flac",
  "hi-res": "flac24bit",
};

const mapLxQualityToHost = (q: string): PluginQuality | null =>
  LX_TO_HOST_QUALITY[String(q).toLowerCase()] ?? null;

const mapHostQualityToLx = (q: PluginQuality): string => HOST_TO_LX_QUALITY[q] ?? "320k";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

/** 规范化输入为标准的 Uint8Array / Buffer */
const toBuffer = (val: unknown): Buffer => {
  if (Buffer.isBuffer(val)) return val;
  if (val instanceof Uint8Array || val instanceof ArrayBuffer)
    return Buffer.from(val as ArrayBuffer);
  if (Array.isArray(val)) return Buffer.from(val as number[]);
  if (typeof val === "string") return Buffer.from(val, "utf-8");
  return Buffer.alloc(0);
};

/** lx.utils — 参数签名与 lx-music 脚本完全兼容 */
const buildLxUtils = (): object => ({
  crypto: {
    aesEncrypt: (
      buffer: Buffer | Uint8Array | number[],
      mode: string,
      key: Buffer | Uint8Array | number[],
      iv?: Buffer | Uint8Array | number[],
    ): Buffer => {
      const buf = toBuffer(buffer);
      const keyBuf = toBuffer(key);
      const ivBuf = iv ? toBuffer(iv) : null;
      const cipher = crypto.createCipheriv(mode, keyBuf, ivBuf);
      return Buffer.concat([cipher.update(buf), cipher.final()]);
    },
    rsaEncrypt: (buffer: Buffer | Uint8Array | number[], key: string): Buffer => {
      const buf = toBuffer(buffer);
      const padded = buf.length < 128 ? Buffer.concat([Buffer.alloc(128 - buf.length), buf]) : buf;
      return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, padded);
    },
    randomBytes: (size: number): Buffer => crypto.randomBytes(size),
    md5: (str: string | Uint8Array | number[]): string =>
      crypto
        .createHash("md5")
        .update(typeof str === "string" ? str : toBuffer(str))
        .digest("hex"),
  },
  buffer: {
    from: (
      data: ArrayBuffer | SharedArrayBuffer | string | Uint8Array | number[],
      encoding?: BufferEncoding,
    ): Buffer =>
      typeof data === "string" ? Buffer.from(data, encoding) : Buffer.from(data as ArrayBuffer),
    bufToString: (
      buf: Buffer | Uint8Array | string | number[],
      format: BufferEncoding = "utf-8",
    ): string => {
      if (typeof buf === "string") return Buffer.from(buf, "binary").toString(format);
      return toBuffer(buf).toString(format);
    },
  },
  zlib: {
    inflate: (buf: Buffer | Uint8Array | number[]): Promise<Buffer> =>
      new Promise((resolve, reject) => {
        zlib.inflate(toBuffer(buf), (err, data) => {
          if (err) reject(new Error(err.message));
          else resolve(data);
        });
      }),
    deflate: (data: Buffer | Uint8Array | string | number[]): Promise<Buffer> =>
      new Promise((resolve, reject) => {
        zlib.deflate(toBuffer(data), (err, buf) => {
          if (err) reject(new Error(err.message));
          else resolve(buf);
        });
      }),
  },
});

/** LX 歌曲信息结构 */
export interface LxMusicInfo {
  id: string;
  songmid: string;
  songId: string;
  name: string;
  singer: string;
  source: string;
  interval: string | null;
  img: string | null;
  lrc: string | null;
  otherSource: unknown;
  types: string[];
  _types: Record<string, unknown>;
  typeUrl: Record<string, unknown>;
  hash?: string;
  strMediaMid?: string;
  copyrightId?: string;
  albumId: string;
  albumName: string;
  meta: {
    songId: string;
    albumName: string;
    albumId: string;
    picUrl: string | null;
    hash?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** 将宿主传入的 musicInfo 归一化 */
export const normalizeLxMusicInfo = (
  raw: MusicUrlReq["musicInfo"] | undefined,
  source: string,
): LxMusicInfo => {
  const info = raw ?? { songmid: "" };
  const meta =
    typeof info.meta === "object" && info.meta !== null
      ? (info.meta as Record<string, unknown>)
      : {};
  const id = String(info.id ?? info.songmid ?? info.songId ?? meta.songId ?? "");
  const name = String(info.name ?? info.title ?? "");
  const singer = String(info.singer ?? info.artist ?? "");
  const albumName = String(info.albumName ?? meta.albumName ?? "");
  const albumId = String(info.albumId ?? meta.albumId ?? "");
  const interval = typeof info.interval === "string" ? info.interval : null;
  const img = (info.img ?? info.pic ?? meta.picUrl ?? null) as string | null;

  const rawHash = info.hash ?? meta.hash;
  const isKg = source === "kg" || source === "kugou";
  const hash =
    typeof rawHash === "string" && rawHash.trim().length > 0
      ? rawHash.trim()
      : isKg && id.length === 32 && /^[0-9a-fA-F]{32}$/.test(id)
        ? id
        : undefined;

  const rawStrMediaMid = info.strMediaMid ?? meta.strMediaMid;
  const strMediaMid =
    typeof rawStrMediaMid === "string" && rawStrMediaMid.trim().length > 0
      ? rawStrMediaMid.trim()
      : source === "tx" || source === "qqmusic"
        ? id
        : undefined;

  const rawCopyrightId = info.copyrightId ?? meta.copyrightId;
  const copyrightId =
    typeof rawCopyrightId === "string" && rawCopyrightId.trim().length > 0
      ? rawCopyrightId.trim()
      : undefined;

  const resMeta: Record<string, unknown> = {
    ...meta,
    songId: id,
    albumName,
    albumId,
    picUrl: img,
  };
  if (hash) {
    resMeta.hash = hash;
  } else {
    delete resMeta.hash;
  }

  const result: LxMusicInfo = {
    ...info,
    name,
    singer,
    source,
    songmid: id,
    id,
    songId: id,
    albumId,
    albumName,
    interval,
    img,
    lrc: (info.lrc as string | null | undefined) ?? null,
    otherSource: info.otherSource ?? null,
    types: Array.isArray(info.types) ? (info.types as string[]) : [],
    _types:
      typeof info._types === "object" && info._types !== null
        ? (info._types as Record<string, unknown>)
        : {},
    typeUrl: {},
    meta: resMeta as LxMusicInfo["meta"],
  };

  if (hash) {
    result.hash = hash;
  } else {
    delete (result as Record<string, unknown>).hash;
  }
  if (strMediaMid) {
    result.strMediaMid = strMediaMid;
  } else {
    delete (result as Record<string, unknown>).strMediaMid;
  }
  if (copyrightId) {
    result.copyrightId = copyrightId;
  } else {
    delete (result as Record<string, unknown>).copyrightId;
  }

  return result;
};

/**
 * 安装 lx 兼容层
 * @param sandboxGlobal 沙箱上下文对象（vm.createContext 前的 plain object）
 * @param splayer 宿主 API 实例
 * @param handlers 共享的 action handler 注册表
 * @param onSources 脚本通过 lx.send('inited', {sources}) 注册能力时的回调
 * @param onUpdateAvailable 脚本通过 lx.send('updateAlert', ...) 上报新版本时的回调
 * @param scriptInfo lx 脚本 currentScriptInfo（主进程解析完头注释后传入）
 */
export const installLxShim = (
  sandboxGlobal: Record<string, unknown>,
  splayer: HostApi,
  handlers: Map<PluginAction, (req: unknown) => Promise<unknown>>,
  onSources: (sources: Record<string, SourceCapability>) => void,
  onUpdateAvailable: (info: PluginUpdateInfo) => void,
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
      // headers 强制转纯字符串字典，避免脚本传 Proxy / 带函数的对象触发结构化克隆失败
      const headers: Record<string, string> = {};
      const rawHeaders = (o.headers as Record<string, unknown> | undefined) ?? {};
      for (const [k, v] of Object.entries(rawHeaders)) {
        if (typeof v === "string") headers[k] = v;
        else if (v != null) headers[k] = String(v);
      }
      // form/formData 在 needle 里会被 urlencode/multipart 序列化
      // 这里 body 优先，其次 form/formData 走 URLSearchParams 序列化并补 content-type
      const rawBody = o.body;
      const rawForm = (o.form ?? o.formData) as Record<string, unknown> | undefined;
      let body: string | Uint8Array | ArrayBuffer | undefined;
      let formContentType: string | undefined;
      if (rawBody != null) {
        if (typeof rawBody === "string") body = rawBody;
        else if (rawBody instanceof Uint8Array || rawBody instanceof ArrayBuffer) body = rawBody;
        else if (typeof rawBody === "object") {
          try {
            body = JSON.stringify(rawBody);
          } catch {
            body = undefined;
          }
        }
      } else if (rawForm && typeof rawForm === "object") {
        const usp = new URLSearchParams();
        for (const [field, value] of Object.entries(rawForm)) {
          if (value == null) continue;
          usp.append(field, String(value));
        }
        body = usp.toString();
        formContentType = "application/x-www-form-urlencoded";
      }
      // 注入默认 User-Agent，避免反爬接口直接拦截
      const hasUserAgent = Object.keys(headers).some((k) => k.toLowerCase() === "user-agent");
      if (!hasUserAgent) {
        headers["User-Agent"] = DEFAULT_USER_AGENT;
      }

      // 默认 content-type 放前面，让用户传的 headers 仍能覆盖
      const finalHeaders: Record<string, string> = formContentType
        ? { "content-type": formContentType, ...headers }
        : headers;
      let aborted = false;

      const safeCallback: LxRequestCallback = (err, resp, body) => {
        if (aborted) return;
        try {
          callback(err, resp, body);
        } catch (cbErr) {
          splayer.log.error("[lx-shim] request callback threw:", (cbErr as Error)?.message);
        }
      };

      splayer
        .request(url, {
          method,
          headers: finalHeaders,
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
          safeCallback(
            null,
            {
              statusCode: resp.status,
              statusMessage: resp.status === 200 ? "OK" : "",
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
          safeCallback(err, undefined, null);
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
              const actions = (cap.actions ?? []).filter(
                (action): action is PluginAction => action === "musicUrl",
              );
              // 不支持任何宿主已识别动作的源直接丢弃，避免 audioSource 误把
              // lyric-only 脚本当成 musicUrl 候选去调，结果走到归一校验抛 PLUGIN_INVALID_RESULT
              if (actions.length === 0) continue;
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
            // 上报给宿主，由 UI 层展示"有更新"徽章与打开下载链接按钮；
            // 不再落日志（脚本通常会自己 console.log，重复输出无意义）
            onUpdateAvailable({
              log: typeof data?.log === "string" ? (data.log as string) : undefined,
              updateUrl:
                typeof data?.updateUrl === "string" ? (data.updateUrl as string) : undefined,
              version: typeof data?.version === "string" ? (data.version as string) : undefined,
              updatedAt: Date.now(),
            });
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
  if (typeof sandboxGlobal.window === "object" && sandboxGlobal.window !== null) {
    (sandboxGlobal.window as Record<string, unknown>).lx = lxApi;
  } else {
    sandboxGlobal.window = sandboxGlobal;
  }

  // 为每个 action 安装一个通用分派器：把 router 的 call 转译成 lx 的 request 形状
  const registerAction = (action: PluginAction): void => {
    handlers.set(action, async (req: unknown) => {
      if (!requestHandler) {
        splayer.log.warn("[lx-shim] no request handler registered for action", action);
        throw Object.assign(new Error("lx plugin has not registered request handler"), {
          code: "PLUGIN_NOT_READY",
        });
      }
      const reqObj = req as MusicUrlReq;
      const source = reqObj.source ?? "";
      // lx 期待 128k/320k/flac/... 音质字符串，宿主的 quality 做一次翻译
      const hostQuality = reqObj.quality;
      const lxType = hostQuality ? mapHostQualityToLx(hostQuality) : undefined;
      const info = {
        type: lxType,
        musicInfo: normalizeLxMusicInfo(reqObj.musicInfo, source),
      };
      const raw = await Promise.resolve(requestHandler({ source, action, info }));
      // 严格归一为 { url }，避免脚本回包夹带闭包/Proxy 导致 postMessage 克隆失败
      if (typeof raw === "string") return { url: raw } as MusicUrlRes;
      if (raw && typeof raw === "object") {
        const url = (raw as Record<string, unknown>).url;
        if (typeof url === "string") return { url } as MusicUrlRes;
      }
      throw Object.assign(new Error("lx plugin returned invalid musicUrl result"), {
        code: "PLUGIN_INVALID_RESULT",
      });
    });
  };

  (["musicUrl"] as PluginAction[]).forEach(registerAction);
};
