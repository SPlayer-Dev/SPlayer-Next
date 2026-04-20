/**
 * 插件沙箱子进程入口（utilityProcess fork 的目标）
 *
 * 职责：
 * - 接收主进程 `init` 消息，收到后创建 vm.createContext 作为运行沙箱
 * - 在沙箱内注入 globalThis.splayer（HostApi 实现），可选 globalThis.lx 垫片
 * - 用 vm.runInContext 执行插件源码
 * - 转发 call → handler；hostCall → 主进程；ping → pong
 *
 * 注意：本文件在 utilityProcess 里跑，没有 DOM / Electron，只有 Node。
 * `parentPort` 是 Electron utilityProcess 暴露的双向通道。
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
  PluginErrorPayload,
  SandboxIn,
  SandboxOut,
  SourceCapability,
} from "@shared/types/plugin";
import { installLxShim } from "./lx-shim";

// utilityProcess 注入的全局 parentPort（Electron 类型没导出，用 any）
// 注意：process.parentPort 仿 Web Worker 接口，'message' 回调参数是 MessageEvent，
// 消息体在 event.data；与主进程侧 UtilityProcess.on('message', msg) 不同

const parentPort: {
  on: (evt: "message", cb: (event: { data: SandboxIn }) => void) => void;
  postMessage: (msg: SandboxOut) => void;
} = (process as any).parentPort;

if (!parentPort) {
  // 未在 utilityProcess 下运行，退出
  process.exit(1);
}

const send = (msg: SandboxOut): void => parentPort.postMessage(msg);

/** 等待主进程 init 再启动，避免 TDZ */
let initialized = false;

/** action → handler 注册表 */
const handlers = new Map<PluginAction, (req: unknown) => Promise<unknown>>();

/** 已注册的 sources（等 script 执行完后随 ready 消息上报） */
let registeredSources: Record<string, SourceCapability> = {};

/** 当前请求的 AbortController，key = requestId */
const inflight = new Map<string, AbortController>();

/** hostCall 回调登记，key = callId */
const hostCallWaiters = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (err: Error) => void }
>();

let callSeq = 0;
const nextCallId = (): string => `c${++callSeq}`;

/** 用户设置缓存（init 时传入，getSetting 同步读） */
let userSettingsCache: Record<string, unknown> = {};

/** 调用主进程，返回主进程 hostResult 的 data */
const hostCall = (method: HostCallMethod, args: unknown[]): Promise<unknown> => {
  const callId = nextCallId();
  return new Promise<unknown>((resolve, reject) => {
    hostCallWaiters.set(callId, { resolve, reject });
    send({ kind: "hostCall", callId, method, args });
  });
};

/** 构造注入沙箱的 splayer 对象 */
const buildSplayer = (init: Extract<SandboxIn, { kind: "init" }>): HostApi => ({
  pluginId: init.pluginId,
  apiLevel: init.apiLevel,
  locale: init.locale,
  appVersion: init.appVersion,

  request: (url: string, opts?: HostRequestOptions): Promise<HostRequestResult> =>
    hostCall("request", [url, opts ?? {}]) as Promise<HostRequestResult>,

  register: (caps) => {
    registeredSources = { ...registeredSources, ...caps.sources };
  },

  on: <A extends PluginAction>(
    action: A,
    handler: (req: ActionIO[A]["req"]) => Promise<ActionIO[A]["res"]>,
  ) => {
    handlers.set(action, handler as (req: unknown) => Promise<unknown>);
  },

  log: {
    debug: (...args) => send({ kind: "log", level: "debug", args }),
    info: (...args) => send({ kind: "log", level: "info", args }),
    warn: (...args) => send({ kind: "log", level: "warn", args }),
    error: (...args) => send({ kind: "log", level: "error", args }),
  },

  storage: {
    get: <T = unknown>(key: string): Promise<T | null> =>
      hostCall("storage.get", [key]) as Promise<T | null>,
    set: (key, value) => hostCall("storage.set", [key, value]) as Promise<void>,
    remove: (key) => hostCall("storage.remove", [key]) as Promise<void>,
    keys: () => hostCall("storage.keys", []) as Promise<string[]>,
  },

  getSetting: <T = unknown>(key: string): T | undefined => userSettingsCache[key] as T | undefined,
});

/** 把 utils 暴露给沙箱（原生 Node 模块包装） */
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

/** 执行插件脚本 */
const runScript = (init: Extract<SandboxIn, { kind: "init" }>): void => {
  const splayer = buildSplayer(init);
  // splayer.utils 单独挂，避免被类型定义暴露（保持 HostApi 纯净）

  (splayer as any).utils = buildUtils();

  const sandboxGlobal: Record<string, unknown> = {
    splayer,
    // 基础 Node 工具
    Buffer,
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    setImmediate,
    clearImmediate,
    queueMicrotask,
    Promise,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    // console 转发到 log
    console: {
      log: splayer.log.info,
      info: splayer.log.info,
      debug: splayer.log.debug,
      warn: splayer.log.warn,
      error: splayer.log.error,
    },
  };

  // 统一注入 lx 垫片——无论脚本声明的 platform 是什么。
  // 原因：很多 lx 脚本以明文 .js 分发且头注释里没写 @platform lx，
  // 按 platform 推断会错判为 splayer，导致 globalThis.lx 为 undefined。
  // splayer-native 脚本本身不会碰 lx 全局，多挂一个对象不干扰；
  // lx 脚本调 splayer.on 又覆盖 lx 垫片预置的 handler，两条路径都能走通。
  installLxShim(
    sandboxGlobal,
    splayer,
    handlers,
    (sources) => {
      registeredSources = { ...registeredSources, ...sources };
    },
    {
      name: init.scriptInfo.name,
      description: init.scriptInfo.description,
      version: init.scriptInfo.version,
      author: init.scriptInfo.author,
      homepage: init.scriptInfo.homepage,
      rawScript: init.source,
    },
  );

  // 允许脚本自引用全局
  sandboxGlobal.globalThis = sandboxGlobal;

  const context = vm.createContext(sandboxGlobal, {
    name: `plugin:${init.pluginId}`,
    codeGeneration: { strings: true, wasm: false },
  });

  try {
    const script = new vm.Script(init.source, {
      filename: `plugin-${init.pluginId}.js`,
    });
    script.runInContext(context, { timeout: 5_000, breakOnSigint: false });
  } catch (err) {
    send({
      kind: "fatal",
      error: {
        code: "PLUGIN_SCRIPT_ERROR",
        message: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err),
      },
    });
    return;
  }

  // 脚本同步部分执行完，上报 ready + 能力
  // 注意：lx 脚本通常靠 `lx.send('inited', ...)` 异步声明，shim 里会改 registeredSources
  // 所以再 microtask 后发 ready
  queueMicrotask(() => {
    send({ kind: "ready", sources: registeredSources });
  });
};

/** 消息入口：event.data 是主进程发来的 SandboxIn */
parentPort.on("message", async (event) => {
  const msg = event.data;
  try {
    switch (msg.kind) {
      case "init": {
        if (initialized) return;
        initialized = true;
        userSettingsCache = msg.userSettings ?? {};
        runScript(msg);
        return;
      }
      case "ping": {
        send({ kind: "pong" });
        return;
      }
      case "cancel": {
        const ctrl = inflight.get(msg.requestId);
        if (ctrl) {
          ctrl.abort();
          inflight.delete(msg.requestId);
        }
        return;
      }
      case "hostResult": {
        const w = hostCallWaiters.get(msg.callId);
        if (!w) return;
        hostCallWaiters.delete(msg.callId);
        if (msg.ok) w.resolve(msg.data);
        else {
          const err = new Error(msg.error?.message ?? "host call failed");

          (err as any).code = msg.error?.code;
          w.reject(err);
        }
        return;
      }
      case "call": {
        const handler = handlers.get(msg.action);
        if (!handler) {
          send({
            kind: "result",
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
        inflight.set(msg.requestId, ctrl);
        try {
          const data = await handler(msg.params);
          inflight.delete(msg.requestId);
          if (ctrl.signal.aborted) {
            send({
              kind: "result",
              requestId: msg.requestId,
              ok: false,
              error: { code: "PLUGIN_CANCELLED", message: "cancelled" },
            });
          } else {
            send({ kind: "result", requestId: msg.requestId, ok: true, data });
          }
        } catch (err) {
          inflight.delete(msg.requestId);
          const payload: PluginErrorPayload = {
            code: ((err as any)?.code as string) ?? "PLUGIN_HANDLER_ERROR",
            message: err instanceof Error ? err.message : String(err),
          };
          send({ kind: "result", requestId: msg.requestId, ok: false, error: payload });
        }
        return;
      }
    }
  } catch (err) {
    send({
      kind: "fatal",
      error: {
        code: "PLUGIN_UNKNOWN",
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
});

process.on("unhandledRejection", (reason) => {
  send({
    kind: "log",
    level: "error",
    args: ["unhandledRejection:", reason instanceof Error ? reason.message : reason],
  });
});

process.on("uncaughtException", (err) => {
  send({
    kind: "fatal",
    error: { code: "PLUGIN_SCRIPT_ERROR", message: err.message },
  });
});
