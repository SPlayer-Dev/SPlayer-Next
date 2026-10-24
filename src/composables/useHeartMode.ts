import type { Track } from "@shared/types/player";
import { useUserStore } from "@/stores/user";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { fetchHeartModeList } from "@/apis/recommend/netease";
import { firstPlayableId } from "@/utils/format/netease";
import { toast } from "@/composables/useToast";
import * as player from "@/core/player";

/**
 * 心动模式
 *
 * 以当前歌曲为种子、「我喜欢的音乐」为上下文请求桌面端同款智能播放列表，
 * 种子歌曲置顶，失败时回退到「我喜欢的音乐」列表循环。
 */
export const useHeartMode = () => {
  const { t } = useI18n();
  const user = useUserStore();
  const media = useMediaStore();
  const status = useStatusStore();

  /** 进入心动模式失败时切回「我喜欢的音乐」列表循环 */
  const fallbackToListLoop = async (tracks: readonly Track[]): Promise<void> => {
    status.repeatMode = "list";
    if (tracks.length === 0) return;
    const currentId = media.track?.id;
    const index = currentId ? tracks.findIndex((track) => track.id === currentId) : -1;
    try {
      await player.playFrom(tracks, { startIndex: Math.max(0, index) });
    } catch (error) {
      console.error("[heartMode] 回退列表循环失败:", error);
    }
  };

  /**
   * 进入心动模式
   * @param seed - 指定种子歌曲；缺省时取当前播放的 NCM 歌曲，再退而取随机红心歌曲
   */
  const enterHeartMode = async (seed?: Track): Promise<void> => {
    if (status.heartMode) {
      toast.info(t("player.heartMode.already"));
      return;
    }
    if (!user.isLoggedIn) {
      toast.warning(t("player.heartMode.needLogin"));
      return;
    }
    const loading = toast.loading(t("player.heartMode.loading"), { duration: 0 });
    try {
      // 桌面端心动模式以完整「我喜欢的音乐」为上下文，先确保歌单已加载
      if (user.likedPlaylistTracks.length === 0) {
        try {
          await user.ensureLikedPlaylist();
        } catch (error) {
          console.warn("[heartMode] 加载喜欢歌单失败:", error);
        }
      }
      const likedTracks = user.likedPlaylistTracks;
      const playlistId = user.likedPlaylistId;
      const current = media.track;
      const likedIds = [...user.likedSongIds];
      const randomLikedId = likedIds[Math.floor(Math.random() * likedIds.length)];
      const seedTrack =
        seed ??
        (current?.source === "netease"
          ? current
          : likedTracks.find((track) => track.id === randomLikedId));
      const seedId = seedTrack?.id ?? randomLikedId;
      if (!playlistId || !seedId) {
        toast.warning(t("player.heartMode.noSeed"));
        return;
      }
      const desktopOptions = {
        type: "fromPlayAll" as const,
        count: likedTracks.length,
        startMusicId: firstPlayableId(likedTracks) ?? seedId,
        starPlaylist: likedTracks,
        uid: user.profile?.userId,
      };
      let tracks: Track[] = [];
      if (likedTracks.length > 0) {
        try {
          tracks = await fetchHeartModeList(seedId, playlistId, desktopOptions);
        } catch (error) {
          console.warn("[heartMode] 桌面端参数请求失败，回退基础参数:", error);
        }
      }
      // 桌面端参数不兼容或歌单尚未加载时，退回已验证的基础请求
      if (tracks.length === 0) {
        tracks = await fetchHeartModeList(seedId, playlistId);
      }
      if (tracks.length === 0) {
        toast.warning(t("player.heartMode.failedFallback"));
        await fallbackToListLoop(likedTracks);
        return;
      }
      await player.playHeartMode(tracks, seedTrack);
      toast.success(t("player.heartMode.entered"));
    } catch (error) {
      console.error("[heartMode] 进入失败:", error);
      toast.warning(t("player.heartMode.failedFallback"));
      await fallbackToListLoop(user.likedPlaylistTracks);
    } finally {
      loading.close();
    }
  };

  return { enterHeartMode };
};
