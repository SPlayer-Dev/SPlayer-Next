/** Netease API 通用响应包装 */
export type NeteaseCallResponse =
  | { ok: true; status: number; body: unknown }
  | { ok: false; error: string };

/** 渲染端 Netease API */
export interface NeteaseApi {
  /**
   * 调用任意 Netease 接口
   * @param name 接口名（见 `@neteasecloudmusicapienhanced/api` 的 interface.d.ts）
   * @param params 接口参数；无需传 cookie，主进程会自动注入
   */
  call: (name: string, params?: Record<string, unknown>) => Promise<NeteaseCallResponse>;
  /** 清空登录态 cookie（主进程端） */
  clearCookie: () => Promise<void>;
}
