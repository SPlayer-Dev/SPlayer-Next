/**
 * 歌词（KG）
 *
 * 两步流程：
 *   1. GET lyrics.kugou.com/search?keyword=&hash=&timelength=  →  取第一候选 {id, accesskey, fmt}
 *   2. GET lyrics.kugou.com/download?id=&accesskey=&fmt=        →  base64 content
 *       - fmt=krc：XOR+zlib 解密 → LRC + 逐字 KRC + 翻译 + 罗马音
 *       - fmt=lrc：base64 直接 utf8 解码 → 只有 LRC
 *
 * 调用这个接口必须同时提供 hash + 歌名 + 时长（秒），这是 KG 的硬要求
 *
 * params:
 * - hash       文件 hash（搜索结果里的 hash / hashes['128k'] 等）
 * - name       歌曲名（URL encode）
 * - duration   时长（秒）
 */

import {
  KG_LYRIC_DOWNLOAD_URL,
  KG_LYRIC_HEADERS,
  KG_LYRIC_SEARCH_URL,
  intervalToSeconds,
} from "../core/config";
import { kgRequest } from "../core/request";
import { decodeKrc } from "../core/krc";
import type { KGModule } from "../core/types";

interface KGLyricCandidate {
  id: string;
  accesskey: string;
  /** 1 = 逐字，0 = 行级 */
  krctype?: number;
  contenttype?: number;
}

interface KGLyricSearchResp {
  candidates?: KGLyricCandidate[];
}

interface KGLyricDownloadResp {
  fmt?: string;
  content?: string;
}

interface LyricOut {
  code: number;
  lrc?: string;
  krc?: string;
  trans?: string;
  roma?: string;
  message?: string;
}

const lyric: KGModule = async (params) => {
  const {
    hash,
    name = "",
    duration,
  } = params as {
    hash?: string;
    name?: string;
    duration?: number | string;
  };

  if (!hash) return { code: 400, message: "hash required" } satisfies LyricOut;

  const seconds = intervalToSeconds(duration);

  try {
    // 第 1 步：按 hash+name+时长 查候选
    const searchUrl =
      `${KG_LYRIC_SEARCH_URL}?ver=1&man=yes&client=pc&lrctxt=1` +
      `&keyword=${encodeURIComponent(name)}` +
      `&hash=${encodeURIComponent(hash)}` +
      `&timelength=${seconds}`;
    const searchResp = await kgRequest<KGLyricSearchResp>(searchUrl, {
      headers: KG_LYRIC_HEADERS,
    });

    const candidate = searchResp.candidates?.[0];
    if (!candidate) return { code: 404, message: "no lyric candidate" } satisfies LyricOut;

    const fmt = candidate.krctype === 1 && candidate.contenttype !== 1 ? "krc" : "lrc";

    // 第 2 步：下载 + 解码
    const downloadUrl =
      `${KG_LYRIC_DOWNLOAD_URL}?ver=1&client=pc&charset=utf8` +
      `&id=${encodeURIComponent(candidate.id)}` +
      `&accesskey=${encodeURIComponent(candidate.accesskey)}` +
      `&fmt=${fmt}`;
    const dl = await kgRequest<KGLyricDownloadResp>(downloadUrl, {
      headers: KG_LYRIC_HEADERS,
    });

    if (!dl.content) return { code: 404, message: "empty lyric" } satisfies LyricOut;

    if (dl.fmt === "krc") {
      const parsed = await decodeKrc(dl.content);
      return {
        code: 200,
        lrc: parsed.lrc,
        krc: parsed.krc,
        trans: parsed.trans || undefined,
        roma: parsed.roma || undefined,
      } satisfies LyricOut;
    }

    if (dl.fmt === "lrc") {
      return {
        code: 200,
        lrc: Buffer.from(dl.content, "base64").toString("utf8"),
      } satisfies LyricOut;
    }

    return { code: 500, message: `unknown lyric fmt: ${dl.fmt}` } satisfies LyricOut;
  } catch (err) {
    return {
      code: 500,
      message: err instanceof Error ? err.message : String(err),
    } satisfies LyricOut;
  }
};

export default lyric;
