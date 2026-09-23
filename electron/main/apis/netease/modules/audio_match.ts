/**
 * 听歌识曲匹配
 *
 * 该端点接收 AFP 指纹，不使用网易云常规加密与登录态
 */

import { randomBytes } from "node:crypto";
import { fetchWithProxy } from "@main/utils/proxy";
import type { NeteaseModule } from "../core/types";

const MATCH_URL = "https://interface.music.163.com/api/music/audio/match";

const audioMatch: NeteaseModule = async (query) => {
  const fingerprint = typeof query.audioFP === "string" ? query.audioFP : "";
  const duration = Number(query.duration);
  if (!fingerprint || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("无效的听歌识曲参数");
  }

  const params = new URLSearchParams({
    sessionId: randomBytes(8).toString("hex"),
    algorithmCode: "shazam_v2",
    duration: String(duration),
    rawdata: fingerprint,
    times: "1",
    decrypt: "1",
  });
  const response = await fetchWithProxy(`${MATCH_URL}?${params}`, {
    headers: {
      Accept: "application/json",
      Referer: "https://music.163.com/",
      "User-Agent": "Mozilla/5.0",
    },
    signal: AbortSignal.timeout(8_000),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`网易云听歌识曲请求失败: HTTP ${response.status}`);
  }
  return { status: response.status, body, cookie: [] };
};

export default audioMatch;
