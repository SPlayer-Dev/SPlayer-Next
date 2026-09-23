/**
 * 易盾反作弊 Token 获取服务
 *
 * 通过易盾官方 v3 端点获取实时 Token，供风控严格的接口（如 like_v1）附加 X-antiCheatToken 请求头使用。
 * 每次获取均不缓存，模拟真实客户端请求行为。
 */

import { DUN_DOMAIN_V3 } from "./config";
import { fetchWithProxy } from "@main/utils/proxy";
import { neteaseLog } from "@main/utils/logger";

const PRODUCT_NUMBER = "YD00000558929251";

/**
 * 实时从易盾获取反作弊 Token (v3)
 * @returns 成功返回 token 字符串，失败返回空字符串
 */
export const getAntiCheatTokenV3 = async (): Promise<string> => {
  const url = `${DUN_DOMAIN_V3}/v3/b?pn=${PRODUCT_NUMBER}`;
  try {
    const res = await fetchWithProxy(url, { signal: AbortSignal.timeout(8000) });
    const text = await res.text();
    const match = text.match(/null\(\[(\d+),\d+,"([^"]+)"\]\)/);
    if (match && match[1] === "200") {
      return match[2];
    }
    neteaseLog.warn(`[checkToken] 易盾返回异常: ${text.slice(0, 80)}`);
    return "";
  } catch (err) {
    neteaseLog.warn("[checkToken] 获取易盾 token 失败:", err);
    return "";
  }
};
