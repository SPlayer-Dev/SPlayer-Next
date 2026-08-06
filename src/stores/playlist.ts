import localforage from "localforage";
import type { Track } from "@shared/types/player";
import type { LegacyPlaylistRecord, PlaylistSummary } from "@shared/types/playlist";
import type { Collection } from "@/types/collection";

const legacyDb = localforage.createInstance({ name: "splayer", storeName: "playlists" });

export const usePlaylistStore = defineStore("playlist", () => {
  /** 本地歌单列表 */
  const playlists = shallowRef<PlaylistSummary[]>([]);
  const initialized = ref(false);

  /** 将旧版 IndexedDB 本地歌单一次性导入主进程 */
  const migrateLegacy = async (): Promise<void> => {
    const records: LegacyPlaylistRecord[] = [];
    await legacyDb.iterate<LegacyPlaylistRecord, void>((record) => {
      records.push({
        id: record.id,
        title: record.title,
        description: record.description,
        cover: record.cover,
        trackIds: record.trackIds,
        createTime: record.createTime,
        updateTime: record.updateTime,
      });
    });
    if (records.length === 0) return;
    await window.api.playlist.importLegacy(records);
    await legacyDb.clear();
  };

  /** 加载全部类型的歌单列表 */
  const load = async (): Promise<void> => {
    await migrateLegacy();
    playlists.value = await window.api.playlist.list();
    initialized.value = true;
  };

  /** 获取本地歌单完整数据 */
  const get = async (id: string): Promise<Collection | null> => {
    const detail = await window.api.playlist.get(id);
    if (!detail || detail.type !== "local") return null;
    return {
      id: detail.id,
      type: "playlist",
      source: "local",
      title: detail.title,
      description: detail.description,
      cover: detail.cover,
      tracks: detail.tracks,
      trackCount: detail.tracks.length,
      createTime: detail.createTime,
      updateTime: detail.updateTime,
    };
  };

  /** 创建本地歌单 */
  const create = async (title: string, description?: string): Promise<Collection> => {
    const created = await window.api.playlist.create({
      type: "local",
      title,
      description,
    });
    playlists.value = [created, ...playlists.value];
    return {
      id: created.id,
      type: "playlist",
      source: "local",
      title: created.title,
      description: created.description,
      cover: created.cover,
      tracks: [],
      trackCount: 0,
      createTime: created.createTime,
      updateTime: created.updateTime,
    };
  };

  /** 更新歌单信息 */
  const update = async (
    id: string,
    data: Partial<Pick<PlaylistSummary, "title" | "description">>,
  ): Promise<void> => {
    const updated = await window.api.playlist.update(id, data);
    if (!updated) return;
    playlists.value = playlists.value.map((playlist) => (playlist.id === id ? updated : playlist));
  };

  /** 删除歌单 */
  const remove = async (id: string): Promise<void> => {
    await window.api.playlist.remove(id);
    playlists.value = playlists.value.filter((playlist) => playlist.id !== id);
  };

  /** 添加歌曲到本地歌单 */
  const addTracks = async (id: string, tracks: Track[]): Promise<number> => {
    const count = await window.api.playlist.addTracks(
      id,
      tracks.map((track) => track.id),
    );
    if (count > 0) {
      const cover = tracks.find((track) => track.cover)?.cover;
      playlists.value = playlists.value.map((playlist) =>
        playlist.id === id
          ? {
              ...playlist,
              cover: cover ?? playlist.cover,
              trackCount: playlist.trackCount + count,
              updateTime: Date.now(),
            }
          : playlist,
      );
    }
    return count;
  };

  /** 从本地歌单移除歌曲 */
  const removeTracks = async (id: string, trackIds: string[]): Promise<void> => {
    const count = await window.api.playlist.removeTracks(id, trackIds);
    if (count === 0) return;
    playlists.value = playlists.value.map((playlist) => {
      if (playlist.id !== id) return playlist;
      const trackCount = Math.max(0, playlist.trackCount - count);
      return {
        ...playlist,
        cover: trackCount === 0 ? undefined : playlist.cover,
        trackCount,
        updateTime: Date.now(),
      };
    });
  };

  /** 清空全部歌单 */
  const clear = async (): Promise<void> => {
    await window.api.playlist.clear();
    await legacyDb.clear();
    playlists.value = [];
  };

  return {
    playlists,
    localPlaylists: playlists,
    initialized,
    load,
    get,
    create,
    update,
    remove,
    addTracks,
    removeTracks,
    clear,
  };
});
