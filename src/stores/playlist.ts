import localforage from "localforage";
import type { Track } from "@shared/types/player";
import type { Collection } from "@/types/collection";

const db = localforage.createInstance({ name: "splayer", storeName: "playlists" });

const generateId = () => `pl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const usePlaylistStore = defineStore("playlist", () => {
  const playlists = shallowRef<Omit<Collection, "tracks">[]>([]);
  const initialized = ref(false);

  /** 加载所有歌单 */
  const load = async (): Promise<void> => {
    const items: Omit<Collection, "tracks">[] = [];
    await db.iterate<Collection, void>((record) => {
      const { tracks: _, ...meta } = record;
      items.push(meta);
    });
    items.sort((a, b) => (b.updateTime ?? 0) - (a.updateTime ?? 0));
    playlists.value = items;
    initialized.value = true;
  };

  /** 获取单个歌单完整数据 */
  const get = async (id: string): Promise<Collection | null> => {
    return db.getItem<Collection>(id);
  };

  /** 创建歌单 */
  const create = async (title: string, description?: string): Promise<Collection> => {
    const now = Date.now();
    const record: Collection = {
      id: generateId(),
      type: "playlist",
      source: "local",
      title,
      description,
      tracks: [],
      trackCount: 0,
      createTime: now,
      updateTime: now,
    };
    await db.setItem(record.id, record);
    const { tracks: _, ...meta } = record;
    playlists.value = [meta, ...playlists.value];
    return record;
  };

  /** 更新歌单信息 */
  const update = async (
    id: string,
    data: Partial<Pick<Collection, "title" | "description" | "cover">>,
  ): Promise<void> => {
    const record = await db.getItem<Collection>(id);
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
    const record = await db.getItem<Collection>(id);
    if (!record) return 0;
    const existIds = new Set(record.tracks.map((t) => t.id));
    const newTracks = tracks.filter((t) => !existIds.has(t.id));
    if (newTracks.length === 0) return 0;
    record.tracks.unshift(...newTracks);
    record.trackCount = record.tracks.length;
    record.updateTime = Date.now();
    // 用最后一首有封面的新歌作为歌单封面
    const lastCover = [...newTracks].reverse().find((t) => t.cover)?.cover;
    if (lastCover) record.cover = lastCover;
    await db.setItem(id, record);
    const idx = playlists.value.findIndex((p) => p.id === id);
    if (idx !== -1) {
      const next = [...playlists.value];
      next[idx] = {
        ...next[idx],
        cover: record.cover,
        trackCount: record.trackCount,
        updateTime: record.updateTime,
      };
      playlists.value = next;
    }
    return newTracks.length;
  };

  /** 从歌单移除歌曲 */
  const removeTracks = async (id: string, trackIds: string[]): Promise<void> => {
    const record = await db.getItem<Collection>(id);
    if (!record) return;
    const removeSet = new Set(trackIds);
    record.tracks = record.tracks.filter((t) => !removeSet.has(t.id));
    record.trackCount = record.tracks.length;
    record.updateTime = Date.now();
    await db.setItem(id, record);
    const idx = playlists.value.findIndex((p) => p.id === id);
    if (idx !== -1) {
      const next = [...playlists.value];
      next[idx] = { ...next[idx], trackCount: record.trackCount, updateTime: record.updateTime };
      playlists.value = next;
    }
  };

  return { playlists, initialized, load, get, create, update, remove, addTracks, removeTracks };
});
