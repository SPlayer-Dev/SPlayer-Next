import type { KGModule } from "../core/types";
import { ensureKugouDfid } from "../core/device";
import { getDeviceMid, signKey } from "../core/crypto";
import { kgGatewayRequest } from "../core/request";
import { getSessionCookies } from "@main/database/sessions";
import { isKugouConceptMode, getKgAppid, getKgClientver } from "../core/config";
import { coreLog } from "@main/utils/logger";

/** 音质档位，按从低到高排序 */
const QUALITY_LEVELS = ["128", "320", "flac", "high"] as const;
type QualityLevel = (typeof QUALITY_LEVELS)[number];

const QUALITY_MAP: Record<string, QualityLevel> = {
  "hi-res": "high",
  lossless: "flac",
  hq: "320",
  sq: "128",
  lq: "128",
};

interface PrivilegeVariant {
  hash?: string;
  level?: number;
  quality?: string;
}

interface PrivilegeData {
  data?: Array<PrivilegeVariant & { relate_goods?: PrivilegeVariant[] }>;
}

const extractUrls = (response: Record<string, unknown>): string[] =>
  [response.url, response.backup_url]
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === "string" && value.length > 0);

/**
 * privilege/lite 枚举账号在各音质档位可用的变体（每档的 hash 可能与原始 hash 不同）
 * @returns quality → hash 映射；无权益时为空
 */
const fetchLiteQualityOptions = async (
  hash: string,
  albumId: number,
): Promise<Map<QualityLevel, string>> => {
  const resp = await kgGatewayRequest<PrivilegeData>("/v2/get_res_privilege/lite", {
    method: "POST",
    headers: { "x-router": "media.store.kugou.com" },
    data: {
      appid: getKgAppid(),
      clientver: getKgClientver(),
      area_code: 1,
      behavior: "play",
      need_hash_offset: 1,
      relate: 1,
      support_verify: 1,
      resource: [{ type: "audio", page_id: 0, hash, album_id: albumId }],
      qualities: QUALITY_LEVELS,
    },
  });
  const options = new Map<QualityLevel, string>();
  for (const item of resp.data ?? []) {
    for (const variant of [item, ...(item.relate_goods ?? [])]) {
      const quality = variant.quality as QualityLevel | undefined;
      if (!variant.hash || variant.level === 0) continue;
      if (!quality || !QUALITY_LEVELS.includes(quality) || options.has(quality)) continue;
      options.set(quality, variant.hash);
    }
  }
  return options;
};

/**
 * 请求单档音质直链（标准版/概念版参数自动切换）
 * @returns 直链列表；为空表示该档不可用
 */
const requestUrl = async (
  hash: string,
  quality: string,
  albumId: number,
  audioId: number,
  userid: number,
  freePart: boolean,
): Promise<Record<string, unknown>> => {
  const concept = isKugouConceptMode();
  return await kgGatewayRequest<Record<string, unknown>>("/v5/url", {
    params: {
      album_id: albumId,
      area_code: 1,
      hash,
      ssa_flag: "is_fromtrack",
      version: 11430,
      page_id: concept ? 967177915 : 151369488,
      quality,
      album_audio_id: audioId,
      behavior: "play",
      pid: concept ? 411 : 2,
      cmd: 26,
      pidversion: 3001,
      IsFreePart: freePart ? 1 : 0,
      ppage_id: concept ? "356753938,823673182,967485191" : "463467626,350369493,788954147",
      cdnBackup: 1,
      module: "",
      clientver: 11430,
      key: signKey(hash, getDeviceMid(), userid),
    },
    headers: { "x-router": "trackercdn.kugou.com" },
  });
};

const songUrl: KGModule = async (params) => {
  const hash = String(params.hash ?? "").toLowerCase();
  if (!hash) throw new Error("KG song hash missing");
  await ensureKugouDfid();
  const session = getSessionCookies("kugou");
  const userid = Number(session.userid || 0);
  const albumId = Number(params.albumId ?? 0);
  const audioId = Number(params.audioId ?? 0);
  const preferred = QUALITY_MAP[String(params.level ?? "hq")] ?? "320";

  // 从偏好音质向下逐档尝试
  const fallbackChain = QUALITY_LEVELS.slice(0, QUALITY_LEVELS.indexOf(preferred) + 1).reverse();
  let candidates = fallbackChain.map((quality) => ({ hash, quality }));

  // 概念版模式下已登录账号通过 privilege/lite 取各档变体 hash
  if (isKugouConceptMode() && session.token) {
    try {
      const options = await fetchLiteQualityOptions(hash, albumId);
      const privileged = fallbackChain
        .map((quality) => ({ quality, variantHash: options.get(quality) }))
        .filter((item) => Boolean(item.variantHash))
        .map((item) => ({ hash: item.variantHash as string, quality: item.quality }));
      if (privileged.length > 0) candidates = privileged;
    } catch (err) {
      coreLog.warn("[kg-song-url] privilege/lite 失败，回退原始 hash:", err);
    }
  }

  let lastResponse: Record<string, unknown> = {};
  for (const candidate of candidates) {
    const response = await requestUrl(
      candidate.hash,
      candidate.quality,
      albumId,
      audioId,
      userid,
      Boolean(params.freePart),
    );
    lastResponse = response;
    const urls = extractUrls(response);
    if (urls.length > 0 && response.extName !== "mp4") {
      if (candidate.quality !== preferred) {
        coreLog.info(`[kg-song-url] ${preferred} 不可用，降档至 ${candidate.quality}`);
      }
      return { code: 200, data: { url: urls[0] } };
    }
  }
  return {
    code: Number(lastResponse.errcode ?? 500),
    message: String(lastResponse.error ?? ""),
    data: undefined,
  };
};

export default songUrl;
