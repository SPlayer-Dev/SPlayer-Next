import type { PersonalFmOptions } from "@/types/netease";
import { useUserStore } from "@/stores/user";
import { useStatusStore } from "@/stores/status";
import { toast } from "@/composables/useToast";
import * as player from "@/core/player";

/**
 * 私人 FM
 *
 * 调用网易云 /personal_fm / /personal/fm/mode 拉一批推荐，进入 FM 模式播放
 */
export const useFmMode = () => {
  const { t } = useI18n();
  const user = useUserStore();
  const status = useStatusStore();

  /**
   * 进入私人 FM
   * @param options - 可选的 FM 模式与场景选项
   */
  const enterFmMode = async (options?: PersonalFmOptions): Promise<void> => {
    if (status.fmMode && !options) {
      toast.info(t("player.fm.already"));
      return;
    }
    if (!user.isLoggedIn) {
      toast.warning(t("player.fm.needLogin"));
      return;
    }
    const loading = toast.loading(t("player.fm.loading"), { duration: 0 });
    try {
      const ok = await player.playPersonalFm(options);
      if (ok) toast.success(t("player.fm.entered"));
      else toast.warning(t("player.fm.failed"));
    } catch (error) {
      console.error("[fm] 进入失败:", error);
      toast.warning(t("player.fm.failed"));
    } finally {
      loading.close();
    }
  };

  return { enterFmMode };
};
