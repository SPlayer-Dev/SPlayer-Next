import type { Ref } from "vue";
import { useSettingsStore } from "@/stores/settings";

/** 沉浸模式闲置时间（ms） */
const IMMERSIVE_IDLE_MS = 3000;

/**
 * 全屏播放器沉浸模式
 * 闲置指定时间后自动隐藏顶栏/底栏，鼠标移动时恢复
 * @param isExpanded - 播放器是否展开
 */
export const useImmersiveMode = (isExpanded: Ref<boolean>) => {
  const settings = useSettingsStore();

  const immersive = ref(false);
  const barHovered = ref(false);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const enabled = computed(() => settings.player.autoImmersive && isExpanded.value);

  const armIdle = (): void => {
    clearTimeout(idleTimer);
    immersive.value = false;
    if (!enabled.value) return;
    idleTimer = setTimeout(() => {
      if (!barHovered.value) immersive.value = true;
    }, IMMERSIVE_IDLE_MS);
  };

  const onPlayerMouseEnter = (): void => armIdle();

  const onPlayerMouseLeave = (): void => {
    clearTimeout(idleTimer);
    if (enabled.value) immersive.value = true;
  };

  const onMainMove = (): void => {
    if (!barHovered.value) armIdle();
  };

  const onBarEnter = (): void => {
    barHovered.value = true;
    clearTimeout(idleTimer);
    immersive.value = false;
  };

  const onBarLeave = (): void => {
    barHovered.value = false;
    armIdle();
  };

  watch(enabled, (on) => {
    if (!on) {
      clearTimeout(idleTimer);
      immersive.value = false;
      barHovered.value = false;
    }
  });

  onBeforeUnmount(() => clearTimeout(idleTimer));

  return {
    immersive,
    onPlayerMouseEnter,
    onPlayerMouseLeave,
    onMainMove,
    onBarEnter,
    onBarLeave,
  };
};
