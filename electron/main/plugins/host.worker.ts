/**
 * 插件 host 子进程入口（utilityProcess fork 的唯一目标）
 *
 * 一个 host 进程托管所有已启用插件：每个插件一个 node:vm 上下文（按 pluginId 索引），
 * 共享一条 parentPort 与主进程通信。
 *
 * - 收到 loadPlugin：建 vm 上下文、注入 splayer、跑脚本、回 ready
 * - 收到 unloadPlugin：dispose 该上下文（清定时器/在途调用），不影响其它插件
 * - call/event/settingsUpdate/hostResult/cancel 按 pluginId 路由到对应上下文
 * - 单插件出错只 dispose 自己并回 fatal，不退进程
 *
 * 注意：本文件在 utilityProcess 里跑，没有 DOM / Electron，只有 Node。
 */

import vm from "node:vm";
import crypto from "node:crypto";
import zlib from "node:zlib";
import type {
  ActionIO,
  HostApi,
  HostCallMethod,
  HostRequestOptions,
  HostRequestResult,
  PluginAction,
  RegisterArgs,
  SandboxIn,
  SandboxOut,
  SourceCapability,
} from "@shared/types/plugin";
import { installLxShim } from "./lx-shim";

const parentPort: {
  on: (evt: "message", cb: (event: { data: SandboxIn }) => void) => void;
  postMessage: (msg: SandboxOut) => void;
} = (process as any).parentPort;

if (!parentPort) {
  process.exit(1);
}

/**
 * 深度剥离不可克隆字段
 * 保留 string/number/bool/null/Uint8Array/纯字典/数组；丢函数/symbol；
 * Buffer 转 Uint8Array、普通对象用 Object.create(null) 重建以脱掉 vm.Context 原型链
 * @param value - 任意值
 * @param depth - 递归深度上限
 */
const sanitizeForIpc = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return null;
  if (value == null) return value;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean" || t === "bigint") return value;
  if (t === "function" || t === "symbol") return undefined;
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeForIpc(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (t === "object") {
    const out: Record<string, unknown> = Object.create(null);
    try {
      for (const key of Object.keys(value as object)) {
        const cleaned = sanitizeForIpc((value as Record<string, unknown>)[key], depth + 1);
        if (cleaned !== undefined) out[key] = cleaned;
      }
    } catch {
      // Proxy 的 ownKeys 可能抛，直接返回空字典
    }
    return out;
  }
  return undefined;
};

/**
 * 跨 host→main 边界发消息
 * 直发；失败 → sanitize 后重发；仍失败 → 抛带 kind 上下文的错误
 * @param msg - 待发消息
 */
const send = (msg: SandboxOut): void => {
  try {
    parentPort.postMessage(msg);
    return;
  } catch {
    try {
      parentPort.postMessage(sanitizeForIpc(msg) as SandboxOut);
      return;
    } catch (err2) {
      throw new Error(`[host] postMessage failed for kind=${msg.kind}: ${(err2 as Error).message}`);
    }
  }
};

/** 单个插件在 host 内的运行记录 */
interface PluginContextRecord {
  pluginId: string;
  /** action → handler */
  handlers: Map<PluginAction, (req: unknown) => Promise<unknown>>;
  /** 高层播放事件回调表，key = PlaybackEventKind */
  playerEventHandlers: Map<string, ((data: unknown) => void)[]>;
  /** 设置变化回调表，key = setting key */
  settingChangeHandlers: Map<string, ((value: unknown) => void)[]>;
  /** 已注册 sources */
  registeredSources: Record<string, SourceCapability>;
  /** 在途 action 的 AbortController，key = requestId */
  inflight: Map<string, AbortController>;
  /** hostCall 回调登记，key = callId */
  hostCallWaiters: Map<string, { resolve: (v: unknown) => void; reject: (err: Error) => void }>;
  /** 用户设置缓存（getSetting 同步读） */
  userSettingsCache: Record<string, unknown>;
  /** 注入沙箱的定时器句柄，卸载时统一清除，避免泄露/继续运行 */
  timers: Set<NodeJS.Timeout>;
  immediates: Set<NodeJS.Immediate>;
  callSeq: number;
  disposed: boolean;
}

const plugins = new Map<string, PluginContextRecord>();

/** 调用主进程，返回 hostResult 的 data */
const hostCall = (
  record: PluginContextRecord,
  method: HostCallMethod,
  args: unknown[],
): Promise<unknown> => {
  const callId = `c${++record.callSeq}`;
  return new Promise<unknown>((resolve, reject) => {
    record.hostCallWaiters.set(callId, { resolve, reject });
    try {
      send({
        kind: "hostCall",
        pluginId: record.pluginId,
        callId,
        method,
        args: sanitizeForIpc(args) as unknown[],
      });
    } catch (err) {
      record.hostCallWaiters.delete(callId);
      reject(
        Object.assign(new Error((err as Error).message), { code: "PLUGIN_ARGS_NOT_CLONEABLE" }),
      );
    }
  });
};

/** 为某记录生成会登记句柄的定时器 API（卸载时统一清） */
const makeTimers = (record: PluginContextRecord): Record<string, unknown> => ({
  setTimeout: (cb: (...a: unknown[]) => void, ms?: number, ...args: unknown[]): NodeJS.Timeout => {
    const handle = setTimeout(() => {
      record.timers.delete(handle);
      cb(...args);
    }, ms);
    record.timers.add(handle);
    return handle;
  },
  setInterval: (cb: (...a: unknown[]) => void, ms?: number, ...args: unknown[]): NodeJS.Timeout => {
    const handle = setInterval(cb, ms, ...args);
    record.timers.add(handle);
    return handle;
  },
  clearTimeout: (handle?: NodeJS.Timeout): void => {
    if (handle) record.timers.delete(handle);
    clearTimeout(handle);
  },
  clearInterval: (handle?: NodeJS.Timeout): void => {
    if (handle) record.timers.delete(handle);
    clearInterval(handle);
  },
  setImmediate: (cb: (...a: unknown[]) => void, ...args: unknown[]): NodeJS.Immediate => {
    const handle = setImmediate(() => {
      record.immediates.delete(handle);
      cb(...args);
    });
    record.immediates.add(handle);
    return handle;
  },
  clearImmediate: (handle?: NodeJS.Immediate): void => {
    if (handle) record.immediates.delete(handle);
    clearImmediate(handle);
  },
});

type LoadSpec = Extract<SandboxIn, { kind: "loadPlugin" }>;

/** 构造注入某插件沙箱的 splayer 对象 */
const buildSplayer = (record: PluginContextRecord, spec: LoadSpec): HostApi => ({
  pluginId: spec.pluginId,
  apiLevel: spec.apiLevel,
  locale: spec.locale,
  appVersion: spec.appVersion,

  request: (url: string, opts?: HostRequestOptions): Promise<HostRequestResult> =>
    hostCall(record, "request", [url, opts ?? {}]) as Promise<HostRequestResult>,

  register: (args: RegisterArgs) => {
    if (args.sources) {
      record.registeredSources = { ...record.registeredSources, ...args.sources };
      send({ kind: "sourcesUpdate", pluginId: record.pluginId, sources: record.registeredSources });
    }
    if (args.events || args.controls !== undefined || args.settings || args.menus) {
      if (Array.isArray(args.settings)) {
        for (const item of args.settings) {
          if (!(item.key in record.userSettingsCache)) {
            record.userSettingsCache[item.key] = item.default;
          }
        }
      }
      send({
        kind: "registered",
        pluginId: record.pluginId,
        events: Array.isArray(args.events) ? args.events : [],
        controls: Boolean(args.controls),
        settings: Array.isArray(args.settings) ? args.settings : [],
        menus: Array.isArray(args.menus) ? args.menus : [],
      });
    }
  },

  on: <A extends PluginAction>(
    action: A,
    handler: (req: ActionIO[A]["req"]) => Promise<ActionIO[A]["res"]>,
  ) => {
    record.handlers.set(action, handler as (req: unknown) => Promise<unknown>);
  },

  log: {
    debug: (...args) =>
      send({
        kind: "log",
        pluginId: record.pluginId,
        level: "debug",
        args: sanitizeForIpc(args) as unknown[],
      }),
    info: (...args) =>
      send({
        kind: "log",
        pluginId: record.pluginId,
        level: "info",
        args: sanitizeForIpc(args) as unknown[],
      }),
    warn: (...args) =>
      send({
        kind: "log",
        pluginId: record.pluginId,
        level: "warn",
        args: sanitizeForIpc(args) as unknown[],
      }),
    error: (...args) =>
      send({
        kind: "log",
        pluginId: record.pluginId,
        level: "error",
        args: sanitizeForIpc(args) as unknown[],
      }),
  },

  storage: {
    get: <T = unknown>(key: string): Promise<T | null> =>
      hostCall(record, "storage.get", [key]) as Promise<T | null>,
    set: (key, value) => hostCall(record, "storage.set", [key, value]) as Promise<void>,
    remove: (key) => hostCall(record, "storage.remove", [key]) as Promise<void>,
    keys: () => hostCall(record, "storage.keys", []) as Promise<string[]>,
  },

  getSetting: <T = unknown>(key: string): T | undefined =>
    record.userSettingsCache[key] as T | undefined,

  player: {
    on: (kind, handler) => {
      const list = record.playerEventHandlers.get(kind) ?? [];
      list.push(handler as (data: unknown) => void);
      record.playerEventHandlers.set(kind, list);
    },
    play: () => void hostCall(record, "player.play", []).catch(() => {}),
    pause: () => void hostCall(record, "player.pause", []).catch(() => {}),
    next: () => void hostCall(record, "player.next", []).catch(() => {}),
    prev: () => void hostCall(record, "player.prev", []).catch(() => {}),
    seek: (positionMs: number) =>
      void hostCall(record, "player.seek", [positionMs]).catch(() => {}),
    setVolume: (volume: number) =>
      void hostCall(record, "player.setVolume", [volume]).catch(() => {}),
    getPosition: () => hostCall(record, "player.getPosition", []) as Promise<number>,
  },

  onSettingChange: (key: string, handler: (value: unknown) => void) => {
    const list = record.settingChangeHandlers.get(key) ?? [];
    list.push(handler);
    record.settingChangeHandlers.set(key, list);
  },
});

/** 把 utils 暴露给沙箱（原生 Node 模块包装，无状态可共享） */
const buildUtils = (): object => ({
  crypto: {
    md5: (data: string | Uint8Array) =>
      crypto
        .createHash("md5")
        .update(data as crypto.BinaryLike)
        .digest("hex"),
    sha1: (data: string | Uint8Array) =>
      crypto
        .createHash("sha1")
        .update(data as crypto.BinaryLike)
        .digest("hex"),
    sha256: (data: string | Uint8Array) =>
      crypto
        .createHash("sha256")
        .update(data as crypto.BinaryLike)
        .digest("hex"),
    hmac: (algo: string, key: string | Uint8Array, data: string | Uint8Array) =>
      crypto
        .createHmac(algo, key as crypto.BinaryLike)
        .update(data as crypto.BinaryLike)
        .digest("hex"),
    randomBytes: (size: number) => crypto.randomBytes(size),
    aesEncrypt: (
      data: string | Uint8Array,
      key: Buffer | Uint8Array,
      mode: string,
      iv?: Buffer | Uint8Array,
    ) => {
      const cipher = crypto.createCipheriv(mode, key as crypto.CipherKey, iv ?? null);
      const input = typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data);
      return Buffer.concat([cipher.update(input), cipher.final()]);
    },
    aesDecrypt: (
      data: Buffer | Uint8Array,
      key: Buffer | Uint8Array,
      mode: string,
      iv?: Buffer | Uint8Array,
    ) => {
      const decipher = crypto.createDecipheriv(mode, key as crypto.CipherKey, iv ?? null);
      return Buffer.concat([decipher.update(Buffer.from(data)), decipher.final()]);
    },
    rsaEncrypt: (data: Buffer | Uint8Array, publicKey: string) =>
      crypto.publicEncrypt(publicKey, Buffer.from(data)),
  },
  buffer: {
    from: (
      data: ArrayBuffer | SharedArrayBuffer | string | Uint8Array | number[],
      enc?: BufferEncoding,
    ) => (typeof data === "string" ? Buffer.from(data, enc) : Buffer.from(data as ArrayBuffer)),
    bufToString: (buf: Buffer | Uint8Array, enc: BufferEncoding = "utf-8") =>
      Buffer.from(buf).toString(enc),
    concat: (list: Array<Buffer | Uint8Array>) => Buffer.concat(list),
  },
  base64: {
    encode: (data: string | Uint8Array) => Buffer.from(data as Buffer).toString("base64"),
    decode: (data: string) => Buffer.from(data, "base64").toString("utf-8"),
  },
  zlib: {
    inflate: (data: Buffer | Uint8Array) => zlib.inflateSync(data),
    deflate: (data: Buffer | Uint8Array) => zlib.deflateSync(data),
    gunzip: (data: Buffer | Uint8Array) => zlib.gunzipSync(data),
    gzip: (data: Buffer | Uint8Array) => zlib.gzipSync(data),
  },
});

/** dispose 一个插件记录：中止在途、拒绝等待、清定时器与回调 */
const disposeRecord = (record: PluginContextRecord): void => {
  if (record.disposed) return;
  record.disposed = true;
  for (const ctrl of record.inflight.values()) {
    try {
      ctrl.abort();
    } catch {
      /* ignore */
    }
  }
  record.inflight.clear();
  for (const waiter of record.hostCallWaiters.values()) {
    waiter.reject(Object.assign(new Error("plugin unloaded"), { code: "PLUGIN_NOT_READY" }));
  }
  record.hostCallWaiters.clear();
  for (const handle of record.timers) clearTimeout(handle);
  record.timers.clear();
  for (const handle of record.immediates) clearImmediate(handle);
  record.immediates.clear();
  record.handlers.clear();
  record.playerEventHandlers.clear();
  record.settingChangeHandlers.clear();
};

/** 卸载插件：dispose 记录并从表中移除（vm 上下文随引用释放被 GC 回收） */
const unloadPlugin = (pluginId: string): void => {
  const record = plugins.get(pluginId);
  if (!record) return;
  disposeRecord(record);
  plugins.delete(pluginId);
};

/** 加载一个插件进新的 vm 上下文 */
const loadPluginIntoContext = (spec: LoadSpec): void => {
  if (plugins.has(spec.pluginId)) return;

  const record: PluginContextRecord = {
    pluginId: spec.pluginId,
    handlers: new Map(),
    playerEventHandlers: new Map(),
    settingChangeHandlers: new Map(),
    registeredSources: {},
    inflight: new Map(),
    hostCallWaiters: new Map(),
    userSettingsCache: spec.userSettings ?? {},
    timers: new Set(),
    immediates: new Set(),
    callSeq: 0,
    disposed: false,
  };
  plugins.set(spec.pluginId, record);

  const splayer = buildSplayer(record, spec);
  (splayer as any).utils = buildUtils();

  const timerApi = makeTimers(record);
  const sandboxGlobal: Record<string, unknown> = {
    splayer,
    Buffer,
    ...timerApi,
    queueMicrotask,
    Promise,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    btoa: (str: string): string => Buffer.from(str, "binary").toString("base64"),
    atob: (str: string): string => Buffer.from(str, "base64").toString("binary"),
    console: {
      log: splayer.log.info,
      info: splayer.log.info,
      debug: splayer.log.debug,
      warn: splayer.log.warn,
      error: splayer.log.error,
    },
  };

  installLxShim(
    sandboxGlobal,
    splayer,
    record.handlers,
    (sources) => {
      record.registeredSources = { ...record.registeredSources, ...sources };
      send({ kind: "sourcesUpdate", pluginId: record.pluginId, sources: record.registeredSources });
    },
    (info) => {
      send({ kind: "updateAvailable", pluginId: record.pluginId, info });
    },
    {
      name: spec.scriptInfo.name,
      description: spec.scriptInfo.description,
      version: spec.scriptInfo.version,
      author: spec.scriptInfo.author,
      homepage: spec.scriptInfo.homepage,
      rawScript: spec.source,
    },
  );

  sandboxGlobal.globalThis = sandboxGlobal;

  const context = vm.createContext(sandboxGlobal, {
    name: `plugin:${spec.pluginId}`,
    codeGeneration: { strings: true, wasm: false },
  });

  try {
    const script = new vm.Script(spec.source, { filename: `plugin-${spec.pluginId}.js` });
    script.runInContext(context, { timeout: 5_000, breakOnSigint: false });
  } catch (err) {
    disposeRecord(record);
    plugins.delete(spec.pluginId);
    send({
      kind: "fatal",
      pluginId: spec.pluginId,
      error: {
        code: "PLUGIN_SCRIPT_ERROR",
        message: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err),
      },
    });
    return;
  }

  // 脚本同步部分执行完，再 microtask 后上报 ready（兼容 lx 异步 inited）
  queueMicrotask(() => {
    if (record.disposed) return;
    send({ kind: "ready", pluginId: spec.pluginId, sources: record.registeredSources });
  });
};

parentPort.on("message", async (event) => {
  const msg = event.data;
  try {
    switch (msg.kind) {
      case "loadPlugin":
        loadPluginIntoContext(msg);
        return;
      case "unloadPlugin":
        unloadPlugin(msg.pluginId);
        return;
      case "ping":
        send({ kind: "pong" });
        return;
      case "cancel": {
        const record = plugins.get(msg.pluginId);
        const ctrl = record?.inflight.get(msg.requestId);
        if (record && ctrl) {
          ctrl.abort();
          record.inflight.delete(msg.requestId);
        }
        return;
      }
      case "event": {
        const record = plugins.get(msg.pluginId);
        if (!record) return;
        const handlers = record.playerEventHandlers.get(msg.event);
        if (handlers) {
          for (const handler of handlers) {
            try {
              handler(msg.data);
            } catch {
              // 隔离插件回调异常
            }
          }
        }
        return;
      }
      case "settingsUpdate": {
        const record = plugins.get(msg.pluginId);
        if (!record) return;
        for (const [key, value] of Object.entries(msg.settings)) {
          record.userSettingsCache[key] = value;
          const handlers = record.settingChangeHandlers.get(key);
          if (handlers) {
            for (const handler of handlers) {
              try {
                handler(value);
              } catch {
                // 隔离插件回调异常
              }
            }
          }
        }
        return;
      }
      case "hostResult": {
        const record = plugins.get(msg.pluginId);
        const waiter = record?.hostCallWaiters.get(msg.callId);
        if (!record || !waiter) return;
        record.hostCallWaiters.delete(msg.callId);
        if (msg.ok) waiter.resolve(msg.data);
        else {
          const err = new Error(msg.error?.message ?? "host call failed");

          (err as any).code = msg.error?.code;
          waiter.reject(err);
        }
        return;
      }
      case "call": {
        const record = plugins.get(msg.pluginId);
        if (!record) {
          send({
            kind: "result",
            pluginId: msg.pluginId,
            requestId: msg.requestId,
            ok: false,
            error: { code: "PLUGIN_NOT_READY", message: "plugin not loaded" },
          });
          return;
        }
        const handler = record.handlers.get(msg.action);
        if (!handler) {
          send({
            kind: "result",
            pluginId: msg.pluginId,
            requestId: msg.requestId,
            ok: false,
            error: {
              code: "PLUGIN_ACTION_UNSUPPORTED",
              message: `action "${msg.action}" not registered`,
            },
          });
          return;
        }
        const ctrl = new AbortController();
        record.inflight.set(msg.requestId, ctrl);
        try {
          const data = await handler(msg.params);
          record.inflight.delete(msg.requestId);
          if (ctrl.signal.aborted) {
            send({
              kind: "result",
              pluginId: msg.pluginId,
              requestId: msg.requestId,
              ok: false,
              error: { code: "PLUGIN_CANCELLED", message: "cancelled" },
            });
          } else {
            send({
              kind: "result",
              pluginId: msg.pluginId,
              requestId: msg.requestId,
              ok: true,
              data: sanitizeForIpc(data),
            });
          }
        } catch (err) {
          record.inflight.delete(msg.requestId);
          send({
            kind: "result",
            pluginId: msg.pluginId,
            requestId: msg.requestId,
            ok: false,
            error: {
              code: ((err as any)?.code as string) ?? "PLUGIN_HANDLER_ERROR",
              message: err instanceof Error ? err.message : String(err),
            },
          });
        }
        return;
      }
    }
  } catch (err) {
    // 派发自身出错：能归因就 dispose 该插件并回 fatal，否则 host 级日志
    const pluginId = (msg as { pluginId?: string }).pluginId;
    const record = pluginId ? plugins.get(pluginId) : undefined;
    if (pluginId && record) {
      disposeRecord(record);
      plugins.delete(pluginId);
      send({
        kind: "fatal",
        pluginId,
        error: {
          code: "PLUGIN_UNKNOWN",
          message: err instanceof Error ? err.message : String(err),
        },
      });
    } else {
      send({ kind: "log", level: "error", args: ["host message error:", String(err)] });
    }
  }
});

// 插件未捕获的异步异常：记 host 级日志但不退进程，保护其它插件存活
process.on("unhandledRejection", (reason) => {
  send({
    kind: "log",
    level: "error",
    args: ["unhandledRejection:", reason instanceof Error ? reason.message : reason],
  });
});
process.on("uncaughtException", (err) => {
  send({ kind: "log", level: "error", args: ["uncaughtException:", err.message] });
});

// host 进程就绪
send({ kind: "hostReady" });
