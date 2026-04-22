/**
 * 判断是否为真实外链（http/https）
 * @param url 链接地址
 * @returns 是否为真实外链
 */
export const isExternalUrl = (url?: string | null): url is string =>
  !!url && /^https?:\/\//i.test(url);

/**
 * 打开外链
 * @param url 链接地址
 */
export const openExternal = (url?: string | null): void => {
  if (!isExternalUrl(url)) return;
  window.open(url, "_blank");
};
