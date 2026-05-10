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
 *
 * 流式累加并按 MAX_BYTES 提前 abort，避免恶意/异常服务器返回 GB 级 body 时
 * 把主进程内存吃光（res.arrayBuffer() 会无视 5MB 上限先全部缓冲）
 *
 * @param url 目标 URL
 * @param timeoutMs 总超时（包含读 body）
 */
export const fetchBytes = async (
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Buffer | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) return null;

    // Content-Length 优先：超 MAX_BYTES 直接拒绝，不开始读
    const contentLength = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) return null;

    // 流式读取，累计超 MAX_BYTES 时 abort 释放底层 socket
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) {
        controller.abort();
        return null;
      }
      chunks.push(value);
    }
    if (total === 0) return null;
    return Buffer.concat(chunks, total);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};
