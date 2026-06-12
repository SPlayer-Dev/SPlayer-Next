/**
 * QS(汽水音乐) API 通用常量
 *
 * 走汽水网页版接口（api.qishui.com/luna/pc/*）：明文 JSON、无签名、无 Cookie，
 * 仅靠 Chrome PC UA 伪装。
 */

/** 搜索端点 */
export const QS_SEARCH_URL = "https://api.qishui.com/luna/pc/search/track";

/** 单曲详情（含逐字歌词）端点 */
export const QS_TRACK_URL = "https://api.qishui.com/luna/pc/track_v2";

/** web 公共查询参数 */
export const QS_WEB_PARAMS: Record<string, string> = {
  aid: "386088",
  device_platform: "web",
  channel: "pc_web",
};

/** 伪装 PC 浏览器的 headers */
export const QS_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
};

/** 歌手数组 `[{name}]` → "A / B" */
export const formatArtists = (artists: Array<{ name?: string }> | undefined): string => {
  if (!artists?.length) return "";
  return artists
    .map((item) => item.name)
    .filter((name): name is string => !!name)
    .join(" / ");
};
