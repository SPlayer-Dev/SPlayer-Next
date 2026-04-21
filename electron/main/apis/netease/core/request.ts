/**
 * Netease API 请求层（完整移植自 @neteasecloudmusicapienhanced/api util/request.js）
 *
 * 核心职责：根据加密方式（weapi / linuxapi / eapi / api）构造 URL、headers、form body，
 * 处理 cookie 合并、响应解密、状态码归一化。使用 Node 原生 fetch 替代 axios。
 */

import { randomBytes } from "node:crypto";
import {
  API_DOMAIN,
  DOMAIN,
  ENCRYPT_RESPONSE,
  OS_MAP,
  SPECIAL_STATUS_CODES,
  UA_MAP,
  type CryptoMode,
} from "./config";
import { cookieObjToString, cookieToJson } from "./cookie";
import * as encrypt from "./crypto";
import { getAnonymousToken, getDeviceId } from "./device";

/** 调用方传入的可选参数 */
export interface RequestOptions {
  /** 加密方式；省略时依据路径默认规则，详见 createRequest */
  crypto?: CryptoMode | "";
  /** 预注入 cookie，可为字符串或对象 */
  cookie?: string | Record<string, string>;
  /** 自定义 User-Agent */
  ua?: string;
  /** 自定义 Referer/域名覆盖 */
  domain?: string;
  /** 真实 IP（X-Real-IP / X-Forwarded-For） */
  realIP?: string;
  ip?: string;
  /** 是否让服务端加密响应体（仅 weapi/eapi 有效） */
  e_r?: boolean;
  /** 强制附加 anti-cheat token（暂未启用） */
  checkToken?: boolean;
}

/** 响应统一结构 */
export interface RequestResponse {
  status: number;
  body: Record<string, unknown>;
  cookie: string[];
}

interface NeteaseBody {
  code?: number | string;
  [key: string]: unknown;
}

/** weapi 专用 CSRF：从 cookie 中取 __csrf */
const csrfFrom = (cookie: Record<string, string>): string => cookie["__csrf"] || "";

/** 生成 WNMCID（进程级常量）：6 位小写字母.时间戳.01.0 */
const WNMCID = (() => {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return `${s}.${Date.now()}.01.0`;
})();

/** 每次请求生成：timestamp_XXXX 的递增式 id */
const generateRequestId = (): string => {
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(4, "0");
  return `${Date.now()}_${rand}`;
};

/** 补齐 cookie：注入 _ntes_nuid/_ntes_nnid/WNMCID/deviceId/appver 等客户端必备字段 */
const processCookieObject = (
  cookie: Record<string, string>,
  uri: string,
): Record<string, string> => {
  const ntesNuid = cookie._ntes_nuid || randomBytes(16).toString("hex");
  const os = OS_MAP[(cookie.os as keyof typeof OS_MAP) || "pc"] || OS_MAP.pc;

  const processed: Record<string, string> = {
    ...cookie,
    __remember_me: "true",
    ntes_kaola_ad: "1",
    _ntes_nuid: cookie._ntes_nuid || ntesNuid,
    _ntes_nnid: cookie._ntes_nnid || `${ntesNuid},${Date.now()}`,
    WNMCID: cookie.WNMCID || WNMCID,
    WEVNSM: cookie.WEVNSM || "1.0.0",
    osver: cookie.osver || os.osver,
    deviceId: cookie.deviceId || getDeviceId(),
    os: cookie.os || os.os,
    channel: cookie.channel || os.channel,
    appver: cookie.appver || os.appver,
  };

  // 登录类接口不带 NMTID（服务端要求）
  if (uri.indexOf("login") === -1) {
    processed.NMTID = randomBytes(8).toString("hex");
  }

  if (!processed.MUSIC_U) {
    processed.MUSIC_A = processed.MUSIC_A || getAnonymousToken();
    if (!processed.MUSIC_A) delete processed.MUSIC_A;
  }

  return processed;
};

/** 根据加密方式 + 设备类型选择 User-Agent */
const chooseUserAgent = (
  crypto: keyof typeof UA_MAP,
  uaType: "pc" | "android" | "iphone" | "linux" = "pc",
): string => {
  const map = UA_MAP[crypto] as Record<string, string> | undefined;
  return (map && map[uaType]) || "";
};

/**
 * 构造并发送请求
 * @param uri   接口路径，例如 `/api/w/login`；weapi 会自动替换前缀为 `/weapi/`
 * @param data  业务参数（不含 cookie/csrf，请求层会自动注入）
 * @param options 加密方式 / cookie / 代理等
 */
export const createRequest = async (
  uri: string,
  data: Record<string, unknown>,
  options: RequestOptions,
): Promise<RequestResponse> => {
  const headers: Record<string, string> = {};
  const ip = options.realIP || options.ip || "";
  if (ip) {
    headers["X-Real-IP"] = ip;
    headers["X-Forwarded-For"] = ip;
  }

  // 归一化 cookie 到对象并做一次补全
  let cookie: Record<string, string> =
    typeof options.cookie === "string" ? cookieToJson(options.cookie) : options.cookie || {};
  cookie = processCookieObject(cookie, uri);
  headers["Cookie"] = cookieObjToString(cookie);

  let crypto: CryptoMode | "" = options.crypto ?? "";
  if (crypto === "") crypto = "eapi";

  const csrfToken = csrfFrom(cookie);
  const useER = toBoolean(
    options.e_r !== undefined ? options.e_r : data.e_r !== undefined ? data.e_r : ENCRYPT_RESPONSE,
  );
  data.e_r = useER;

  let url = "";
  let encryptData: Record<string, string | number | boolean> | unknown = data;

  switch (crypto) {
    case "weapi": {
      headers["Referer"] = options.domain || DOMAIN;
      headers["User-Agent"] = options.ua || chooseUserAgent("weapi");
      data.csrf_token = csrfToken;
      encryptData = encrypt.weapi(data);
      url = (options.domain || DOMAIN) + "/weapi/" + uri.slice(5);
      break;
    }
    case "linuxapi": {
      headers["User-Agent"] = options.ua || chooseUserAgent("linuxapi", "linux");
      encryptData = encrypt.linuxapi({
        method: "POST",
        url: (options.domain || DOMAIN) + uri,
        params: data,
      });
      url = (options.domain || DOMAIN) + "/api/linux/forward";
      break;
    }
    case "eapi":
    case "api": {
      const header: Record<string, string> = {
        osver: cookie.osver,
        deviceId: cookie.deviceId,
        os: cookie.os,
        appver: cookie.appver,
        versioncode: cookie.versioncode || "140",
        mobilename: cookie.mobilename || "",
        buildver: cookie.buildver || Date.now().toString().slice(0, 10),
        resolution: cookie.resolution || "1920x1080",
        __csrf: csrfToken,
        channel: cookie.channel,
        requestId: generateRequestId(),
      };
      if (cookie.MUSIC_U) header.MUSIC_U = cookie.MUSIC_U;
      if (cookie.MUSIC_A) header.MUSIC_A = cookie.MUSIC_A;
      headers["Cookie"] = cookieObjToString(header);
      headers["User-Agent"] = options.ua || chooseUserAgent("api", "iphone");

      if (crypto === "eapi") {
        (data as Record<string, unknown>).header = header;
        encryptData = encrypt.eapi(uri, data);
        url = (options.domain || API_DOMAIN) + "/eapi/" + uri.slice(5);
      } else {
        url = (options.domain || API_DOMAIN) + uri;
        encryptData = data;
      }
      break;
    }
    default:
      throw new Error(`Unknown crypto: ${crypto}`);
  }

  const body = new URLSearchParams(encryptData as Record<string, string>).toString();
  headers["Content-Type"] = "application/x-www-form-urlencoded";

  const answer: RequestResponse = { status: 500, body: {}, cookie: [] };
  const needDecrypt = (crypto === "eapi" || crypto === "weapi") && useER;

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body });
  } catch (err) {
    answer.status = 502;
    answer.body = { code: 502, msg: err instanceof Error ? err.message : String(err) };
    throw answer;
  }

  // 收集 set-cookie（Node fetch 通过 headers.getSetCookie 暴露原始多值头）
  const setCookie =
    (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
    (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
  answer.cookie = setCookie.map((x) => x.replace(/\s*Domain=[^(;|$)]+;*/, ""));

  let parsed: NeteaseBody;
  try {
    if (needDecrypt) {
      const buf = Buffer.from(await res.arrayBuffer());
      parsed = encrypt.eapiResDecrypt(
        buf.toString("hex").toUpperCase(),
        headers["x-aeapi"] === "true",
      ) as NeteaseBody;
    } else {
      const text = await res.text();
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { code: res.status, raw: text };
      }
    }
    answer.body = parsed;
    if (parsed?.code !== undefined) parsed.code = Number(parsed.code);
    answer.status = Number(parsed?.code || res.status);
    if (typeof parsed?.code === "number" && SPECIAL_STATUS_CODES.has(parsed.code)) {
      answer.status = 200;
    }
  } catch {
    answer.body = { code: res.status, msg: "parse failed" };
    answer.status = res.status;
  }

  answer.status = answer.status > 100 && answer.status < 600 ? answer.status : 400;

  if (answer.status === 200) return answer;
  throw answer;
};

/** 宽松的 boolean 解析：原始 util/index.js 里的 toBoolean */
const toBoolean = (val: unknown): boolean => {
  if (typeof val === "boolean") return val;
  if (val === "") return false;
  return val === "true" || val === "1" || val === 1 || val === true;
};
