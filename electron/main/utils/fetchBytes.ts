/**
 * 把任意远端 URL 拉成字节，给 SMTC 高清封面用
 *
 * 主进程要拿封面字节是因为系统媒体集成 API 接受 Buffer，
 * 而渲染层的 Blob 跨进程传输不方便。其它 streaming 调用都在渲染层完成
 */

/** 默认 15s 超时 */
const DEFAULT_TIMEOUT_MS = 15_000;
/** 最大允许 5MB */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * 获取远端 URL 的字节
 * @param url 
 * @param timeoutMs 
 * @returns 
 */
export const fetchBytes = async (
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Buffer | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};
