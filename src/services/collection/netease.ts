import type { Track } from "@shared/types/player";
import type { Collection, CollectionType } from "@/types/collection";
import { fetchAlbum } from "@/apis/album/netease";
import { fetchPlaylist } from "@/apis/playlist/netease";
import { fetchPodcastDetail, fetchPodcastPrograms } from "@/apis/podcast/netease";
import { withPicSize } from "@/utils/format/netease";
import type { LoadCollectionOptions } from "./types";

export const loadNeteaseCollection = async (
  type: CollectionType,
  id: string,
  options: LoadCollectionOptions,
): Promise<void> => {
  if (type === "album") {
    const result = await fetchAlbum(decodeURIComponent(id));
    if (options.signal?.aborted) return;
    options.onUpdate(
      result
        ? {
            id,
            type,
            source: "netease",
            title: result.album.name,
            cover: result.album.cover,
            description: result.description,
            creator: result.album.artist,
            tracks: result.tracks,
            trackCount: result.tracks.length,
          }
        : null,
    );
    return;
  }
  if (type === "radio") {
    const radioId = decodeURIComponent(id);
    const radio = await fetchPodcastDetail(radioId);
    if (options.signal?.aborted) return;
    if (!radio) {
      options.onUpdate(null);
      return;
    }
    const tracks: Track[] = [];
    let trackCount = radio.programCount ?? 0;
    const update = (): void => {
      options.onUpdate({
        id,
        type,
        source: "netease",
        title: radio.name,
        cover: withPicSize(radio.picUrl),
        description: radio.desc,
        creator: radio.dj?.nickname,
        tracks: [...tracks],
        trackCount: trackCount || tracks.length,
        createTime: radio.createTime,
        updateTime: radio.lastProgramCreateTime,
      });
    };
    update();
    let page = await fetchPodcastPrograms(radioId, 0);
    if (page.items.length === 0 && trackCount !== 0) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (options.signal?.aborted) return;
      page = await fetchPodcastPrograms(radioId, 0);
      if (page.items.length === 0) {
        throw new Error("podcast programs returned an unexpected empty page");
      }
    }
    if (options.signal?.aborted) return;
    tracks.push(...page.items);
    trackCount = page.total || trackCount;
    update();
    return;
  }
  if (type !== "playlist") {
    options.onUpdate(null);
    return;
  }

  const tracks: Track[] = [];
  let meta: {
    name: string;
    cover?: string;
    description?: string;
    creator?: string;
    count?: number;
  };
  const current = (): Collection | null =>
    meta
      ? {
          id,
          type,
          source: "netease",
          title: meta.name,
          cover: meta.cover,
          description: meta.description,
          creator: meta.creator,
          tracks: [...tracks],
          trackCount: meta.count ?? tracks.length,
        }
      : null;
  await fetchPlaylist(id, {
    signal: options.signal,
    onMeta: (value) => {
      meta = {
        name: value.name,
        cover: value.cover,
        description: value.description,
        creator: value.owner,
        count: value.trackCount,
      };
      if (!options.signal?.aborted) options.onUpdate(current());
    },
    onBatch: (batch) => {
      tracks.push(...batch);
      if (!options.signal?.aborted) options.onUpdate(current());
    },
  });
};
