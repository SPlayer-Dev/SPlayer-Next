import type {
  RecommendationImportRequest,
  RecommendationImportResult,
  RecommendationImportSkipped,
} from "@shared/types/recommendation";
import type { Track } from "@shared/types/player";
import { searchSongs } from "@/apis/search";
import { usePlaylistStore } from "@/stores/playlist";

const SEARCH_CONCURRENCY = 3;

const getSearchKeyword = (title: string, artists: string[]): string =>
  [title, ...artists].filter(Boolean).join(" ");

/** 将外部推荐按给定顺序解析为网易云曲目 */
const resolveTracks = async (
  request: RecommendationImportRequest,
): Promise<{ tracks: Track[]; skipped: RecommendationImportSkipped[] }> => {
  const tracks = new Array<Track | null>(request.items.length).fill(null);
  const skipped: RecommendationImportSkipped[] = [];
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < request.items.length) {
      const index = nextIndex++;
      const item = request.items[index];
      try {
        const result = await searchSongs("netease", getSearchKeyword(item.title, item.artists), 0, 1);
        const track = result.items[0];
        if (track) tracks[index] = track;
        else skipped.push({ sourceId: item.sourceId, reason: "notFound" });
      } catch {
        skipped.push({ sourceId: item.sourceId, reason: "notFound" });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(SEARCH_CONCURRENCY, request.items.length) }, worker));
  return { tracks: tracks.filter((track): track is Track => track !== null), skipped };
};

/** 导入 Bridge 提供的推荐曲目 */
export const importRecommendations = async (
  request: RecommendationImportRequest,
  actions: {
    append: (tracks: readonly Track[]) => number;
    replace: (tracks: readonly Track[]) => Promise<void>;
  },
): Promise<RecommendationImportResult> => {
  const { tracks, skipped } = await resolveTracks(request);
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
