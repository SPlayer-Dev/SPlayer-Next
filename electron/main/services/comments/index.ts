import { callNetease } from "@main/apis/netease";
import { callQQMusic } from "@main/apis/qqmusic";
import { callKugou } from "@main/apis/kugou";
import type { KGSong } from "@shared/types/platform/kugou";
import { pickBestCandidate, type LyricCandidate } from "@main/apis/common/lyric/utils";
import { pluginRegistry, type PluginRuntime } from "@main/plugins/registry";
import { callMusicComment, callMusicSearch } from "@main/plugins/router";
import { pluginLog } from "@main/utils/logger";
import type { CommentSource, MusicCommentPage, MusicCommentQuery } from "@shared/types/comment";
import type { MusicSearchCandidate } from "@shared/types/plugin";
import type { Track } from "@shared/types/player";
import { BoundedMap, coalesce } from "./cache";
import {
  buildCommentSources,
  normalizeNeteaseCommentPage,
  normalizeKugouCommentPage,
  normalizeQQMusicCommentPage,
  type KugouCommentBody,
  type QQMusicCommentBody,
} from "./data";

const NETEASE_SOURCE_ID = "builtin:netease";
const QQMUSIC_SOURCE_ID = "builtin:qqmusic";
const KUGOU_SOURCE_ID = "builtin:kugou";
const NETEASE_RESOURCE_TYPE = "R_SO_4_";

const SONG_META_CACHE_LIMIT = 200;

/** 网易云歌曲元信息 */
export type NeteaseSongMeta = { songId: string; artistIds: string[] };

/** 曲目 key → 网易云歌曲元信息（null 表示负缓存），分页与主创说复用同一次搜索 */
const songMetaCache = new BoundedMap<string, NeteaseSongMeta | null>(SONG_META_CACHE_LIMIT);
/** 元信息解析在途请求 */
const songMetaInflight = new Map<string, Promise<NeteaseSongMeta | null>>();
/** QQ / 酷狗 id 解析在途请求，避免两个 tab 同时搜索同一曲目 */
const trackIdInflight = new Map<string, Promise<string | null>>();

const makeTrackKey = (track: Track): string =>
  `${track.source}\n${track.serverId ?? ""}\n${track.id}`;

const PLATFORM_TO_PLUGIN_SOURCE: Record<string, string> = {
  netease: "wy",
  qqmusic: "tx",
  kugou: "kg",
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

interface ParsedPluginSource {
  pluginId: string;
  source: string;
}

const parsePluginSource = (sourceId: string): ParsedPluginSource | null => {
  if (!sourceId.startsWith("plugin:")) return null;
  const rest = sourceId.slice("plugin:".length);
  const sep = rest.indexOf(":");
  if (sep <= 0) return null;
  return {
    pluginId: rest.slice(0, sep),
    source: rest.slice(sep + 1),
  };
};

const toKeyword = (track: Track): string =>
  `${track.title} ${track.artists.map((artist) => artist.name).join(" ")}`.trim();

const toPluginCandidate = (track: Track): MusicSearchCandidate => ({
  id: track.id,
  name: track.title,
  singer: track.artists.map((artist) => artist.name).join("/"),
  album: track.album?.name,
  durationMs: track.duration,
});

const findPluginMatch = async (
  rt: PluginRuntime,
  source: string,
  track: Track,
): Promise<MusicSearchCandidate | null> => {
  if (PLATFORM_TO_PLUGIN_SOURCE[track.source] === source && track.id)
    return toPluginCandidate(track);
  const keyword = toKeyword(track);
  if (!keyword) return null;
  const res = await callMusicSearch(rt, { source, keyword, limit: 20 });
  const list = res?.list ?? [];
  const candidates: LyricCandidate<MusicSearchCandidate>[] = list.map((item) => ({
    name: item.name,
    artist: item.singer ?? "",
    album: item.album,
    duration: item.durationMs,
    extra: item,
  }));
  return pickBestCandidate(candidates, track)?.extra ?? null;
};

/**
 * 解析曲目对应的网易云歌曲元信息
 * 曲目本身来自网易云时直接取自身信息，其余来源走一次搜索同时取歌曲 id 与歌手 id
 * @param track - 待解析曲目
 * @returns 歌曲元信息，无匹配结果时返回 null
 */
export const findNeteaseSongMeta = async (track: Track): Promise<NeteaseSongMeta | null> => {
  const cacheKey = makeTrackKey(track);
  const cached = songMetaCache.get(cacheKey);
  if (cached !== undefined) return cached;
  if (track.source === "netease" && track.id) {
    const meta: NeteaseSongMeta = {
      songId: track.id,
      artistIds: track.artists
        .map((artist) => artist.id)
        .filter((id): id is string => Boolean(id) && id !== "undefined"),
    };
    songMetaCache.set(cacheKey, meta);
    return meta;
  }
  return coalesce(songMetaInflight, cacheKey, async () => {
    const keyword = toKeyword(track);
    if (!keyword) return null;
    const { status, body } = await callNetease("search", {
      keywords: keyword,
      type: 1,
      limit: 20,
    });
    if (status !== 200) return null;
    const songs = body.result?.songs ?? [];
    const candidates: LyricCandidate<NeteaseSongMeta>[] = songs.map(
      (song: {
        id: string | number;
        name?: string;
        artists?: { id?: string | number; name: string }[];
        album?: { name?: string };
        duration?: number;
      }) => ({
        name: song.name ?? "",
        artist: (song.artists ?? []).map((artist) => artist.name).join(" / "),
        album: song.album?.name,
        duration: song.duration,
        extra: {
          songId: String(song.id),
          artistIds: (song.artists ?? [])
            .map((artist) => (artist.id ? String(artist.id) : ""))
            .filter(Boolean),
        },
      }),
    );
    const meta = pickBestCandidate(candidates, track)?.extra ?? null;
    songMetaCache.set(cacheKey, meta);
    return meta;
  });
};

const getNeteaseComments = async (args: MusicCommentQuery): Promise<MusicCommentPage> => {
  const meta = await findNeteaseSongMeta(args.track);
  if (!meta) return { list: [], total: 0, page: args.page, limit: args.limit, hasMore: false };
  const apiName = args.type === "hot" ? "comment_hot" : "comment_music";
  const { status, body } = await callNetease(apiName, {
    id: meta.songId,
    type: NETEASE_RESOURCE_TYPE,
    limit: args.limit,
    offset: (args.page - 1) * args.limit,
  });
  if (status !== 200) throw new Error(`netease comment request failed: ${status}`);
  return normalizeNeteaseCommentPage(body, args.type, args.page, args.limit);
};

const findQQMusicId = async (track: Track): Promise<string | null> => {
  if (track.source === "qqmusic") {
    return track.extId || (/^\d+$/.test(track.id) ? track.id : null);
  }
  const keyword = toKeyword(track);
  if (!keyword) return null;
  return coalesce(trackIdInflight, `qqmusic\n${makeTrackKey(track)}`, async () => {
    const body = await callQQMusic("search", { keywords: keyword, type: 0, page: 1, limit: 20 });
    const candidates: LyricCandidate<{ id: string }>[] = (body.songs ?? []).map(
      (song: {
        id?: string;
        name?: string;
        artist?: string;
        album?: string;
        duration?: number;
      }) => ({
        name: song.name ?? "",
        artist: song.artist ?? "",
        album: song.album,
        duration: song.duration,
        extra: { id: song.id ?? "" },
      }),
    );
    return pickBestCandidate(candidates, track)?.extra.id || null;
  });
};

const getQQMusicComments = async (args: MusicCommentQuery): Promise<MusicCommentPage> => {
  const id = await findQQMusicId(args.track);
  if (!id) return { list: [], total: 0, page: args.page, limit: args.limit, hasMore: false };
  const body = await callQQMusic("comment", {
    id,
    type: args.type,
    page: args.page,
    limit: args.limit,
    cursor: args.cursor,
  });
  return normalizeQQMusicCommentPage(body as QQMusicCommentBody, args.page, args.limit);
};

const findKugouId = async (track: Track): Promise<string | null> => {
  if (track.source === "kugou" && track.extId) return track.extId;
  const keyword = toKeyword(track);
  if (!keyword) return null;
  return coalesce(trackIdInflight, `kugou\n${makeTrackKey(track)}`, async () => {
    const body = await callKugou<{ songs?: KGSong[] }>("search", {
      keywords: keyword,
      type: 0,
      page: 1,
      limit: 20,
    });
    const candidates: LyricCandidate<{ id: string }>[] = (body.songs ?? []).map((song) => ({
      name: song.name,
      artist: song.artist,
      album: song.album,
      duration: song.duration,
      extra: { id: song.albumAudioId ? String(song.albumAudioId) : "" },
    }));
    return pickBestCandidate(candidates, track)?.extra.id || null;
  });
};

const getKugouComments = async (args: MusicCommentQuery): Promise<MusicCommentPage> => {
  if (args.type !== "hot")
    return { list: [], total: 0, page: args.page, limit: args.limit, hasMore: false };
  const id = await findKugouId(args.track);
  if (!id) return { list: [], total: 0, page: args.page, limit: args.limit, hasMore: false };
  const body = await callKugou<KugouCommentBody>("comment", {
    id,
    page: args.page,
    limit: args.limit,
  });
  return normalizeKugouCommentPage(body, args.page, args.limit);
};

const getPluginComments = async (
  parsed: ParsedPluginSource,
  args: MusicCommentQuery,
): Promise<MusicCommentPage> => {
  const rt = pluginRegistry.getRuntime(parsed.pluginId);
  if (!rt || rt.status.state !== "ready") throw new Error("plugin comment source is not ready");
  try {
    const musicInfo = await findPluginMatch(rt, parsed.source, args.track);
    if (!musicInfo)
      return { list: [], total: 0, page: args.page, limit: args.limit, hasMore: false };
    return await callMusicComment(rt, {
      source: parsed.source,
      musicInfo,
      type: args.type,
      page: args.page,
      limit: args.limit,
    });
  } catch (err) {
    pluginLog.warn(
      "matchComment failed",
      parsed.pluginId,
      parsed.source,
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
};

const normalizeQuery = (args: MusicCommentQuery): MusicCommentQuery => ({
  ...args,
  page: Math.max(1, Math.floor(Number(args.page) || 1)),
  limit: Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(args.limit) || DEFAULT_LIMIT))),
});

/** 获取当前可用评论源 */
export const getCommentSources = (): CommentSource[] =>
  buildCommentSources(pluginRegistry.listInfo());

/** 获取歌曲评论 */
export const getMusicComments = async (args: MusicCommentQuery): Promise<MusicCommentPage> => {
  const query = normalizeQuery(args);
  if (query.sourceId === NETEASE_SOURCE_ID) return getNeteaseComments(query);
  if (query.sourceId === QQMUSIC_SOURCE_ID) return getQQMusicComments(query);
  if (query.sourceId === KUGOU_SOURCE_ID) return getKugouComments(query);
  const parsed = parsePluginSource(query.sourceId);
  if (parsed) return getPluginComments(parsed, query);
  throw new Error(`unknown comment source: ${query.sourceId}`);
};
