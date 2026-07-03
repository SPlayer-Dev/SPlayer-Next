/**
 * 插件元数据兜底编排
 * 内置平台拿不到歌词/封面时，由此向声明了 musicLyric/musicPic 的插件源兜底：
 * 先 musicSearch 出候选，复用 pickBestCandidate（时长硬门槛）匹配，再 musicLyric/musicPic 取数据
 */

import type { Track } from "@shared/types/player";
import type {
  MusicLyricRes,
  MusicPicRes,
  MusicSearchCandidate,
  PluginMatchCoverArgs,
  PluginMatchLyricArgs,
} from "@shared/types/plugin";
import { pluginRegistry, type PluginRuntime } from "./registry";
import { callMusicLyric, callMusicPic, callMusicSearch } from "./router";
import { pickBestCandidate, type LyricCandidate } from "@main/apis/common/lyric/utils";
import { pluginLog } from "@main/utils/logger";

/** 在线平台 source → 插件源 key；与 audioSource 的映射保持一致 */
const PLATFORM_TO_PLUGIN_SOURCE: Record<string, string> = {
  netease: "wy",
  qqmusic: "tx",
  kugou: "kg",
};

/**
 * 在某插件源里定位与 track 对应的曲目
 * 同源（track 平台映射后 == source）直接用 track.id 省一次搜索；否则 musicSearch + 时长门槛打分
 * @returns 匹配中的候选（含源内 id），无命中返回 null
 */
const findMatch = async (
  rt: PluginRuntime,
  source: string,
  track: Track,
): Promise<MusicSearchCandidate | null> => {
  if (PLATFORM_TO_PLUGIN_SOURCE[track.source] === source && track.id) {
    return {
      id: track.id,
      name: track.title,
      singer: track.artists.map((artist) => artist.name).join("/"),
      album: track.album?.name,
      durationMs: track.duration,
    };
  }
  const keyword = `${track.title} ${track.artists.map((artist) => artist.name).join(" ")}`.trim();
  if (!keyword) return null;
  const res = await callMusicSearch(rt, { source, keyword });
  const list = res?.list ?? [];
  if (list.length === 0) return null;
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
 * 经某插件源兜底取歌词
 * @param args - pluginId / source / track
 * @returns 命中的歌词；无匹配 / 无歌词 / 出错均返回 null（调用方据此尝试下一个源）
 */
export const matchLyric = async (args: PluginMatchLyricArgs): Promise<MusicLyricRes | null> => {
  const rt = pluginRegistry.getRuntime(args.pluginId);
  if (!rt || rt.status.state !== "ready") return null;
  try {
    const musicInfo = await findMatch(rt, args.source, args.track);
    if (!musicInfo) return null;
    const lyric = await callMusicLyric(rt, { source: args.source, musicInfo });
    return lyric?.lyric ? lyric : null;
  } catch (err) {
    pluginLog.warn("matchLyric failed", args.pluginId, args.source, (err as Error)?.message);
    return null;
  }
};

/**
 * 经某插件源兜底取封面
 * @param args - pluginId / source / track
 * @returns 命中的封面；无匹配 / 无封面 / 出错均返回 null（调用方据此尝试下一个源）
 */
export const matchCover = async (args: PluginMatchCoverArgs): Promise<MusicPicRes | null> => {
  const rt = pluginRegistry.getRuntime(args.pluginId);
  if (!rt || rt.status.state !== "ready") return null;
  try {
    const musicInfo = await findMatch(rt, args.source, args.track);
    if (!musicInfo) return null;
    const pic = await callMusicPic(rt, { source: args.source, musicInfo });
    return pic?.url ? pic : null;
  } catch (err) {
    pluginLog.warn("matchCover failed", args.pluginId, args.source, (err as Error)?.message);
    return null;
  }
};
