<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import * as autoClose from "@/services/autoClose";
import { formatCountdown } from "@/utils/time";

defineProps<{ open: boolean }>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const status = useStatusStore();

const PRESETS = [10, 20, 30, 45, 60, 90, 120];
const DURATION_MIN = 1;
const DURATION_MAX = 180;

/** 弹窗里编辑中的临时值；点"启用"才下发 */
const localDuration = ref(status.autoClose.duration);
const localWaitSongEnd = ref(status.autoClose.waitSongEnd);

watchEffect(() => {
  // 外部状态变化（如 cancel）时同步本地编辑值
  if (!status.autoClose.enable) {
    localDuration.value = status.autoClose.duration;
    localWaitSongEnd.value = status.autoClose.waitSongEnd;
  }
});

const isPresetActive = (v: number): boolean => localDuration.value === v;

const onPresetClick = (v: number): void => {
  localDuration.value = v;
};

const onApply = (): void => {
  autoClose.start(localDuration.value, localWaitSongEnd.value);
};

const onCancel = (): void => {
  autoClose.cancel();
};
</script>

<template>
  <SDialog
    :open="open"
    :title="t('autoClose.title')"
    width="420px"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-5">
      <!-- 当前状态 / 倒计时 -->
      <div
        v-if="status.autoClose.enable"
        class="flex items-center justify-between p-3 rounded-lg bg-primary/8 border border-solid border-primary/15"
      >
        <span class="text-sm text-on-surface">{{ t("autoClose.remaining") }}</span>
        <span class="text-base text-primary tabular-nums font-semibold">
          {{ formatCountdown(status.autoClose.remainTime) }}
        </span>
      </div>

      <!-- 预设 -->
      <div class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between">
          <span class="text-sm text-on-surface">{{ t("autoClose.duration") }}</span>
          <span class="text-xs text-on-surface-variant/70">{{ t("autoClose.unitHint") }}</span>
        </div>
        <!-- 按钮只放数字；单位由 header 右侧 hint 给出，避免"120 分钟"撑爆 7 列布局 -->
        <div class="grid grid-cols-7 gap-1.5">
          <SButton
            v-for="preset in PRESETS"
            :key="preset"
            :type="isPresetActive(preset) ? 'primary' : 'default'"
            :variant="isPresetActive(preset) ? 'secondary' : 'tertiary'"
            size="small"
            class="tabular-nums"
            @click="onPresetClick(preset)"
          >
            {{ preset }}
          </SButton>
        </div>
      </div>

      <!-- 自定义时长 -->
      <div class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between">
          <span class="text-sm text-on-surface">{{ t("autoClose.custom") }}</span>
          <span class="text-sm text-primary tabular-nums">
            {{ t("autoClose.minute", { n: localDuration }) }}
          </span>
        </div>
        <SSlider
          :model-value="localDuration"
          :min="DURATION_MIN"
          :max="DURATION_MAX"
          :step="1"
          @change="(v: number) => (localDuration = v)"
        >
          <template #popover="{ value }">{{ t("autoClose.minute", { n: value }) }}</template>
        </SSlider>
      </div>

      <!-- 等待整曲结束 -->
      <div class="flex items-center justify-between">
        <div class="flex flex-col">
          <span class="text-sm text-on-surface">{{ t("autoClose.waitSongEnd") }}</span>
          <span class="text-xs text-on-surface-variant/70">{{
            t("autoClose.waitSongEndTip")
          }}</span>
        </div>
        <SSwitch v-model:model-value="localWaitSongEnd" />
      </div>
    </div>

    <template #footer="{ close }">
      <SButton v-if="status.autoClose.enable" type="error" variant="tertiary" @click="onCancel">
        {{ t("autoClose.stop") }}
      </SButton>
      <SButton
        type="primary"
        @click="
          onApply();
          close();
        "
      >
        {{ status.autoClose.enable ? t("autoClose.update") : t("autoClose.start") }}
      </SButton>
    </template>
  </SDialog>
</template>
