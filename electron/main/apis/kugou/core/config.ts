import { store } from "@main/store";

/**
 * KG API 通用常量与工具
 */

/** KG网关地址 */
export const KG_GATEWAY_URL = "https://gateway.kugou.com";

/** KG客户端标识 */
export const KG_APPID = 1005;
export const KG_CLIENTVER = 20489;

/** 概念版（lite）客户端标识 */
export const KG_LITE_APPID = 3116;
export const KG_LITE_CLIENTVER = 11440;

/**
 * 是否启用概念版模式（登录、签名与播放解析整体切换到 lite 标识）
 */
export const isKugouConceptMode = (): boolean =>
  store.get("system.kugouLoginVersion") === "concept";

/** 按模式取 appid */
export const getKgAppid = (): number => (isKugouConceptMode() ? KG_LITE_APPID : KG_APPID);

/** 按模式取 clientver */
export const getKgClientver = (): number =>
  isKugouConceptMode() ? KG_LITE_CLIENTVER : KG_CLIENTVER;

/** 主搜索（带封面）：mobilecdn 的 /api/v3/search/song */
export const KG_MOBILECDN_URL = "http://mobilecdn.kugou.com/api/v3/search/song";

/** 兜底搜索：老 songsearch */
export const KG_SEARCH_URL = "https://songsearch.kugou.com/song_search_v2";

/** 歌词搜索/下载接口（走 lyrics.kugou.com 的 expand_search 通道） */
export const KG_LYRIC_SEARCH_URL = "http://lyrics.kugou.com/search";
export const KG_LYRIC_DOWNLOAD_URL = "http://lyrics.kugou.com/download";

/** 歌词接口伪装 headers（来自 KuGou2012 PC 客户端） */
export const KG_LYRIC_HEADERS: Record<string, string> = {
  "KG-RC": "1",
  "KG-THash": "expand_search_manager.cpp:852736169:451",
  "User-Agent": "KuGou2012-9020-ExpandSearchManager",
};

/** HTML 实体反转义 */
const ENTITY_MAP: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#039;": "'",
};

/**
 * 实体反转义与清洗
 * @param str - 原始字符串
 * @returns 清洗后的字符串
 */
export const decodeName = (str: string | null | undefined): string => {
  if (!str) return "";
  return str.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&apos;|&#039;/g, (s) => ENTITY_MAP[s] ?? s);
};

/**
 * 安全升级 http 链接为 https
 * @param url - 原始 URL
 * @returns 安全 URL
 */
export const secureUrl = (url: string | undefined): string =>
  url?.replace(/^http:\/\//, "https://") ?? "";

/**
 * 填充并安全化KG图片模板（如替换 {size} 占位符）
 * @param url - 封面 URL
 * @param size - 尺寸
 * @returns 最终封面 URL
 */
export const fillCover = (url: string | undefined, size = 300): string | undefined => {
  if (!url) return undefined;
  const replaced = url.replace(/\{size\}/g, String(size));
  return secureUrl(replaced);
};

/**
 * 格式化歌手数组
 * @param singers - 歌手列表
 * @param join - 连接符
 * @returns 格式化后的歌手名
 */
export const formatSingerName = (
  singers: Array<{ name?: string }> | undefined,
  join = " / ",
): string => {
  if (!singers?.length) return "";
  return singers
    .map((s) => s.name)
    .filter((n): n is string => !!n)
    .map(decodeName)
    .join(join);
};

/**
 * 把 `MM:SS` / `HH:MM:SS` 格式的时长字符串转成秒
 * @param interval - 时长
 * @returns 秒数
 */
export const intervalToSeconds = (interval: string | number | undefined): number => {
  if (typeof interval === "number") return Math.floor(interval);
  if (!interval) return 0;
  const parts = String(interval).split(":").map(Number);
  let seconds = 0;
  let unit = 1;
  while (parts.length) {
    const v = parts.pop();
    if (Number.isFinite(v)) seconds += (v as number) * unit;
    unit *= 60;
  }
  return Math.floor(seconds);
};
