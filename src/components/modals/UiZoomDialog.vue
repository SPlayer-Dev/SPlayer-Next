<script setup lang="ts">
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();

/** 当前缩放百分比 */
const percent = ref(100);

/** 写入并应用缩放：config:set 触发主进程 applyMainWindowZoom */
const apply = (value: number | null): void => {
  if (value == null) return;
  percent.value = value;
  window.api.config.set("system.uiZoom", value).catch(() => {});
};

/** 恢复默认 100% */
const reset = (): void => apply(100);

// 打开时读取当前缩放值
watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    const saved = await window.api.config.get("system.uiZoom");
    percent.value = typeof saved === "number" ? saved : 100;
  },
);
</script>

<template>
  <SDialog
    :open="open"
    :title="t('uiZoom.title')"
    width="360px"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col items-center gap-5 py-2">
      <span class="text-sm text-on-surface-variant">{{ t("uiZoom.range") }}</span>
      <SNumberInput
        :model-value="percent"
        :min="50"
        :max="200"
        :step="5"
        unit="%"
        size="large"
        class="w-50"
        @update:model-value="apply"
      />
    </div>
    <template #footer>
      <SButton variant="secondary" @click="reset">{{ t("uiZoom.reset") }}</SButton>
    </template>
  </SDialog>
</template>
