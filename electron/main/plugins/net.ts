/**
 * 宿主网络代理
 *
 * 插件通过 splayer.request(url, opts) 调用本模块，
 * 主进程用 Electron `net.fetch`（支持系统代理）去请求，应用超时与 URL 白名单。
 */

import { net } from "electron";
import type { HostRequestOptions, HostRequestResult, MarketPlugin } from "@shared/types/plugin";
import {
  REQUEST_DEFAULT_TIMEOUT,
  REQUEST_MAX_TIMEOUT,
  INSTALL_URL_MAX_SIZE,
  INSTALL_URL_TIMEOUT,
  PLUGIN_REGISTRY_URL,
  PluginErrorCodes,
} from "@shared/defaults/plugin-api";

/**
 * 拉取远端脚本源码，带协议白名单、大小与超时限制
 *
 * 供在线导入、一键更新、更新检查复用；仅允许 https（loopback 放行 http 便于本地调试）。
 * @param url - 脚本地址（应指向 raw .js）
 * @returns 脚本源码文本
 */
export const fetchScript = async (url: string): Promise<string> => {
  const parsed = new URL(url);
  const isLoopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback)) {
    throw new Error(`protocol not allowed: ${parsed.protocol}`);
  }
  const resp = await net.fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(INSTALL_URL_TIMEOUT),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  // Content-Length 预检（仅提示，不强信任）
  const lenHeader = resp.headers.get("content-length");
  if (lenHeader && Number(lenHeader) > INSTALL_URL_MAX_SIZE) {
    throw new Error("PLUGIN_INSTALL_URL_TOO_LARGE");
  }
  const buf = await resp.arrayBuffer();
  if (buf.byteLength > INSTALL_URL_MAX_SIZE) {
    throw new Error("PLUGIN_INSTALL_URL_TOO_LARGE");
  }
  return new TextDecoder("utf-8").decode(buf);
};

/** 拉取插件市场索引 */
export const fetchMarket = async (): Promise<MarketPlugin[]> => {
  const resp = await net.fetch(PLUGIN_REGISTRY_URL, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(INSTALL_URL_TIMEOUT),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = JSON.parse(await resp.text()) as { plugins?: MarketPlugin[] };
  return Array.isArray(data.plugins)
    ? data.plugins.filter((item) => item?.id && item?.updateUrl)
    : [];
};

/** 校验并发起请求；抛出的错误携带 code 字段 */
export const hostRequest = async (
  url: string,
  opts: HostRequestOptions = {},
): Promise<HostRequestResult> => {
  // URL 白名单：仅 http/https
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw Object.assign(new Error(`invalid url: ${url}`), {
      code: PluginErrorCodes.URL_NOT_ALLOWED,
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw Object.assign(new Error(`protocol not allowed: ${parsed.protocol}`), {
      code: PluginErrorCodes.URL_NOT_ALLOWED,
    });
  }

  const timeoutMs = Math.min(
    Math.max(opts.timeout ?? REQUEST_DEFAULT_TIMEOUT, 1_000),
    REQUEST_MAX_TIMEOUT,
  );
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  // 构造 body
  // 注意：Uint8Array 要按 byteOffset/byteLength 切片，避免 subarray 场景下
  // `.buffer` 把多余的底层字节一起发出去
  let body: BodyInit | undefined;
  if (opts.body != null) {
    if (typeof opts.body === "string") body = opts.body;
    else if (ArrayBuffer.isView(opts.body)) {
      const view = opts.body as ArrayBufferView;
      body = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice().buffer;
    } else if (Object.prototype.toString.call(opts.body) === "[object ArrayBuffer]") {
      body = new Uint8Array(opts.body as ArrayBuffer).slice().buffer;
    } else {
      throw Object.assign(new Error("request body must be string or binary data"), {
        code: PluginErrorCodes.UNKNOWN,
      });
    }
  }

  try {
    const resp = await net.fetch(url, {
      method: opts.method ?? "GET",
      headers: opts.headers ?? {},
      body,
      signal: ctrl.signal,
      // 让 Electron 遵循系统代理
      bypassCustomProtocolHandlers: true,
    });

    const headers: Record<string, string> = {};
    resp.headers.forEach((value, key) => {
      headers[key] = value;
    });

    let responseBody: unknown;
    const type = opts.responseType ?? "text";
    if (type === "arraybuffer") {
      responseBody = new Uint8Array(await resp.arrayBuffer());
    } else if (type === "json") {
      const text = await resp.text();
      try {
        responseBody = JSON.parse(text);
      } catch {
        responseBody = text;
      }
    } else {
      responseBody = await resp.text();
    }

    return { status: resp.status, headers, body: responseBody };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw Object.assign(new Error("request timeout"), {
        code: PluginErrorCodes.REQUEST_TIMEOUT,
      });
    }
    throw Object.assign(
      new Error(`network error: ${err instanceof Error ? err.message : String(err)}`),
      { code: PluginErrorCodes.NETWORK_ERROR },
    );
  } finally {
    clearTimeout(timer);
  }
};
