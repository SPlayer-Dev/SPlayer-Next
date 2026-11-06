import type { Ref } from "vue";
import { useDataStore } from "@/stores/data";
import { getSearchSuggest, type SuggestData, type SuggestSimpleItem } from "@/apis/search/suggest";
import { songsByIds as getNeteaseSongsByIds } from "@/apis/song/netease";
import { navigateToAlbum, navigateToArtist, navigateToPlaylist } from "@/utils/navigate";
import type { LinkType } from "@/utils/link";
import type { Track, TrackSource } from "@shared/types/player";
import type { LibraryQuickSearchResult } from "@shared/types/library";
import * as player from "@/core/player";
import type { SearchCommandItem, SearchCommandSection } from "@/composables/useSearchCommands";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideUser from "~icons/lucide/user";
import IconLucideDisc from "~icons/lucide/disc";
import IconLucideListMusic from "~icons/lucide/list-music";
import IconLucideRepeat from "~icons/lucide/repeat";

type SuggestKind = "song" | "artist" | "album" | "playlist";

const EMPTY_SUGGEST: SuggestData = { songs: [], albums: [], artists: [], playlists: [] };
const EMPTY_LOCAL: LibraryQuickSearchResult = { tracks: [], albums: [], artists: [] };
/** 默认视图每组展示的曲目数 */
const PLAYED_TRACK_LIMIT = 5;
/** 播放次数达到此值才算「反复聆听」，与首页一致 */
const REPEAT_PLAY_COUNT = 2;

/**
 * 搜索窗结果：在线建议与本地曲库合并分组，以及默认视图的播放记录
 * @param keyword - 去除首尾空白后的输入
 * @param close - 关闭搜索窗
 * @returns 结果分组、播放记录分组及资源跳转
 */
export const useSearchResults = (keyword: Ref<string>, close: () => void) => {
  const { t } = useI18n();
  const data = useDataStore();

  const suggest = shallowRef<SuggestData>(EMPTY_SUGGEST);
  const localResult = shallowRef<LibraryQuickSearchResult>(EMPTY_LOCAL);
  const recentTracks = shallowRef<Track[]>([]);
  const repeatTracks = shallowRef<Track[]>([]);

  const loadSuggest = useDebounceFn(async (word: string) => {
    try {
      suggest.value = await getSearchSuggest(word);
    } catch (err) {
      console.warn("[NavSearch] suggest failed:", err);
    }
  }, 300);

  const loadLocal = useDebounceFn(async (word: string) => {
    try {
      const res = await window.api.library.quickSearch(word);
      // 输入已变化则丢弃过期结果
      if (word !== keyword.value) return;
      localResult.value = res.success && res.data ? res.data : EMPTY_LOCAL;
    } catch (err) {
      console.warn("[NavSearch] local search failed:", err);
    }
  }, 150);

  watch(keyword, (word) => {
    suggest.value = EMPTY_SUGGEST;
    localResult.value = EMPTY_LOCAL;
    if (!word || word.startsWith("/")) return;
    loadSuggest(word);
    loadLocal(word);
  });

  /** 拉取最近播放与反复聆听，反复聆听排除已在最近播放中的曲目 */
  const loadPlayedTracks = async (): Promise<void> => {
    try {
      // 多取一倍，给去重留余量
      const [recent, top] = await Promise.all([
        window.api.stats.getRecentTracks(PLAYED_TRACK_LIMIT),
        window.api.stats.getTopTracks(PLAYED_TRACK_LIMIT * 2),
      ]);
      const recentKeys = new Set(recent.map((track) => `${track.source}:${track.id}`));
      recentTracks.value = recent;
      repeatTracks.value = top
        .filter(
          (entry) =>
            entry.playCount >= REPEAT_PLAY_COUNT &&
            !recentKeys.has(`${entry.track.source}:${entry.track.id}`),
        )
        .slice(0, PLAYED_TRACK_LIMIT)
        .map((entry) => entry.track);
    } catch (err) {
      console.warn("[NavSearch] played tracks failed:", err);
    }
  };

  /**
   * 记录搜索历史并关闭搜索窗后执行
   * @param run - 要执行的动作
   */
  const pick = (run: () => void) => (): void => {
    if (keyword.value) data.addSearchHistory(keyword.value);
    close();
    run();
  };

  /**
   * 打开在线资源：歌曲直接播放，其余跳转详情页
   * @param kind - 资源类型
   * @param id - 资源 ID
   * @param source - 资源来源
   * @param name - 资源名称
   */
  const openResource = async (
    kind: SuggestKind | LinkType,
    id: string,
    source: TrackSource,
    name?: string,
  ): Promise<void> => {
    close();
    switch (kind) {
      case "song":
        try {
          const [track] = await getNeteaseSongsByIds([Number(id)]);
          if (track) await player.playNow(track);
        } catch (err) {
          console.warn("[NavSearch] play song failed:", err);
        }
        break;
      case "artist":
        navigateToArtist(name, { source, artistId: id });
        break;
      case "album":
        navigateToAlbum(name, { source, albumId: id });
        break;
      case "playlist":
        navigateToPlaylist(id, { source, name });
        break;
    }
  };

  /**
   * 曲目转为可播放的结果项
   * @param track - 曲目
   * @param idPrefix - 结果项 ID 前缀
   * @param local - 是否标记为本地结果
   * @returns 结果项
   */
  const toTrackItem = (track: Track, idPrefix: string, local: boolean): SearchCommandItem => ({
    id: `${idPrefix}-${track.id}`,
    label: track.title,
    subtitle:
      [track.artists.map((artist) => artist.name).join(" / "), track.album?.name]
        .filter(Boolean)
        .join(" · ") || undefined,
    local,
    action: pick(() =>
      player.playNow(track).catch((err) => console.warn("[NavSearch] play track failed:", err)),
    ),
  });

  /**
   * 在线建议转为结果项
   * @param kind - 建议类型
   * @param entry - 建议条目
   * @returns 结果项
   */
  const toOnlineItem = (kind: SuggestKind, entry: SuggestSimpleItem): SearchCommandItem => ({
    id: `${kind}-${entry.id}`,
    label: entry.name,
    subtitle: entry.subtitle,
    action: pick(() => openResource(kind, String(entry.id), "netease", entry.name)),
  });

  /** 搜索结果分组：同类下本地结果在前，在线建议在后 */
  const resultSections = computed<SearchCommandSection[]>(() => {
    const { tracks, albums, artists } = localResult.value;
    const online = suggest.value;
    return [
      {
        kind: "song",
        icon: IconLucideMusic,
        label: t("search.tabs.songs"),
        items: [
          ...tracks.map((track) => toTrackItem(track, "local-song", true)),
          ...online.songs.map((song) =>
            toOnlineItem("song", {
              id: song.id,
              name: song.name,
              subtitle: [song.artist, song.album].filter(Boolean).join(" · ") || undefined,
            }),
          ),
        ],
      },
      {
        kind: "artist",
        icon: IconLucideUser,
        label: t("search.tabs.artists"),
        items: [
          ...artists.map<SearchCommandItem>((artist) => ({
            id: `local-artist-${artist.name}`,
            label: artist.name,
            local: true,
            action: pick(() => navigateToArtist(artist.name)),
          })),
          ...online.artists.map((entry) => toOnlineItem("artist", entry)),
        ],
      },
      {
        kind: "album",
        icon: IconLucideDisc,
        label: t("search.tabs.albums"),
        items: [
          ...albums.map<SearchCommandItem>((album) => ({
            id: `local-album-${album.name}`,
            label: album.name,
            subtitle: album.artist || undefined,
            local: true,
            action: pick(() => navigateToAlbum(album.name)),
          })),
          ...online.albums.map((entry) => toOnlineItem("album", entry)),
        ],
      },
      {
        kind: "playlist",
        icon: IconLucideListMusic,
        label: t("search.tabs.playlists"),
        items: online.playlists.map((entry) => toOnlineItem("playlist", entry)),
      },
    ].filter((sec) => sec.items.length > 0);
  });

  /** 默认视图的继续聆听与反复聆听分组，无播放记录时为空 */
  const playedSections = computed<SearchCommandSection[]>(() =>
    [
      {
        kind: "recent",
        icon: IconLucideMusic,
        label: t("home.continue.continueTitle"),
        items: recentTracks.value.map((track) => toTrackItem(track, "recent", false)),
      },
      {
        kind: "repeat",
        icon: IconLucideRepeat,
        label: t("home.continue.repeatTitle"),
        items: repeatTracks.value.map((track) => toTrackItem(track, "repeat", false)),
      },
    ].filter((sec) => sec.items.length > 0),
  );

  return { resultSections, playedSections, loadPlayedTracks, openResource };
};
