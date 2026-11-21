import type { Ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { isMac } from "@/utils/config";

/** 沉浸模式闲置时间（ms） */
const IMMERSIVE_IDLE_MS = 3000;

/**
 * 全屏播放器沉浸模式
 * 闲置指定时间后自动隐藏顶栏/底栏，鼠标移动时恢复
 * @param isPlayerExpanded - 播放器是否展开
 * @returns 沉浸状态与播放器鼠标事件处理方法
 */
export const useImmersiveMode = (isPlayerExpanded: Ref<boolean>) => {
  const settings = useSettingsStore();

  const immersive = ref(false);
  const barHovered = ref(false);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const enabled = computed(() => settings.player.autoImmersive && isPlayerExpanded.value);

  const armIdle = (): void => {
    clearTimeout(idleTimer);
    immersive.value = false;
    if (!enabled.value) return;
    idleTimer = setTimeout(() => {
      if (!barHovered.value) immersive.value = true;
    }, IMMERSIVE_IDLE_MS);
  };

  /** 鼠标移出时立即进入沉浸模式 */
  const onPlayerMouseLeave = (): void => {
    clearTimeout(idleTimer);
    if (enabled.value) immersive.value = true;
  };

  /** 鼠标实际移动时唤醒控件，避免原生按钮显隐触发的进入事件反复唤醒 */
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

  if (isMac) {
    watch(
      () => !isPlayerExpanded.value || !immersive.value,
      (visible) => window.api.window.setTrafficLightsVisible(visible),
      { immediate: true },
    );
  }

  onBeforeUnmount(() => {
    clearTimeout(idleTimer);
    if (isMac) window.api.window.setTrafficLightsVisible(true);
  });

  return {
    immersive,
    onPlayerMouseLeave,
    onMainMove,
    onBarEnter,
    onBarLeave,
  };
};
