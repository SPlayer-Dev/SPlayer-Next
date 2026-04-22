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
import { decodeName } from "./config";

const inflateAsync = promisify(inflate);

const KRC_KEY = Uint8Array.from([
  0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69,
]);

/** base64 → XOR → inflate → 文本 */
const decryptKrc = async (base64: string): Promise<string> => {
  if (!base64) throw new Error("empty krc content");
  const buf = Buffer.from(base64, "base64").subarray(4);
  for (let i = 0; i < buf.length; i++) buf[i] ^= KRC_KEY[i % 16];
  const out = await inflateAsync(buf);
  return out.toString("utf8");
};

const HEAD_ID_REG = /^.*\[id:\$\w+\]\n/;
const LANGUAGE_REG = /\[language:([\w=\\/+]+)\]/;
const LANGUAGE_LINE_REG = /\[language:[\w=\\/+]+\]\n/;
const LINE_TIME_REG = /\[((\d+),\d+)\].*/g;
const LINE_TIME_EACH_REG = /\[((\d+),\d+)\].*/;

/** 把毫秒格式化成 `MM:SS.xxx` */
const msToTimeTag = (ms: number): string => {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const x = Math.floor(ms % 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${x}`;
};

export interface KrcParsed {
  lrc: string;
  krc: string;
  trans: string;
  roma: string;
}

/** 解析解密后的 KRC 文本 → 四种歌词 */
const parseKrc = (raw: string): KrcParsed => {
  let text = raw.replace(/\r/g, "");
  if (HEAD_ID_REG.test(text)) text = text.replace(HEAD_ID_REG, "");

  // 翻译 & 罗马音以 [language:base64(json)] 整体嵌入
  let transLines: string[] | undefined;
  let romaLines: string[] | undefined;
  const langMatch = text.match(LANGUAGE_REG);
  if (langMatch) {
    text = text.replace(LANGUAGE_LINE_REG, "");
    try {
      const json = JSON.parse(Buffer.from(langMatch[1], "base64").toString("utf8")) as {
        content?: Array<{ type: number; lyricContent: string[][] }>;
      };
      for (const item of json.content ?? []) {
        const lines = item.lyricContent.map((arr) => arr.join(""));
        if (item.type === 0) romaLines = lines;
        else if (item.type === 1) transLines = lines;
      }
    } catch {
      // 译文解析失败不影响主歌词
    }
  }

  // 逐行替换行首时间标签：把 [start_ms,dur_ms] 改成 [MM:SS.xxx]
  // 同时按行索引同步给翻译/罗马音补上时间头
  let idx = 0;
  let krcBody = text.replace(LINE_TIME_REG, (line) => {
    const match = line.match(LINE_TIME_EACH_REG);
    if (!match) return line;
    const startMs = parseInt(match[2], 10);
    const timeTag = msToTimeTag(startMs);
    if (romaLines && romaLines[idx] !== undefined) romaLines[idx] = `[${timeTag}]${romaLines[idx]}`;
    if (transLines && transLines[idx] !== undefined)
      transLines[idx] = `[${timeTag}]${transLines[idx]}`;
    idx++;
    return line.replace(match[1], timeTag);
  });

  // 字级时间标签 <offset,dur,0> → <offset,dur>（去除末尾的 0）
  krcBody = krcBody.replace(/<(\d+,\d+),\d+>/g, "<$1>");
  const krc = decodeName(krcBody);
  const lrc = krc.replace(/<\d+,\d+>/g, "");

  return {
    lrc,
    krc,
    trans: decodeName(transLines ? transLines.join("\n") : ""),
    roma: decodeName(romaLines ? romaLines.join("\n") : ""),
  };
};

/** 解密并解析一段 KRC base64 内容 */
export const decodeKrc = async (base64Content: string): Promise<KrcParsed> => {
  const text = await decryptKrc(base64Content);
  return parseKrc(text);
};
