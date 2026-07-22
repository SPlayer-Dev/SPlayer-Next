<script setup lang="ts">
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import * as player from "@/core/player";
import IconLucideSliders from "~icons/lucide/sliders-horizontal";
import IconLucideGauge from "~icons/lucide/gauge";
import IconLucideMoreVertical from "~icons/lucide/more-vertical";
import IconLucideClock from "~icons/lucide/clock";
import IconLucideRepeat2 from "~icons/lucide/repeat-2";

const props = withDefaults(
  defineProps<{
    /** 是否使用封面主题 */
    cover?: boolean;
  }>(),
  { cover: false },
);

const { t } = useI18n();
const status = useStatusStore();
const settings = useSettingsStore();
const { isDesktopLyricOpen } = storeToRefs(settings);

const buttonType = computed<"default" | "cover">(() => (props.cover ? "cover" : "default"));
const mutedClass = computed(() => (props.cover ? "text-cover/50" : "text-on-surface-variant"));

const lyricButtonType = computed(() =>
  isDesktopLyricOpen.value ? (props.cover ? "cover" : "primary") : buttonType.value,
);

const volumePercent = computed(() => Math.round(status.volume * 100));

/** 静音前的音量，用于解除静音时恢复 */
const lastVolume = ref(status.volume || 0.7);

const onVolumeWheel = (e: WheelEvent): void => {
  const delta = e.deltaY < 0 ? 0.05 : -0.05;
  const next = Math.max(0, Math.min(1, status.volume + delta));
  player.setVolume(next);
};

const toggleMute = (): void => {
  if (status.volume > 0) {
    lastVolume.value = status.volume;
    player.setVolume(0);
  } else {
    player.setVolume(lastVolume.value || 0.7);
  }
};

const toggleDesktopLyric = (): void => {
  window.api.window.toggleDesktopLyric().catch(() => {});
};

const equalizerOpen = ref(false);
const speedOpen = ref(false);
const autoCloseOpen = ref(false);
const abLoopOpen = ref(false);

const moreMenuItems = computed<DropdownMenuItem[]>(() => [
  { key: "equalizer", label: t("equalizer.title"), icon: IconLucideSliders },
  { key: "speed", label: t("speed.title"), icon: IconLucideGauge },
  { key: "abLoop", label: t("abLoop.title"), icon: IconLucideRepeat2 },
  { key: "autoClose", label: t("autoClose.title"), icon: IconLucideClock },
]);

const onMoreMenuSelect = (key: string): void => {
  if (key === "equalizer") equalizerOpen.value = true;
  else if (key === "speed") speedOpen.value = true;
  else if (key === "abLoop") abLoopOpen.value = true;
  else if (key === "autoClose") autoCloseOpen.value = true;
};
</script>

<template>
  <div class="flex items-center gap-1">
    <!-- 在线音质 -->
    <QualityControl v-if="settings.appearance.showQualitySwitch" :cover="cover" />
    <SPopover trigger="hover" side="top" :cover="cover" content-class="px-3 pb-2 pt-3">
      <template #trigger>
        <SButton
          :type="buttonType"
          variant="ghost"
          circle
          size="large"
          :class="mutedClass"
          @click="toggleMute"
          @wheel.prevent="onVolumeWheel"
        >
          <template #icon>
            <IconLucideVolumeX v-if="volumePercent === 0" />
            <IconLucideVolume1 v-else-if="volumePercent < 50" />
            <IconLucideVolume2 v-else />
          </template>
        </SButton>
      </template>
      <div class="flex flex-col items-center w-7" @wheel.prevent="onVolumeWheel">
        <div class="h-30">
          <SSlider
            :model-value="status.volume"
            :min="0"
            :max="1"
            :step="0.01"
            :thumb-size="15"
            :track-height="5"
            :cover="cover"
            vertical
            @change="player.setVolume($event)"
          />
        </div>
        <span class="text-xs tabular-nums mt-2">{{ volumePercent }}%</span>
      </div>
    </SPopover>
    <SButton
      :type="lyricButtonType"
      :variant="isDesktopLyricOpen ? 'tertiary' : 'ghost'"
      circle
      size="large"
      :class="isDesktopLyricOpen ? undefined : mutedClass"
      @click="toggleDesktopLyric"
    >
      <template #icon><IconLucideCaptions /></template>
    </SButton>
    <SButton
      v-if="!status.fmMode && cover"
      :type="buttonType"
      :variant="status.fullQueueOpen ? 'tertiary' : 'ghost'"
      circle
      size="large"
      :class="status.fullQueueOpen ? undefined : mutedClass"
      @click="status.fullQueueOpen = !status.fullQueueOpen"
    >
      <template #icon><IconLucideListMusic /></template>
    </SButton>
    <SPopover
      v-else-if="!status.fmMode"
      v-model:open="status.outerQueueOpen"
      trigger="click"
      side="top"
      :side-offset="12"
      content-class="!p-0 w-72 h-[min(60vh,520px)] overflow-hidden"
    >
      <template #trigger>
        <SButton
          :type="status.outerQueueOpen ? 'primary' : buttonType"
          :variant="status.outerQueueOpen ? 'tertiary' : 'ghost'"
          circle
          size="large"
          :class="status.outerQueueOpen ? undefined : mutedClass"
        >
          <template #icon><IconLucideListMusic /></template>
        </SButton>
      </template>
      <QueuePopover @close="status.outerQueueOpen = false" />
    </SPopover>
    <SDropdownMenu
      :items="moreMenuItems"
      side="top"
      align="end"
      :cover="cover"
      @select="onMoreMenuSelect"
    >
      <template #trigger>
        <SButton :type="buttonType" variant="ghost" circle size="large" :class="mutedClass">
          <template #icon><IconLucideMoreVertical /></template>
        </SButton>
      </template>
    </SDropdownMenu>
    <EqualizerDialog v-model:open="equalizerOpen" />
    <SpeedDialog v-model:open="speedOpen" />
    <AbLoopDialog v-model:open="abLoopOpen" />
    <AutoCloseDialog v-model:open="autoCloseOpen" />
  </div>
</template>
