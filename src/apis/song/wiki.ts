import type { NeteaseSong } from "@shared/types/platform/netease";
import type { MusicListenData, SheetPreviewPage, WikiData, WikiSong } from "@/types/songWiki";
import { netease as neteaseApi } from "@/apis/netease";
import { songToTrack } from "@/utils/format/netease";

/** 歌曲详情不存在时抛出，由调用方映射本地化文案 */
export class WikiNotFoundError extends Error {
  constructor() {
    super("wiki song not found");
    this.name = "WikiNotFoundError";
  }
}

/**
 * 拉取歌曲详情与发行时间
 * @param id - 平台 songId
 * @returns 头部所需的歌曲信息
 */
export const fetchWikiSong = async (id: string): Promise<WikiSong> => {
  const body = await neteaseApi.song_detail<{ songs?: NeteaseSong[] }>({ ids: id });
  const song = body?.songs?.[0];
  if (!song) throw new WikiNotFoundError();
  return {
    track: songToTrack(song),
    publishTime: song.publishTime ?? song.al?.publishTime,
  };
};

/**
 * 拉取百科主数据（构造式 construct/info）
 * @param id - 平台 songId
 * @returns construct/info 的 data
 */
export const fetchWikiData = async (id: string): Promise<WikiData | null> => {
  const body = await neteaseApi.song_wiki_info<{ data?: WikiData }>({ id });
  return body?.data ?? null;
};

/**
 * 拉取个人聆听故事，匿名时可能为空对象或 301
 * @param id - 平台 songId
 * @returns 故事 DTO；无数据时返回 null
 */
export const fetchMusicListenData = async (id: string): Promise<MusicListenData | null> => {
  const body = await neteaseApi.music_first_listen_info<{ data?: MusicListenData | "" }>({
    songId: id,
  });
  const data = body?.data;
  return data && typeof data === "object" ? data : null;
};

/**
 * 拉取乐谱预览图 URL（登录态下返回页图，匿名可能为空数组）
 * @param sheetId - 乐谱 ID
 * @returns 预览图地址列表
 */
export const fetchSheetPreview = async (sheetId: string): Promise<string[]> => {
  const body = await neteaseApi.sheet_preview<{ data?: SheetPreviewPage[] }>({ id: sheetId });
  const pages = body?.data;
  if (!Array.isArray(pages)) return [];
  return pages.map((page) => page.url).filter((url): url is string => !!url);
};
