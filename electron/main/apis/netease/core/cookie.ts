/**
 * Cookie 解析与拼装
 * 对齐 @neteasecloudmusicapienhanced/api util/index.js 中的 cookieToJson / cookieObjToString
 */

/**
 * 将 cookie 字符串转换为对象
 * @param cookie cookie 字符串
 * @returns 对象
 */
export const cookieToJson = (cookie: string | undefined): Record<string, string> => {
  if (!cookie) return {};
  const obj: Record<string, string> = {};
  for (const item of cookie.split(";")) {
    const eq = item.indexOf("=");
    if (eq <= 0) continue;
    obj[item.slice(0, eq).trim()] = item.slice(eq + 1).trim();
  }
  return obj;
};

/**
 * 将对象转换为 cookie 字符串
 * @param cookie 对象
 * @returns cookie 字符串
 */
export const cookieObjToString = (cookie: Record<string, string | number | boolean>): string =>
  Object.keys(cookie)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(cookie[key]))}`)
    .join("; ");
