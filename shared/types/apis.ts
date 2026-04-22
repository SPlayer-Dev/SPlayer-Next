/**
 * 主进程音源 API 统一类型
 */

/** 支持的音源平台 */
export type ApiPlatform = "netease" | "qqmusic" | "kugou";

/** 通用响应包装 */
export type ApiCallResponse =
  | { ok: true; status?: number; body?: unknown; data?: unknown }
  | { ok: false; error: string };

/** 渲染端统一入口 */
export interface ApisApi {
  /**
   * 调用任意音源接口
   * @param platform 音源平台
   * @param name 接口名
   * @param params 接口参数
   */
  call: (
    platform: ApiPlatform,
    name: string,
    params?: Record<string, unknown>,
  ) => Promise<ApiCallResponse>;
  /** 清空指定平台的登录态（目前仅 netease 有意义） */
  clearSession: (platform: ApiPlatform) => Promise<void>;
}
