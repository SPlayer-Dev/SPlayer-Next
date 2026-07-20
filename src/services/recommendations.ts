import type {
  RecommendationImportRequest,
  RecommendationImportResult,
  RecommendationImportSkipped,
} from "@shared/types/recommendation";
import type {
  ExternalPlaylist,
  ExternalPlaylistResult,
  ExternalPlaylistTask,
} from "@shared/types/externalPlaylist";
import type { Track } from "@shared/types/player";
import { ALL_PLATFORMS, type Platform } from "@shared/types/platform";
import { searchSongs } from "@/apis/search";
import { usePlaylistStore } from "@/stores/playlist";

const SEARCH_DELAY_MS = 500;

const getSearchKeyword = (title: string, artists: string[]): string =>
  [title, ...artists].filter(Boolean).join(" ");

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRateLimited = (error: unknown): boolean =>
  /\b(405|429)\b|操作频繁|rate.?limit/i.test(
    error instanceof Error ? error.message : String(error),
  );

const pickRandom = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

/** 将外部推荐按给定顺序解析为网易云曲目 */
export const resolveRecommendationTracks = async (
  request: RecommendationImportRequest,
): Promise<{ tracks: Track[]; skipped: RecommendationImportSkipped[] }> => {
  const tracks: Track[] = [];
  const skipped: RecommendationImportSkipped[] = [];
  const availablePlatforms = new Set<Platform>(ALL_PLATFORMS);
  let platform = pickRandom(ALL_PLATFORMS);
  for (const [index, item] of request.items.entries()) {
    const keyword = getSearchKeyword(item.title, item.artists);
    let track: Track | undefined;
    let lastError: unknown;
    while (!track) {
      try {
        const result = await searchSongs(platform, keyword, 0, 1);
        track = result.items[0];
      } catch (error) {
        lastError = error;
        if (!isRateLimited(error)) break;
        availablePlatforms.delete(platform);
        const fallback = [...availablePlatforms];
        if (fallback.length === 0) break;
        const previous = platform;
        platform = pickRandom(fallback);
        console.warn("[recommendations] 搜索来源限流，已切换后续请求来源", {
          sourceId: item.sourceId,
          title: item.title,
          artists: item.artists,
          keyword,
          previous,
          next: platform,
        });
        continue;
      }
      break;
    }
    if (!track) {
      console.error("[recommendations] 当前搜索来源未能解析曲目", {
        sourceId: item.sourceId,
        title: item.title,
        artists: item.artists,
        album: item.album,
        durationMs: item.durationMs,
        keyword,
        error: lastError instanceof Error ? lastError.stack || lastError.message : undefined,
      });
      skipped.push({
        sourceId: item.sourceId,
        reason: "notFound",
        title: item.title,
        artists: item.artists,
        album: item.album,
        durationMs: item.durationMs,
        keyword,
        error: lastError instanceof Error ? lastError.stack || lastError.message : undefined,
      });
    } else {
      tracks.push(track);
    }
    if (index < request.items.length - 1) {
      await wait(SEARCH_DELAY_MS);
    }
  }
  return { tracks, skipped };
};

/** 导入 Bridge 提供的推荐曲目 */
export const importRecommendations = async (
  request: RecommendationImportRequest,
  actions: {
    append: (tracks: readonly Track[]) => number;
    replace: (tracks: readonly Track[]) => Promise<void>;
  },
): Promise<RecommendationImportResult> => {
  const { tracks, skipped } = await resolveRecommendationTracks(request);
  if (request.mode === "append") actions.append(tracks);
  if (request.mode === "replace" && tracks.length > 0) await actions.replace(tracks);

  let playlistId: string | undefined;
  if (request.mode === "playlist") {
    const title = request.name?.trim() || `YouTube Music · ${new Date().toLocaleDateString()}`;
    const playlist = await usePlaylistStore().saveSnapshot(title, tracks);
    playlistId = playlist.id;
  }

  return {
    requested: request.items.length,
    imported: tracks.length,
    skipped,
    playlistId,
  };
};

const toExternalPlaylist = (playlist: {
  id: string;
  title: string;
  description?: string;
  trackCount?: number;
  cover?: string;
  createTime?: number;
  updateTime?: number;
}): ExternalPlaylist => ({
  id: playlist.id,
  title: playlist.title,
  description: playlist.description,
  trackCount: playlist.trackCount ?? 0,
  cover: playlist.cover,
  createTime: playlist.createTime,
  updateTime: playlist.updateTime,
});

/** 执行外部 API 发起的歌单操作 */
export const handleExternalPlaylistTask = async (
  task: ExternalPlaylistTask,
): Promise<ExternalPlaylistResult> => {
  const store = usePlaylistStore();
  if (!store.initialized) await store.load();
  if (task.operation === "list") {
    return { playlists: store.playlists.map(toExternalPlaylist) };
  }
  const existing = task.operation === "create" ? null : await store.get(task.playlistId);
  if (task.operation === "get") {
    return {
      found: existing !== null,
      playlist: existing ? toExternalPlaylist(existing) : undefined,
    };
  }
  if (task.operation === "create") {
    const playlist = await store.create(task.title, task.description, task.cover);
    return { playlist: toExternalPlaylist(playlist) };
  }
  if (!existing) return { found: false };
  if (task.operation === "update") {
    await store.update(task.playlistId, {
      ...(task.title === undefined ? {} : { title: task.title }),
      ...(task.description === undefined
        ? {}
        : { description: task.description === null ? undefined : task.description }),
      ...(task.cover === undefined ? {} : { cover: task.cover === null ? undefined : task.cover }),
    });
    const playlist = await store.get(task.playlistId);
    return { found: true, playlist: playlist ? toExternalPlaylist(playlist) : undefined };
  }
  if (task.operation === "remove") {
    await store.remove(task.playlistId);
    return { found: true };
  }
  const { tracks, skipped } = await resolveRecommendationTracks({
    provider: "youtube-music",
    mode: "playlist",
    items: task.items,
  });
  const playlist = await store.replaceTracks(task.playlistId, tracks);
  return {
    found: playlist !== null,
    playlist: playlist ? toExternalPlaylist(playlist) : undefined,
    requested: task.items.length,
    imported: tracks.length,
    skipped,
  };
};
