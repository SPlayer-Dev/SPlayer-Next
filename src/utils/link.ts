/**
 * 音乐分享链接解析
 */

import type { TrackSource } from "@shared/types/player";

export type LinkType = "song" | "album" | "artist" | "playlist";

export interface ParsedLink {
  /** 资源类型 */
  type: LinkType;
  /** 资源 ID */
  id: string;
  /** 来源平台 */
  source: TrackSource;
}

/** 各平台链接匹配规则 */
const RULES: Array<{ source: TrackSource; pattern: RegExp; typeMap: Record<string, LinkType> }> = [
  {
    source: "netease",
    // 匹配两种格式：
    // 1. /song?id=123456 （PC 端）
    // 2. /song/123456/?userid=xxx （移动端分享）
    pattern:
      /music\.163\.com(?:\/#)?\/(song|album|artist|playlist)(?:\?(?:.*&)?id=(\d+)|\/(\d+)(?:\/|\?))/,
    typeMap: { song: "song", album: "album", artist: "artist", playlist: "playlist" },
  },
];

/**
 * 解析音乐分享链接
 * @param input - 用户输入的文本
 * @returns 解析结果，非链接返回 null
 */
export const parseMusicLink = (input: string): ParsedLink | null => {
  const trimmed = input.trim();
  for (const rule of RULES) {
    const match = trimmed.match(rule.pattern);
    if (!match) continue;
    const type = rule.typeMap[match[1]];
    if (!type) continue;
    // match[2] = 查询参数格式的 id，match[3] = 路径格式的 id
    const id = match[2] || match[3];
    if (!id) continue;
    return { type, id, source: rule.source };
  }
  return null;
};
