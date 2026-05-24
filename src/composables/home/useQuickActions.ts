import { useUserStore } from "@/stores/user";
import { useHeartMode } from "@/composables/useHeartMode";
import { useFmMode } from "@/composables/useFmMode";
import { toast } from "@/composables/useToast";
import * as player from "@/core/player";
import IconDices from "~icons/lucide/dices";
import IconCalendarDays from "~icons/lucide/calendar-days";
import IconHeart from "~icons/sp/heart-mode";
import IconRadio from "~icons/lucide/radio";

/**
 * 首页快捷入口
 */
export const useQuickActions = () => {
  const { t } = useI18n();
  const router = useRouter();
  const user = useUserStore();
  const { enterHeartMode } = useHeartMode();
  const { enterFmMode } = useFmMode();

  /** 试试手气 */
  const playLucky = useThrottleFn(async (): Promise<void> => {
    const online = user.likedPlaylistTracks;
    const countRes = await window.api.library.getTrackCount();
    const hasLocal = (countRes.success ? (countRes.data ?? 0) : 0) > 0;
    const hasOnline = online.length > 0;
    if (!hasLocal && !hasOnline) {
      toast.warning(t("home.quickActions.luck.empty"));
      return;
    }
    // 两侧都有则各 50% 随机一侧，只有一侧则直接用那侧
    const fromLocal = hasLocal && (!hasOnline || Math.random() < 0.5);
    if (fromLocal) {
      const trackRes = await window.api.library.getRandomTrack();
      const localTrack = trackRes.success ? trackRes.data : null;
      if (localTrack) await player.playNow(localTrack);
      return;
    }
    const onlineTrack = online[Math.floor(Math.random() * online.length)];
    if (onlineTrack) await player.playNow(onlineTrack);
  }, 800);

  /** 进入心动模式 */
  const playHeartMode = useThrottleFn(() => enterHeartMode(), 800);

  /** 进入私人 FM */
  const playFm = useThrottleFn(() => enterFmMode(), 800);

  /** 快捷入口列表 */
  const quickActions = computed(() => [
    {
      icon: IconDices,
      title: t("home.quickActions.luck.title"),
      desc: t("home.quickActions.luck.desc"),
      run: playLucky,
    },
    {
      icon: IconCalendarDays,
      title: t("home.quickActions.daily.title"),
      desc: t("home.quickActions.daily.desc"),
      run: () => router.push("/daily"),
    },
    {
      icon: IconHeart,
      title: t("home.quickActions.heartMode.title"),
      desc: t("home.quickActions.heartMode.desc"),
      run: playHeartMode,
    },
    {
      icon: IconRadio,
      title: t("home.quickActions.fm.title"),
      desc: t("home.quickActions.fm.desc"),
      run: playFm,
    },
  ]);

  return { quickActions };
};
