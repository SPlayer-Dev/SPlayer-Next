<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import * as player from "@/core/player";

defineProps<{ open: boolean }>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const status = useStatusStore();

const SPEED_MIN = 0.5;
const SPEED_MAX = 2.0;
const SPEED_STEP = 0.05;
const PITCH_MIN = -12;
const PITCH_MAX = 12;
const PITCH_STEP = 1;

/** 速度快捷值 */
const SPEED_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

/** 拖拽中的临时值（松手才下发到引擎） */
const localSpeed = ref(status.speed);
const localPitch = ref(status.pitch);

watchEffect(() => {
  localSpeed.value = status.speed;
});
watchEffect(() => {
  localPitch.value = status.pitch;
});

const formatSpeed = (v: number): string => `${v.toFixed(2)}x`;
const formatPresetSpeed = (v: number): string =>
  Number.isInteger(v) ? `${v}x` : `${v.toString().replace(/0+$/, "").replace(/\.$/, "")}x`;
const formatPitch = (n: number): string => {
  if (n === 0) return t("speed.semitone", { n: 0 });
  return t("speed.semitone", { n: n > 0 ? `+${n}` : String(n) });
};

const isPresetActive = (v: number): boolean => Math.abs(localSpeed.value - v) < 1e-3;

const onSpeedChange = (v: number): void => {
  localSpeed.value = v;
};
const onSpeedCommit = (v: number): void => {
  player.setSpeed(v).catch(() => {});
};
const onPresetClick = (v: number): void => {
  localSpeed.value = v;
  player.setSpeed(v).catch(() => {});
};

const onPitchChange = (v: number): void => {
  localPitch.value = v;
};
const onPitchCommit = (v: number): void => {
  player.setPitch(v).catch(() => {});
};

const onSyncToggle = (v: boolean): void => {
  player.setPitchSync(v).catch(() => {});
};

const handleReset = (): void => {
  player.setSpeed(1.0).catch(() => {});
  player.setPitch(0).catch(() => {});
  player.setPitchSync(true).catch(() => {});
};
</script>

<template>
  <SDialog
    :open="open"
    :title="t('speed.title')"
    width="440px"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-5">
      <!-- 速度 -->
      <div class="flex flex-col gap-2.5">
        <div class="flex items-baseline justify-between">
          <span class="text-sm text-on-surface">{{ t("speed.speed") }}</span>
          <span class="text-sm text-primary tabular-nums">{{ formatSpeed(localSpeed) }}</span>
        </div>
        <!-- 快捷预设 -->
        <div class="flex flex-wrap gap-1.5">
          <SButton
            v-for="preset in SPEED_PRESETS"
            :key="preset"
            :type="isPresetActive(preset) ? 'primary' : 'default'"
            :variant="isPresetActive(preset) ? 'secondary' : 'ghost'"
            size="small"
            class="flex-1 min-w-12 tabular-nums"
            @click="onPresetClick(preset)"
          >
            {{ formatPresetSpeed(preset) }}
          </SButton>
        </div>
        <SSlider
          :model-value="localSpeed"
          :min="SPEED_MIN"
          :max="SPEED_MAX"
          :step="SPEED_STEP"
          @change="onSpeedChange"
          @drag-end="onSpeedCommit"
        >
          <template #popover="{ value }">{{ formatSpeed(value) }}</template>
        </SSlider>
      </div>

      <!-- 音调同步 -->
      <div class="flex items-center justify-between">
        <div class="flex flex-col">
          <span class="text-sm text-on-surface">{{ t("speed.pitchSync") }}</span>
          <span class="text-xs text-on-surface-variant/70">{{ t("speed.pitchSyncTip") }}</span>
        </div>
        <SSwitch :model-value="status.pitchSync" @update:model-value="onSyncToggle" />
      </div>

      <!-- 音调（同步关闭时禁用，不隐藏） -->
      <div
        class="flex flex-col gap-2 transition-opacity"
        :class="!status.pitchSync && 'opacity-50'"
      >
        <div class="flex items-baseline justify-between">
          <span class="text-sm text-on-surface">{{ t("speed.pitch") }}</span>
          <span class="text-sm text-primary tabular-nums">{{ formatPitch(localPitch) }}</span>
        </div>
        <SSlider
          :model-value="localPitch"
          :min="PITCH_MIN"
          :max="PITCH_MAX"
          :step="PITCH_STEP"
          :disabled="!status.pitchSync"
          center-fill
          @change="onPitchChange"
          @drag-end="onPitchCommit"
        >
          <template #popover="{ value }">{{ formatPitch(value) }}</template>
        </SSlider>
      </div>
    </div>

    <template #footer>
      <SButton variant="secondary" @click="handleReset">{{ t("common.reset") }}</SButton>
    </template>
  </SDialog>
</template>
