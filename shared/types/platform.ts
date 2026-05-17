/** 平台类型 */
export type Platform = "netease" | "qqmusic" | "kugou";

/** 平台简写 */
export const PLATFORM_SHORT_NAME: Record<Platform, string> = {
  netease: "NCM",
  qqmusic: "QM",
  kugou: "KG",
};

/** 全部平台 */
export const ALL_PLATFORMS: Platform[] = ["netease", "qqmusic", "kugou"];

const PLATFORM_SET = new Set<string>(ALL_PLATFORMS);

/** 判断给定 source 是否为在线平台（netease / qqmusic / kugou），同时类型收窄 */
export const isPlatform = (source: string | undefined): source is Platform =>
  source !== undefined && PLATFORM_SET.has(source);
