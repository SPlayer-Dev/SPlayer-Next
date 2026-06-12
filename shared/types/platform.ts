/** 平台类型 */
export type Platform = "netease" | "qqmusic" | "kugou" | "qishui";

/** 平台简写 */
export const PLATFORM_SHORT_NAME: Record<Platform, string> = {
  netease: "NCM",
  qqmusic: "QM",
  kugou: "KG",
  qishui: "QS",
};

/** 全部「可搜索/可播放」平台（汽水仅作歌词源，不进此列，故不出现在搜索 tab） */
export const ALL_PLATFORMS: Platform[] = ["netease", "qqmusic", "kugou"];

const PLATFORM_SET = new Set<string>(ALL_PLATFORMS);

/** 判断给定 source 是否为在线平台（netease / qqmusic / kugou），同时类型收窄 */
export const isPlatform = (source: string | undefined): source is Platform =>
  source !== undefined && PLATFORM_SET.has(source);
