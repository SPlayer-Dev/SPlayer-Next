import { useSettingsStore } from "@/stores/settings";
import { useMediaStore } from "@/stores/media";

/** 悬浮播放栏底部留白 */
const PLAYER_BAR_GAP = 112;

/**
 * 悬浮播放栏状态
 */
export const useFloatingPlayerBar = () => {
  const settings = useSettingsStore();
  const media = useMediaStore();

  /** 是否处于悬浮播放栏 */
  const isFloatingBar = computed(
    () => settings.appearance.layoutMode === "floating" && !!media.track,
  );

  return { isFloatingBar, PLAYER_BAR_GAP };
};
