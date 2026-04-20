<script setup lang="ts">
import type { SettingItem } from "@/types/settings-schema";
import { useSettingModel } from "@/settings/useSettingModel";

const props = defineProps<{
  item: SettingItem;
  highlighted?: boolean;
}>();

const { t } = useI18n();

const model = props.item.binding ? useSettingModel(props.item.binding) : ref<any>();

const selectOptions = computed(() =>
  (props.item.options ?? []).map((o) => ({
    value: o.value,
    label: o.label ?? (o.labelKey ? t(o.labelKey) : String(o.value)),
  })),
);

const isChildrenActive = computed(() => {
  if (props.item.childrenCondition) return props.item.childrenCondition();
  return model.value === true;
});

const isDisabled = computed(() => props.item.disabled?.() ?? false);

const descriptionText = computed(() =>
  t(props.item.descriptionKey ?? `settings.${props.item.key}.description`),
);
</script>

<template>
  <div :id="`setting-${item.key}`">
    <!-- fullWidth custom：只渲染组件，不套标签与卡片 -->
    <component
      :is="item.component"
      v-if="item.type === 'custom' && item.fullWidth && item.component"
      class="transition-all duration-300"
      :class="highlighted ? 'animate-highlight-pulse' : ''"
    />
    <div
      v-else
      class="flex items-center justify-between gap-4 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5 transition-all duration-300"
      :class="highlighted ? 'animate-highlight-pulse' : ''"
    >
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-base">
          <span>{{ t(`settings.${item.key}.label`) }}</span>
          <STag v-if="item.tag" :type="item.tag.type ?? 'primary'">
            {{ item.tag.text }}
          </STag>
        </div>
        <div class="text-sm text-on-surface-variant/70 mt-0.5">
          {{ descriptionText }}
        </div>
      </div>

      <div class="shrink-0 w-50 flex justify-end">
        <SSwitch
          v-if="item.type === 'switch'"
          :model-value="model"
          :disabled="isDisabled"
          @update:model-value="model = $event"
        />
        <SSelect
          v-else-if="item.type === 'select'"
          :model-value="model"
          :options="selectOptions"
          :disabled="isDisabled"
          @update:model-value="model = $event"
        />
        <SSlider
          v-else-if="item.type === 'slider'"
          :model-value="model"
          :min="item.min ?? 0"
          :max="item.max ?? 100"
          :step="item.step ?? 1"
          :marks="item.marks"
          :disabled="isDisabled"
          class="w-full"
          :thumb-size="14"
          :track-height="4"
          always-show-thumb
          show-popover
          @change="model = $event"
        >
          <template #popover="{ value }">{{ value }}</template>
        </SSlider>
        <SColor
          v-else-if="item.type === 'color'"
          :model-value="model"
          :disabled="isDisabled"
          :show-alpha="item.showAlpha"
          :format="item.colorFormat"
          @update:model-value="model = $event"
        />
        <SButton
          v-else-if="item.type === 'button'"
          type="primary"
          variant="secondary"
          size="small"
          @click="item.action?.()"
        >
          {{ t(`settings.${item.key}.label`) }}
        </SButton>
        <component
          :is="item.component"
          v-else-if="item.type === 'custom' && item.component"
          :model-value="model"
          @update:model-value="model = $event"
        />
      </div>
    </div>

    <!-- 子项（父级关闭时禁用） -->
    <div
      v-if="item.children?.length"
      class="mt-2.5 flex flex-col gap-2.5 transition-opacity duration-200"
      :class="isChildrenActive ? '' : 'opacity-50 pointer-events-none'"
    >
      <SettingsItem v-for="child in item.children" :key="child.key" :item="child" />
    </div>
  </div>
</template>
