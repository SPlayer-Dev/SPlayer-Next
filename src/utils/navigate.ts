import type { PlaybackOriginType, TrackSource } from "@shared/types/player";
import router from "@/router";

/** 支持应用内详情页跳转的平台资源类型 */
export type NavigableResourceType = Exclude<PlaybackOriginType, "track" | "page">;

/** 可作为播放来源的应用页面 */
export type PlaybackSourcePage = "library" | "liked" | "cloud" | "history";

/** 应用内资源跳转目标 */
export type ResourceNavigationTarget =
  | {
      type: NavigableResourceType;
      source?: TrackSource;
      id?: string;
      name?: string;
    }
  | {
      type: "page";
      id?: string;
      name?: string;
    };

const playbackSourcePages = new Set<PlaybackSourcePage>(["library", "liked", "cloud", "history"]);

/**
 * 解析资源详情页使用的 ID
 * 本地专辑和歌手以名称作为聚合键，其余资源必须提供真实 ID
 * @param target - 资源跳转目标
 * @returns 可用的路由 ID，不可跳转时返回 null
 */
const resolveResourceId = (target: ResourceNavigationTarget): string | null => {
  if (target.type === "page") {
    const id = target.id?.trim() as PlaybackSourcePage | undefined;
    return id && playbackSourcePages.has(id) ? id : null;
  }
  const source = target.source ?? "local";
  const candidate =
    source === "local" && (target.type === "album" || target.type === "artist")
      ? target.name
      : target.id;
  return candidate?.trim() || null;
};

/**
 * 判断资源是否具备详情页跳转条件
 * @param target - 资源跳转目标
 * @returns 是否可跳转
 */
export const canNavigateToResource = (target: ResourceNavigationTarget): boolean =>
  resolveResourceId(target) !== null;

/**
 * 跳转到资源详情页
 * @param target - 资源跳转目标
 * @returns 是否发起跳转
 */
export const navigateToResource = (target: ResourceNavigationTarget): boolean => {
  const id = resolveResourceId(target);
  if (!id) return false;
  if (target.type === "page") {
    router.push({ name: id });
    return true;
  }
  const source = target.source ?? "local";
  const name = target.name?.trim();
  const query = name && name !== id ? { name } : undefined;
  if (target.type === "artist") {
    router.push({
      name: "artist",
      params: { source, id: encodeURIComponent(id) },
      query,
    });
  } else {
    router.push({
      name: "collection",
      params: { source, type: target.type, id: encodeURIComponent(id) },
      query,
    });
  }
  return true;
};

/**
 * 跳转到专辑页
 * @param albumName - 专辑名称
 * @param options.source - 来源
 * @param options.albumId - 真实专辑 ID
 * @returns 是否发起跳转
 */
export const navigateToAlbum = (
  albumName?: string,
  options: { source?: TrackSource; albumId?: string } = {},
): boolean =>
  navigateToResource({
    type: "album",
    source: options.source,
    id: options.albumId,
    name: albumName,
  });

/**
 * 跳转到歌手页
 * @param artistName - 歌手名称
 * @param options.source - 来源
 * @param options.artistId - 真实歌手 ID
 * @returns 是否发起跳转
 */
export const navigateToArtist = (
  artistName?: string,
  options: { source?: TrackSource; artistId?: string } = {},
): boolean =>
  navigateToResource({
    type: "artist",
    source: options.source,
    id: options.artistId,
    name: artistName,
  });

/**
 * 跳转到歌单页
 * @param playlistId - 歌单 ID
 * @param options.source - 来源
 * @param options.name - 标题兜底
 * @returns 是否发起跳转
 */
export const navigateToPlaylist = (
  playlistId: string | undefined,
  options: { source?: TrackSource; name?: string } = {},
): boolean =>
  navigateToResource({
    type: "playlist",
    source: options.source,
    id: playlistId,
    name: options.name,
  });
