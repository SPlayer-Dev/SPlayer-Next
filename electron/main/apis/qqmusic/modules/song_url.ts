/**
 * QM 单曲播放链接解析模块
 * 支持微信扫码与 QQ 扫码凭证的直链解析及多音质降级
 */

import { randomUUID } from "node:crypto";
import { getQQMusicCookies, getQQMusicUin, refreshQMCredential } from "../core/request";
import { sessionToCookieHeader } from "../core/credential";
import { coreLog } from "@main/utils/logger";
import type { QMModule } from "../core/types";

interface QualityCandidate {
  prefix: string;
  ext: string;
  level: string;
  label: string;
}

const QQ_QUALITY_CANDIDATE_TEMPLATES: QualityCandidate[] = [
  { prefix: "AI00", ext: ".flac", level: "hi-res", label: "Hi-Res FLAC" },
  { prefix: "F000", ext: ".flac", level: "lossless", label: "无损 FLAC" },
  { prefix: "M800", ext: ".mp3", level: "hq", label: "320k MP3" },
  { prefix: "M500", ext: ".mp3", level: "sq", label: "128k MP3" },
  { prefix: "C400", ext: ".m4a", level: "lq", label: "标准 AAC" },
];

/** 根据用户的首选音质生成顺位候选列表 */
const getQualityCandidates = (preferredLevel: string): QualityCandidate[] => {
  const target = String(preferredLevel || "hq").toLowerCase();
  const targetIndex = QQ_QUALITY_CANDIDATE_TEMPLATES.findIndex((t) => t.level === target);
  if (targetIndex >= 0) {
    return QQ_QUALITY_CANDIDATE_TEMPLATES.slice(targetIndex);
  }
  return QQ_QUALITY_CANDIDATE_TEMPLATES;
};

const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** QQ 系 CSRF token 算法 */
const hash33 = (str: string, seed = 0): number => {
  let h = seed;
  for (const ch of str) h = (((h << 5) + h + ch.codePointAt(0)!) & 0xffffffff) >>> 0;
  return h & 2147483647;
};

interface MidUrlInfo {
  songmid?: string;
  filename?: string;
  purl?: string;
  result?: number;
}

interface VkeyPayload {
  midurlinfo?: MidUrlInfo[];
  sip?: string[];
}

interface VkeyResponse {
  code?: number;
  req_0?: {
    code?: number;
    data?: VkeyPayload;
  };
}

const songUrl: QMModule = async (params) => {
  const mid = String(params.mid || params.id || "").trim();
  if (!mid) return { code: 400, message: "missing mid" };

  const mediaMid = String(params.mediaMid || "").trim();
  const fileBase = mediaMid || `${mid}${mid}`;

  const targetLevel = String(params.level || "hq");
  const candidates = getQualityCandidates(targetLevel);
  const filenames = candidates.map((c) => `${c.prefix}${fileBase}${c.ext}`);

  const requestUrl = async () => {
    const cookies = getQQMusicCookies();
    const uin = getQQMusicUin();
    const musickey = cookies.qm_keyst || cookies.qqmusic_key || "";
    const cookieStr = sessionToCookieHeader(cookies);
    const gtk = hash33(musickey, 5381);
    const guid = randomUUID().replace(/-/g, "");

    const body = {
      comm: {
        uin: uin !== "0" ? uin : "",
        format: "json",
        ct: 24,
        cv: 4747474,
        platform: "yqq.json",
        chid: "0",
        g_tk: gtk,
        g_tk_new_20200303: gtk,
        inCharset: "utf-8",
        outCharset: "utf-8",
        notice: 0,
        needNewCode: 1,
      },
      req_0: {
        module: "music.vkey.GetVkey",
        method: "UrlGetVkey",
        param: {
          guid,
          songmid: filenames.map(() => mid),
          filename: filenames,
          songtype: filenames.map(() => 0),
          uin: uin !== "0" ? uin : "",
          ctx: 0,
        },
      },
    };

    const res = await fetch("https://u.y.qq.com/cgi-bin/musicu.fcg", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookieStr ? { Cookie: cookieStr } : {}),
        Referer: "https://y.qq.com/",
        Origin: "https://y.qq.com",
        "User-Agent": WEB_UA,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });

    const json = (await res.json()) as VkeyResponse;
    const data = json.code === 0 && json.req_0?.code === 0 ? json.req_0.data : null;
    const infos = data?.midurlinfo ?? [];
    const sip =
      data?.sip?.find((s) => s.startsWith("http")) || "https://isure.stream.qqmusic.qq.com/";

    return candidates
      .map((cand) => {
        const matchFilename = `${cand.prefix}${fileBase}${cand.ext}`;
        const found = infos.find((item) => item.filename === matchFilename && !!item.purl);
        return found
          ? {
              cand,
              url: found.purl!.startsWith("http") ? found.purl! : `${sip}${found.purl}`,
            }
          : undefined;
      })
      .find((item): item is NonNullable<typeof item> => !!item);
  };

  const cookies = getQQMusicCookies();
  const hasCredential = !!(cookies.qm_keyst || cookies.qqmusic_key);

  coreLog.debug("[qm-song-url] 发起直链解析:", mid, targetLevel, {
    uin: getQQMusicUin(),
    loggedIn: hasCredential,
  });

  try {
    let matched = await requestUrl();
    if (!matched && hasCredential) {
      coreLog.warn("[qm-song-url] 携带凭据未命中播放直链，尝试刷新凭据重试");
      const refreshed = await refreshQMCredential();
      if (refreshed) {
        matched = await requestUrl();
      }
    }

    if (matched) {
      coreLog.info(
        `[qm-song-url] 成功命中直链: ${mid} -> ${matched.cand.label} (${matched.cand.level})`,
      );

      return {
        code: 200,
        data: [
          {
            id: mid,
            url: matched.url,
            level: matched.cand.level,
            format: matched.cand.ext.replace(".", ""),
            isFallback: matched.cand.level !== targetLevel,
          },
        ],
      };
    }
  } catch (err) {
    coreLog.error("[qm-song-url] 直链解析请求异常:", err);
  }

  return {
    code: 403,
    message: "无法获取播放链接，可能需要 VIP 或无版权",
    data: [{ id: mid, url: "" }],
  };
};

export default songUrl;
