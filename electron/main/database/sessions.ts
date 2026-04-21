/**
 * 第三方音源账号会话（cookies）存储
 *
 * 表：account_sessions(platform PK, cookies JSON, updated_at)
 * - cookies 字段以 JSON 字符串存 Record<string, string>
 */

import { getDb } from "./index";

/** 支持的音源平台标识 */
export type AccountPlatform = "netease";

interface SessionRow {
  platform: string;
  cookies: string;
  updated_at: number;
}

/** 读取某平台的 cookies；未登录返回空对象 */
export const getSessionCookies = (platform: AccountPlatform): Record<string, string> => {
  const row = getDb()
    .prepare("SELECT cookies FROM account_sessions WHERE platform = ?")
    .get(platform) as Pick<SessionRow, "cookies"> | undefined;
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.cookies) as Record<string, string>;
    return parsed ?? {};
  } catch {
    return {};
  }
};

/** 整体替换某平台的 cookies（登出传 {} 即可） */
export const saveSessionCookies = (
  platform: AccountPlatform,
  cookies: Record<string, string>,
): void => {
  getDb()
    .prepare(
      `INSERT INTO account_sessions (platform, cookies, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(platform) DO UPDATE SET
         cookies = excluded.cookies,
         updated_at = excluded.updated_at`,
    )
    .run(platform, JSON.stringify(cookies), Date.now());
};

/** 清除某平台的 cookies（登出） */
export const clearSessionCookies = (platform: AccountPlatform): void => {
  saveSessionCookies(platform, {});
};
