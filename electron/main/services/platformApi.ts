import { callNetease } from "@main/apis/netease";
import { callQQMusic } from "@main/apis/qqmusic";
import { callKugou } from "@main/apis/kugou";
import { NeteaseRequestError } from "@main/apis/netease/core/response";
import { coreLog } from "@main/utils/logger";
import type { ApiPlatform, ApiCallResponse } from "@shared/types/apis";

/**
 * 界面和插件共用全部已注册的平台接口，沿用原始业务响应
 * @param platform - 音乐平台
 * @param name - 模块名；NCM也支持 /api/ 路径
 * @param params - 平台接口参数
 * @returns 与渲染端一致的响应包装
 */
export const callPlatformApi = async (
  platform: ApiPlatform,
  name: string,
  params: Record<string, unknown> = {},
): Promise<ApiCallResponse> => {
  try {
    switch (platform) {
      case "netease": {
        const result = await callNetease(name, params);
        return { ok: true, status: result.status, body: result.body };
      }
      case "qqmusic":
        return { ok: true, data: await callQQMusic(name, params) };
      case "kugou":
        return { ok: true, data: await callKugou(name, params) };
      default:
        throw new Error(`unknown platform: ${platform}`);
    }
  } catch (error) {
    coreLog.warn(`[apis] ${platform}.${name} failed:`, error);
    if (error instanceof NeteaseRequestError) {
      return {
        ok: false,
        error: error.message,
        status: error.response.status,
        body: error.response.body,
      };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};
