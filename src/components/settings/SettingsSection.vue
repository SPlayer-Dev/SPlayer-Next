<script setup lang="ts">
import type { SettingSection } from "@/types/settings-schema";

const props = withDefaults(
  defineProps<{
    section: SettingSection;
    highlightKey?: string;
    /** 全局动画起始索引 */
    startIndex?: number;
  }>(),
  { startIndex: 0 },
);

const { t } = useI18n();

const visibleItems = computed(() => props.section.items);

const itemStyle = (i: number) => {
  const d = props.highlightKey ? "0s" : `${Math.min(props.startIndex + i, 15) * 0.03}s`;
  return {
    animationDelay: d,
    animationFillMode: "backwards" as const,
  };
};
</script>

<template>
  <div v-if="visibleItems.length > 0" class="mb-8 last:mb-0">
    <h3
      class="animate-slide-in-item flex items-center gap-2 text-lg font-semibold text-on-surface mb-3 px-1"
      :style="itemStyle(0)"
    >
      <span class="w-0.75 h-4 rounded-full bg-primary" />
      {{ t(`settings.section.${section.id}`) }}
      <STag v-if="section.tag" :type="section.tag.type ?? 'primary'" class="ml-1">
        {{ section.tag.text }}
      </STag>
    </h3>
    <div class="flex flex-col gap-2.5">
      <SettingsItem
        v-for="(item, i) in visibleItems"
        :key="item.key"
        :item="item"
        :highlighted="item.key === highlightKey"
        class="animate-slide-in-item"
        :style="itemStyle(i + 1)"
      />
    </div>
  </div>
</template>
