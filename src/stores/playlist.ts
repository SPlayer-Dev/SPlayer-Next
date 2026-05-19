import localforage from "localforage";
import type { Track } from "@shared/types/player";
import type { Collection, PlaylistRecord } from "@/types/collection";

const db = localforage.createInstance({ name: "splayer", storeName: "playlists" });

const generateId = () => `pl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const usePlaylistStore = defineStore("playlist", () => {
  const playlists = shallowRef<Omit<PlaylistRecord, "trackIds">[]>([]);
  const initialized = ref(false);

  /** 加载所有歌单元数据 */
  const load = async (): Promise<void> => {
    const items: Omit<PlaylistRecord, "trackIds">[] = [];
    await db.iterate<PlaylistRecord, void>((record) => {
      const { trackIds: _, ...meta } = record;
      items.push(meta);
    });
    items.sort((a, b) => (b.updateTime ?? 0) - (a.updateTime ?? 0));
    playlists.value = items;
    initialized.value = true;
  };

  /**
   * 解析歌单完整数据
   * @param record 歌单记录
   * @returns 歌单完整数据
   */
  const resolveCollection = async (record: PlaylistRecord): Promise<Collection> => {
    const { trackIds: _, ...meta } = record;
    if (record.trackIds.length === 0) {
      return { ...meta, tracks: [], trackCount: 0 };
    }
    const res = await window.api.library.getTracksByIds(record.trackIds);
    const fetched = res.success && res.data ? res.data : [];
    const byId = new Map<string, Track>(fetched.map((t) => [t.id, t]));
    const tracks: Track[] = [];
    for (const trackId of record.trackIds) {
      const track = byId.get(trackId);
      if (track) tracks.push(track);
    }
    return {
      ...meta,
      tracks,
      trackCount: tracks.length,
    };
  };

  /** 获取单个歌单完整数据 */
  const get = async (id: string): Promise<Collection | null> => {
    const record = await db.getItem<PlaylistRecord>(id);
    if (!record) return null;
    return await resolveCollection(record);
  };

  /** 创建歌单 */
  const create = async (title: string, description?: string): Promise<Collection> => {
    const now = Date.now();
    const record: PlaylistRecord = {
      id: generateId(),
      type: "playlist",
      source: "local",
      title,
      description,
      trackIds: [],
      trackCount: 0,
      createTime: now,
      updateTime: now,
    };
    await db.setItem(record.id, record);
    const { trackIds: _, ...meta } = record;
    playlists.value = [meta, ...playlists.value];
    return { ...meta, tracks: [], trackCount: 0 };
  };

  /** 更新歌单信息 */
  const update = async (
    id: string,
    data: Partial<Pick<PlaylistRecord, "title" | "description">>,
  ): Promise<void> => {
    const record = await db.getItem<PlaylistRecord>(id);
    if (!record) return;
    Object.assign(record, data, { updateTime: Date.now() });
    await db.setItem(id, record);
    const idx = playlists.value.findIndex((p) => p.id === id);
    if (idx !== -1) {
      const next = [...playlists.value];
      next[idx] = { ...next[idx], ...data, updateTime: record.updateTime };
      playlists.value = next;
    }
  };

  /** 删除歌单 */
  const remove = async (id: string): Promise<void> => {
    await db.removeItem(id);
    playlists.value = playlists.value.filter((p) => p.id !== id);
  };

  /** 添加歌曲到歌单 */
  const addTracks = async (id: string, tracks: Track[]): Promise<number> => {
    const record = await db.getItem<PlaylistRecord>(id);
    if (!record) return 0;
    const existIds = new Set(record.trackIds);
    const newIds = tracks.map((t) => t.id).filter((tid) => !existIds.has(tid));
    if (newIds.length === 0) return 0;
    record.trackIds.unshift(...newIds);
    record.trackCount = record.trackIds.length;
    record.updateTime = Date.now();
    // 更新封面
    const candidateCover = tracks.find((track) => track.cover)?.cover;
    if (candidateCover) record.cover = candidateCover;
    await db.setItem(id, record);
    const idx = playlists.value.findIndex((p) => p.id === id);
    if (idx !== -1) {
      const next = [...playlists.value];
      next[idx] = {
        ...next[idx],
        trackCount: record.trackCount,
        cover: record.cover,
        updateTime: record.updateTime,
      };
      playlists.value = next;
    }
    return newIds.length;
  };

  /** 从歌单移除歌曲 */
  const removeTracks = async (id: string, trackIds: string[]): Promise<void> => {
    const record = await db.getItem<PlaylistRecord>(id);
    if (!record) return;
    const removeSet = new Set(trackIds);
    record.trackIds = record.trackIds.filter((tid) => !removeSet.has(tid));
    record.trackCount = record.trackIds.length;
    record.updateTime = Date.now();
    // 删空时清空封面；其余情况保留旧值（下次 addTracks 才刷新）
    if (record.trackIds.length === 0) record.cover = undefined;
    await db.setItem(id, record);
    const idx = playlists.value.findIndex((p) => p.id === id);
    if (idx !== -1) {
      const next = [...playlists.value];
      next[idx] = {
        ...next[idx],
        trackCount: record.trackCount,
        cover: record.cover,
        updateTime: record.updateTime,
      };
      playlists.value = next;
    }
  };

  return { playlists, initialized, load, get, create, update, remove, addTracks, removeTracks };
});
