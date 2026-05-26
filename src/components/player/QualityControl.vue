<script setup lang="ts">
import type { SSelectOption } from "@/components/ui/SSelect.vue";
import type { QualityLevel } from "@/utils/quality";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { getQualityLabel } from "@/utils/quality";
import * as player from "@/core/player";

withDefaults(defineProps<{ cover?: boolean }>(), { cover: false });

const { t } = useI18n();
const media = useMediaStore();
const settings = useSettingsStore();

/** 是否支持切换在线音质 */
const canSwitchQuality = computed(() => media.track?.source === "netease" && !media.track?.cloud);

/** 实际播放音质 */
const qualityLabel = computed(() => getQualityLabel(media.detail?.quality));

/** 音质偏好下拉选项 */
const qualityOptions = computed<SSelectOption[]>(() => [
  { value: "lq", label: t("settings.songLevel.lq") },
  { value: "sq", label: t("settings.songLevel.sq") },
  { value: "hq", label: t("settings.songLevel.hq") },
  { value: "lossless", label: t("settings.songLevel.lossless") },
  { value: "hi-res", label: t("settings.songLevel.hi-res") },
]);

const chipBase =
  "inline-flex min-w-9 shrink-0 items-center justify-center px-2 py-1 leading-none rounded-md border border-solid text-xs";

/** 切换音质 */
const onQualityChange = (value: string | number | boolean): void => {
  settings.player.songLevel = value as QualityLevel;
  void player.reloadCurrentTrack();
};
</script>

<template>
  <SPopselect
    v-if="canSwitchQuality && media.detail?.quality"
    :model-value="settings.player.songLevel"
    :options="qualityOptions"
    side="top"
    :side-offset="8"
    :cover="cover"
    @update:model-value="onQualityChange"
  >
    <template #header>
      <div
        :class="[
          'w-0 min-w-full px-2.5 pt-2 pb-1.5 text-xs leading-snug border-b border-b-solid',
          cover
            ? 'text-cover/55 border-b-white/10'
            : 'text-on-surface-variant/70 border-b-on-surface/8',
        ]"
      >
        <div class="mb-0.5 text-sm font-medium" :class="cover ? 'text-cover' : 'text-on-surface'">
          {{ t("settings.songLevel.switchTitle") }}
        </div>
        {{ t("settings.songLevel.switchHint") }}
      </div>
    </template>
    <template #trigger>
      <span
        :class="[
          chipBase,
          'cursor-pointer transition-colors',
          cover
            ? 'border-cover/30 text-cover/80 hover:border-cover/60'
            : 'border-on-surface-variant/30 text-on-surface-variant hover:border-on-surface-variant/60',
        ]"
      >
        {{ qualityLabel }}
      </span>
    </template>
  </SPopselect>
  <STooltip
    v-else-if="media.detail?.quality"
    :content="t('settings.songLevel.unsupportedHint')"
    :side-offset="16"
    side="top"
  >
    <span
      :class="[
        chipBase,
        cover
          ? 'border-cover/25 text-cover/55'
          : 'border-on-surface-variant/25 text-on-surface-variant/80',
      ]"
    >
      {{ qualityLabel }}
    </span>
  </STooltip>
</template>
