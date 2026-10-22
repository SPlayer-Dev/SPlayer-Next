/** 从业务参数中提取请求层配置 */

import type { CryptoMode } from "./config";
import type { RequestOptions } from "./request";

/** 调用方传入的可选参数 */
export interface Query {
  /** 网页请求由公共层按路径装配凭据 */
  client?: "web";
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
  /** 强制附加 anti-cheat token */
  checkToken?: string | boolean;
  /** 其他可选参数 */
  [key: string]: unknown;
}

/**
 * 创建请求 options
 * @param query - 调用方传入的可选参数
 * @param crypto - 加密方式
 * @param checkToken - 是否附加 anti-cheat token（如 "v3"）
 * @returns 请求 options
 */
export const createOption = (
  query: Query,
  crypto: CryptoMode | "" = "",
  checkToken: string | boolean = false,
): RequestOptions => ({
  client: query.client,
  crypto: (query.crypto as CryptoMode | undefined) || crypto,
  cookie: query.cookie,
  ua: query.ua || "",
  realIP: query.realIP,
  ip: query.ip,
  e_r: query.e_r,
  domain: query.domain || "",
  checkToken: query.checkToken || checkToken,
});

/**
 * 为浏览器环境提供一致的请求配置，SDK 是否启用由路径规则决定
 * @param query - 业务接口接收到的请求参数
 * @returns 使用网页加密与公共会话的请求配置
 */
export const createWebOption = (query: Query): RequestOptions => ({
  ...createOption(query, "weapi"),
  crypto: "weapi",
  client: "web",
});
