/**
 * 宿主网络代理
 *
 * 插件通过 splayer.request(url, opts) 调用本模块，
 * 主进程用 Electron `net.fetch`（支持系统代理）去请求，应用超时与 URL 白名单。
 */

import { net } from "electron";
import type { HostRequestOptions, HostRequestResult } from "@shared/types/plugin";
import {
  REQUEST_DEFAULT_TIMEOUT,
  REQUEST_MAX_TIMEOUT,
  PluginErrorCodes,
} from "@shared/defaults/plugin-api";

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
    else if (opts.body instanceof ArrayBuffer) body = opts.body;
    else {
      const u8 = opts.body as Uint8Array;
      body = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
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
