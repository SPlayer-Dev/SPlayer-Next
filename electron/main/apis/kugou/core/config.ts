/**
 * KG API 通用常量
 */

/** 搜索接口（WebFilter 平台，无需鉴权） */
export const KG_SEARCH_URL = "https://songsearch.kugou.com/song_search_v2";

/** 歌词搜索/下载接口（走 lyrics.kugou.com 的 expand_search 通道） */
export const KG_LYRIC_SEARCH_URL = "http://lyrics.kugou.com/search";
export const KG_LYRIC_DOWNLOAD_URL = "http://lyrics.kugou.com/download";

/** 歌词接口需要的伪装 headers（来自 KuGou2012 PC 客户端） */
export const KG_LYRIC_HEADERS: Record<string, string> = {
  "KG-RC": "1",
  "KG-THash": "expand_search_manager.cpp:852736169:451",
  "User-Agent": "KuGou2012-9020-ExpandSearchManager",
};

/** HTML 实体反转义（KG 搜索结果含 `&amp;`、`&#039;` 等） */
const ENTITY_MAP: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#039;": "'",
};

export const decodeName = (str: string | null | undefined): string => {
  if (!str) return "";
  return str.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&apos;|&#039;/g, (s) => ENTITY_MAP[s] ?? s);
};

/** 歌手数组 `[{name:'A'},{name:'B'}]` → `A / B` */
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
 * 歌词接口需要秒数作为参数，而搜索结果里已有的 Duration 就是秒，这里只处理兜底情况
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
