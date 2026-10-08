/**
 * KRC 歌词解密与格式化
 *
 * 加密：base64(content) 去头 4 字节 → 与 16 字节定 key 循环 XOR → zlib inflate → UTF-8 文本
 * 文本格式示例：[285,3800]<0,120,0>字<120,200,0>字...
 *   - 行首 [start_ms, duration_ms]
 *   - 行内 <offset_ms, duration_ms, 0> 每字时间
 *
 * 本文件输出 4 种歌词：
 *   - lrc     标准 LRC（行级）
 *   - krc     逐字 LRC（LX 格式：`<offset_ms,duration_ms>字`）
 *   - trans   翻译（行级 LRC）
 *   - roma    罗马音（行级 LRC）
 *
 * key 与解析逻辑来源：lx-music-desktop/src/common/utils/lyricUtils/kg.js
 */

import { inflate } from "node:zlib";
import { promisify } from "node:util";
import { formatLrcTime, parseKRC, toLRC } from "lyric-kit";
import { decodeName } from "./config";

const inflateAsync = promisify(inflate);

const KRC_KEY = Uint8Array.from([
  0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69,
]);

/**
 * base64 → XOR → inflate → 文本
 * @param base64 - base64 编码的 KRC 密文
 * @returns 解密后的明文字符串
 */
const decryptKrc = async (base64: string): Promise<string> => {
  if (!base64) throw new Error("empty krc content");
  const buf = Buffer.from(base64, "base64").subarray(4);
  for (let i = 0; i < buf.length; i++) buf[i] ^= KRC_KEY[i % 16];
  const out = await inflateAsync(buf);
  return out.toString("utf8");
};

const HEAD_ID_REG = /^.*\[id:\$\w+\]\n/;

export interface KrcParsed {
  lrc: string;
  krc: string;
  trans: string;
  roma: string;
}

/**
 * 解析解密后的 KRC 文本 → 四种歌词
 * @param raw - 解密后的原始 KRC 文本
 * @returns 包含 lrc、krc、trans、roma 的结构体
 */
const parseKrc = (raw: string): KrcParsed => {
  let text = raw.replace(/\r/g, "");
  if (HEAD_ID_REG.test(text)) text = text.replace(HEAD_ID_REG, "");

  const result = parseKRC(text, { detectBackground: false });
  const lrc = toLRC(result.lines);

  const transLines = result.lines
    .filter((line) => line.translatedLyric)
    .map((line) => `[${formatLrcTime(line.startTime)}]${line.translatedLyric}`);

  const romaLines = result.lines
    .filter((line) => line.romanLyric)
    .map((line) => `[${formatLrcTime(line.startTime)}]${line.romanLyric}`);

  return {
    lrc: decodeName(lrc),
    krc: decodeName(text),
    trans: decodeName(transLines.join("\n")),
    roma: decodeName(romaLines.join("\n")),
  };
};

/** 解密并解析一段 KRC base64 内容 */
export const decodeKrc = async (base64Content: string): Promise<KrcParsed> => {
  const text = await decryptKrc(base64Content);
  return parseKrc(text);
};
