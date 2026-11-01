/**
 * AMLL TTML DB 抓取
 *
 * 设计：
 * - 默认请求官方 API（api.amll.dev），按平台 ID 查询，返回 JSON 中的 TTML 文本
 * - 用户配置了镜像模板时改走镜像：模板含 %s（id），可选 %p（平台目录），代码替换
 *   - NCM → "ncm-lyrics"
 *   - QM  → "qq-lyrics"（mid 或数字 id 都可能命中，由调用方传入候选）
 */

import { appVersion } from "@main/utils/config";
import { coreLog } from "@main/utils/logger";
import { store } from "@main/store";
import {
  getCachedTTML,
  setCachedTTML,
  type Platform as TtmlPlatform,
} from "@main/database/lyricTtmlCache";

const TIMEOUT_MS = 8000;

/** AMLL */
const OFFICIAL_API = "https://api.amll.dev/v1/lyrics/get";

const USER_AGENT = `SPlayer-Next/${appVersion} (https://github.com/SPlayer-Dev/SPlayer-Next)`;

const inflight = new Map<string, Promise<string | null>>();

/**
 * 拼装请求地址
 * @param platform - 平台
 * @param id - 平台歌曲 ID
 * @returns 请求地址与是否为官方 API
 */
const buildUrl = (platform: TtmlPlatform, id: string): { url: string; official: boolean } => {
  const mirror = store.get("lyric.amllDbServer");
  if (mirror) {
    const path = platform === "netease" ? "ncm-lyrics" : "qq-lyrics";
    return {
      url: mirror.replace("%p", path).replace("%s", encodeURIComponent(id)),
      official: false,
    };
  }
  const query = platform === "netease" ? "ncmMusicId" : "qqMusicId";
  return { url: `${OFFICIAL_API}?${query}=${encodeURIComponent(id)}`, official: true };
};

/** 真正发起一次抓取，处理缓存读写、URL 拼装、错误分类 */
const doFetch = async (platform: TtmlPlatform, id: string): Promise<string | null> => {
  // 开关关闭时短路，让预热调用零成本
  if (!store.get("lyric.enableOnlineTTMLLyric")) return null;

  const cached = getCachedTTML(platform, id);
  if (cached?.fresh) return cached.content;
  const stale = cached?.content ?? null;

  const { url, official } = buildUrl(platform, id);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 200) {
      const content = official
        ? ((await res.json()) as { data?: { lyrics?: string } }).data?.lyrics
        : await res.text();
      // 接口偶尔会返回 200 但 body 为空，按负缓存处理
      if (!content?.trim()) {
        setCachedTTML(platform, id, null);
        return null;
      }
      setCachedTTML(platform, id, content);
      return content;
    }
    if (res.status === 404) {
      setCachedTTML(platform, id, null);
      return null;
    }
    // 其它状态码（429 / 5xx 等）不写缓存，下次重试
    coreLog.warn(`[ttml] ${platform}:${id} HTTP ${res.status}`);
    return stale;
  } catch (err) {
    coreLog.warn(`[ttml] ${platform}:${id} fetch failed:`, err);
    return stale;
  }
};

/** 单 id 抓取 + inflight 去重，仅内部使用 */
const fetchOne = (platform: TtmlPlatform, id: string): Promise<string | null> => {
  const key = `${platform}:${id}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = doFetch(platform, id).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
};

/**
 * 依次尝试多个候选 id，命中即停。
 * - NCM 通常只传 [id]
 * - QM 传 [mid, id]：AMLL DB 里两种 key 都可能存在，逐一回落
 * 失败的 id 会被写入负缓存，后续重试零网络。
 */
export const fetchTTML = async (
  platform: TtmlPlatform,
  ids: readonly string[],
): Promise<string | null> => {
  for (const id of ids) {
    if (!id) continue;
    const result = await fetchOne(platform, id);
    if (result) return result;
  }
  return null;
};

/**
 * 预热抓取：在 id 已确定的最早瞬间发出 TTML 请求。
 * 渲染端后续的 fetchTTMLOverlay 调用会通过 inflight Map 复用同一个 Promise。
 */
export const prefetchTTML = (platform: TtmlPlatform, ids: readonly string[]): void => {
  void fetchTTML(platform, ids);
};
