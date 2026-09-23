import { readFile } from "node:fs/promises";

// 复用 TextDecoder 实例
const utf8Decoder = new TextDecoder("utf-8");
const utf16leDecoder = new TextDecoder("utf-16le");
const utf16beDecoder = new TextDecoder("utf-16be");
const gb18030Decoder = new TextDecoder("gb18030");
// fatal 模式：非法 UTF-8 字节抛 TypeError，用于探测
const utf8StrictDecoder = new TextDecoder("utf-8", { fatal: true });

/**
 * 检测 Buffer 编码并解码为字符串
 *
 * 检测顺序：
 * 1. BOM 标记（UTF-8 BOM / UTF-16 LE/BE BOM）
 * 2. 严格 UTF-8 验证（fatal TextDecoder，含过长编码/代理区检查）
 * 3. 回退 gb18030（向下兼容 GBK / GB2312，覆盖中文 Windows 环境常见编码）
 *
 * @param buf - 文件原始字节
 * @returns 解码后的字符串
 */
export const decodeAuto = (buf: Buffer): string => {
  if (buf.length === 0) return "";

  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return utf8Decoder.decode(buf.subarray(3));
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return utf16leDecoder.decode(buf.subarray(2));
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return utf16beDecoder.decode(buf.subarray(2));
  }

  try {
    return utf8StrictDecoder.decode(buf);
  } catch {
    // 非 UTF-8 时回退 gb18030（中文 Windows 最常见的非 UTF-8 编码）
    return gb18030Decoder.decode(buf);
  }
};

/**
 * 读取文件并自动检测编码解码为字符串
 * @param filePath - 文件路径
 * @returns 解码后的字符串
 */
export const readFileAutoEncoding = async (filePath: string): Promise<string> => {
  const buf = await readFile(filePath);
  return decodeAuto(buf);
};
