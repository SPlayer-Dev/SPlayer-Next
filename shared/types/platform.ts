/** 平台类型 */
export type Platform = "netease" | "qqmusic" | "kugou" | "bd";

/** 平台简写 */
export const PLATFORM_SHORT_NAME: Record<Platform, string> = {
  netease: "NCM",
  qqmusic: "QM",
  kugou: "KG",
  bd: "BD",
};

/** 全部平台 */
export const ALL_PLATFORMS: Platform[] = ["netease", "qqmusic", "kugou", "bd"];

export type PlatformSearchCategory = "songs" | "albums" | "artists" | "playlists";

export const getPlatformSearchCategories = (platform: Platform): PlatformSearchCategory[] =>
  platform === "bd"
    ? ["songs", "artists", "playlists"]
    : ["songs", "albums", "artists", "playlists"];

const PLATFORM_SET = new Set<string>(ALL_PLATFORMS);

/** 判断给定 source 是否为在线平台，同时类型收窄 */
export const isPlatform = (source: string | undefined): source is Platform =>
  source !== undefined && PLATFORM_SET.has(source);

/** 平台用户账号资料 */
export interface PlatformProfile {
  userId: string;
  nickname: string;
  avatarUrl: string;
  isVip: boolean;
  vipLevel?: number;
}
