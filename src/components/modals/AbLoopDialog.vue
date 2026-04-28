<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import * as abLoop from "@/services/abLoop";
import { formatTimeWithDeci } from "@/utils/time";

defineProps<{ open: boolean }>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const status = useStatusStore();

const NUDGE_STEP = 0.1;

/** B 必须严格大于 A，否则不能 enable */
const canEnable = computed(() => {
  const a = status.abLoop.pointA;
  const b = status.abLoop.pointB;
  return a !== null && b !== null && b > a;
});

const showWarning = computed(() => {
  const a = status.abLoop.pointA;
  const b = status.abLoop.pointB;
  return a !== null && b !== null && b <= a;
});

const formatPoint = (ms: number | null): string =>
  ms === null ? "--:--.-" : formatTimeWithDeci(ms);

const onSetAFromCurrent = (): void => abLoop.setA(status.position);
const onSetBFromCurrent = (): void => abLoop.setB(status.position);

const onToggleEnable = (v: boolean): void => abLoop.setEnabled(v);
</script>

<template>
  <SDialog
    :open="open"
    :title="t('abLoop.title')"
    width="440px"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-4">
      <!-- 启用开关 -->
      <div class="flex items-center justify-between">
        <div class="flex flex-col">
          <span class="text-sm text-on-surface">{{ t("abLoop.enable") }}</span>
          <span class="text-xs text-on-surface-variant/70">{{ t("abLoop.enableTip") }}</span>
        </div>
        <SSwitch
          :model-value="status.abLoop.enable"
          :disabled="!canEnable"
          @update:model-value="onToggleEnable"
        />
      </div>

      <!-- A 点 -->
      <SCard class="flex flex-col gap-2 p-3">
        <div class="flex items-baseline justify-between">
          <span class="text-sm text-on-surface">{{ t("abLoop.pointA") }}</span>
          <span class="text-base text-primary tabular-nums font-semibold">
            {{ formatPoint(status.abLoop.pointA) }}
          </span>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <SButton size="small" variant="secondary" @click="onSetAFromCurrent">
            {{ t("abLoop.setCurrent") }}
          </SButton>
          <SButton
            size="small"
            variant="tertiary"
            :disabled="status.abLoop.pointA === null"
            @click="abLoop.nudgeA(-NUDGE_STEP)"
          >
            {{ t("abLoop.minus", { n: NUDGE_STEP }) }}
          </SButton>
          <SButton
            size="small"
            variant="tertiary"
            :disabled="status.abLoop.pointA === null"
            @click="abLoop.nudgeA(NUDGE_STEP)"
          >
            {{ t("abLoop.plus", { n: NUDGE_STEP }) }}
          </SButton>
          <SButton
            size="small"
            variant="ghost"
            :disabled="status.abLoop.pointA === null"
            @click="abLoop.clearA"
          >
            {{ t("abLoop.clear") }}
          </SButton>
        </div>
      </SCard>

      <!-- B 点 -->
      <SCard class="flex flex-col gap-2 p-3">
        <div class="flex items-baseline justify-between">
          <span class="text-sm text-on-surface">{{ t("abLoop.pointB") }}</span>
          <span class="text-base text-primary tabular-nums font-semibold">
            {{ formatPoint(status.abLoop.pointB) }}
          </span>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <SButton size="small" variant="secondary" @click="onSetBFromCurrent">
            {{ t("abLoop.setCurrent") }}
          </SButton>
          <SButton
            size="small"
            variant="tertiary"
            :disabled="status.abLoop.pointB === null"
            @click="abLoop.nudgeB(-NUDGE_STEP)"
          >
            {{ t("abLoop.minus", { n: NUDGE_STEP }) }}
          </SButton>
          <SButton
            size="small"
            variant="tertiary"
            :disabled="status.abLoop.pointB === null"
            @click="abLoop.nudgeB(NUDGE_STEP)"
          >
            {{ t("abLoop.plus", { n: NUDGE_STEP }) }}
          </SButton>
          <SButton
            size="small"
            variant="ghost"
            :disabled="status.abLoop.pointB === null"
            @click="abLoop.clearB"
          >
            {{ t("abLoop.clear") }}
          </SButton>
        </div>
      </SCard>

      <div v-if="showWarning" class="text-xs text-amber-500 px-1">
        {{ t("abLoop.warningBLessThanA") }}
      </div>
    </div>

    <template #footer="{ close }">
      <SButton type="primary" @click="close">{{ t("common.close") }}</SButton>
    </template>
  </SDialog>
</template>
