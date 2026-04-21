/**
 * 请求 options 工厂
 * 对齐 @neteasecloudmusicapienhanced/api util/option.js：从调用方 query 中抽取
 * crypto / cookie / ua / proxy / realIP 等，拼成 createRequest 的第三参数
 */

import type { CryptoMode } from "./config";
import type { RequestOptions } from "./request";

/** 调用方传入的可选参数 */
export interface Query {
  /** 加密方式 */
  crypto?: CryptoMode;
  /** 预注入 cookie，可为字符串或对象 */
  cookie?: string | Record<string, string>;
  /** 自定义 User-Agent */
  ua?: string;
  /** 真实 IP（X-Real-IP / X-Forwarded-For） */
  realIP?: string;
  /** 真实 IP（X-Real-IP / X-Forwarded-For） */
  ip?: string;
  /** 是否让服务端加密响应体（仅 weapi/eapi 有效） */
  e_r?: boolean;
  /** 自定义 Referer/域名覆盖 */
  domain?: string;
  /** 强制附加 anti-cheat token（暂未启用） */
  checkToken?: boolean;
  /** 其他可选参数 */
  [key: string]: unknown;
}

/**
 * 创建请求 options
 * @param query 调用方传入的可选参数
 * @param crypto 加密方式
 * @returns 请求 options
 */
export const createOption = (query: Query, crypto: CryptoMode | "" = ""): RequestOptions => ({
  crypto: (query.crypto as CryptoMode | undefined) || crypto,
  cookie: query.cookie,
  ua: query.ua || "",
  realIP: query.realIP,
  ip: query.ip,
  e_r: query.e_r,
  domain: query.domain || "",
  checkToken: query.checkToken || false,
});
