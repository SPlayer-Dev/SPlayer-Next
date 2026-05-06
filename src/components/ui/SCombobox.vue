<script setup lang="ts">
import type { StyleValue } from "vue";
import IconLucideChevronDown from "~icons/lucide/chevron-down";
import IconLucideCheck from "~icons/lucide/check";
import IconLucideSearch from "~icons/lucide/search";
import IconLucideX from "~icons/lucide/x";

export type SComboboxValue = string | number;

export interface SComboboxOption {
  value: SComboboxValue;
  label: string;
  disabled?: boolean;
  style?: StyleValue;
}

export interface SComboboxProps {
  /** 单选时为 SComboboxValue，多选时为 SComboboxValue[] */
  modelValue?: SComboboxValue | SComboboxValue[];
  options?: SComboboxOption[];
  multiple?: boolean;
  /** 是否显示搜索框 */
  searchable?: boolean;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  /** 多选模式下是否显示清空按钮 */
  clearable?: boolean;
  /** 多选模式下展示的最大 tag 数 */
  maxTagCount?: number;
  /** 空状态文案 */
  emptyText?: string;
  /** 启用虚拟滚动 */
  virtual?: boolean;
}

const props = withDefaults(defineProps<SComboboxProps>(), {
  options: () => [],
  multiple: false,
  searchable: true,
  disabled: false,
  placeholder: "",
  searchPlaceholder: "",
  clearable: false,
  maxTagCount: 2,
  emptyText: "",
  virtual: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: SComboboxValue | SComboboxValue[]];
}>();

const { t } = useI18n();

/** 归一化为数组，方便统一处理 */
const selectedValues = computed<SComboboxValue[]>(() => {
  if (props.modelValue === undefined || props.modelValue === null) return [];
  return Array.isArray(props.modelValue) ? props.modelValue : [props.modelValue];
});

const selectedOptions = computed(() =>
  selectedValues.value
    .map((v) => props.options.find((o) => o.value === v))
    .filter((o): o is SComboboxOption => !!o),
);

const visibleTags = computed(() => selectedOptions.value.slice(0, props.maxTagCount));
const hiddenCount = computed(() => Math.max(0, selectedOptions.value.length - props.maxTagCount));

const triggerLabel = computed(() =>
  props.multiple ? "" : (selectedOptions.value[0]?.label ?? ""),
);
const showPlaceholder = computed(() => selectedOptions.value.length === 0);

const handleModelUpdate = (value: SComboboxValue | SComboboxValue[] | null | undefined): void => {
  if (props.multiple) emit("update:modelValue", (value ?? []) as SComboboxValue[]);
  else emit("update:modelValue", (value ?? "") as SComboboxValue);
};

const handleRemoveTag = (value: SComboboxValue): void => {
  if (!props.multiple) return;
  emit(
    "update:modelValue",
    selectedValues.value.filter((v) => v !== value),
  );
};

const handleClearAll = (event: MouseEvent): void => {
  event.stopPropagation();
  emit("update:modelValue", props.multiple ? [] : "");
};

const showClear = computed(
  () => props.clearable && !props.disabled && selectedValues.value.length > 0,
);

/** 虚拟模式下需要自己过滤选项 */
const searchTerm = ref("");

const virtualOptions = computed(() => {
  if (!searchTerm.value.trim()) return props.options;
  const q = searchTerm.value.trim().toLowerCase();
  return props.options.filter((o) => o.label.toLowerCase().includes(q));
});

const virtualEmpty = computed(() => props.virtual && virtualOptions.value.length === 0);

/** 选中后把搜索输入清空 */
const emptyDisplayValue = (): string => "";

/** 虚拟器 typeahead 用的文本提取 */
const virtualTextContent = (option: SComboboxOption): string => option.label.toLowerCase();

/** Reka `by` 比较器 */
const compareByValue = (a: unknown, b: unknown): boolean => {
  const av = a && typeof a === "object" ? (a as SComboboxOption).value : a;
  const bv = b && typeof b === "object" ? (b as SComboboxOption).value : b;
  return av === bv;
};
</script>

<template>
  <ComboboxRoot
    :model-value="multiple ? selectedValues : (selectedValues[0] ?? undefined)"
    :multiple="multiple"
    :disabled="disabled"
    :by="compareByValue"
    @update:model-value="handleModelUpdate"
  >
    <ComboboxAnchor as-child>
      <ComboboxTrigger
        as="div"
        :class="[
          'group flex w-full items-center justify-between gap-2 min-h-8.5 px-2 py-1 text-sm text-on-surface bg-surface-bright/40 border border-solid border-on-surface/20 rounded-lg transition-[border-color,box-shadow,opacity] duration-250 data-[state=open]:border-primary data-[state=open]:shadow-[0_0_0_2px_rgb(var(--s-primary)/0.25)] data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed overflow-hidden',
          disabled ? '' : 'cursor-pointer hover:border-on-surface/50',
        ]"
      >
        <!-- 多选 -->
        <div v-if="multiple" class="flex flex-1 min-w-0 items-center gap-1 flex-wrap py-0.5">
          <template v-if="visibleTags.length > 0">
            <STag
              v-for="opt in visibleTags"
              :key="String(opt.value)"
              type="primary"
              variant="soft"
              size="small"
              :closable="!disabled"
              @close="handleRemoveTag(opt.value)"
            >
              {{ opt.label }}
            </STag>
            <STag v-if="hiddenCount > 0" type="default" variant="soft" size="small">
              +{{ hiddenCount }}
            </STag>
          </template>
          <span v-else class="text-on-surface-variant/40 truncate">{{ placeholder }}</span>
        </div>
        <!-- 单选 -->
        <span
          v-else
          class="flex-1 min-w-0 truncate text-left"
          :class="showPlaceholder ? 'text-on-surface-variant/40' : ''"
        >
          {{ showPlaceholder ? placeholder : triggerLabel }}
        </span>
        <IconLucideX
          v-if="showClear"
          class="size-3.5 text-on-surface-variant/50 shrink-0 cursor-pointer transition-colors duration-200 hover:text-on-surface"
          @click="handleClearAll"
        />
        <IconLucideChevronDown
          class="size-3.5 text-on-surface-variant/50 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180"
        />
      </ComboboxTrigger>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent
        position="popper"
        :side-offset="4"
        class="z-400 w-[var(--reka-popper-anchor-width)] overflow-hidden rounded-xl bg-surface-bright shadow-lg data-[state=open]:animate-select-in data-[state=closed]:animate-select-out"
      >
        <!-- 搜索框 -->
        <div
          v-if="searchable"
          class="flex items-center gap-2 px-3 h-9 border-b border-b-solid border-b-on-surface/8"
        >
          <IconLucideSearch class="size-3.5 text-on-surface-variant/50 shrink-0" />
          <ComboboxInput
            v-model="searchTerm"
            :display-value="emptyDisplayValue"
            class="flex-1 min-w-0 h-full bg-transparent border-none shadow-none text-sm text-on-surface placeholder:text-on-surface-variant/40"
            :placeholder="searchPlaceholder || t('common.search')"
            autocomplete="off"
            auto-focus
          />
        </div>

        <!-- 非虚拟 -->
        <template v-if="!virtual">
          <ComboboxEmpty class="px-3 py-4 text-sm text-center text-on-surface-variant/60">
            {{ emptyText || t("common.noData") }}
          </ComboboxEmpty>
          <ComboboxViewport class="p-1 max-h-60 overflow-y-auto">
            <ComboboxItem
              v-for="opt in options"
              :key="String(opt.value)"
              :value="opt.value"
              :disabled="opt.disabled"
              :title="opt.label"
              :style="opt.style"
              class="relative flex items-center h-8.5 px-3 pr-8 text-sm rounded-md cursor-pointer transition-[background-color,color] duration-200 data-[highlighted]:bg-on-surface/8 data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
              :class="selectedValues.includes(opt.value) ? 'text-primary' : 'text-on-surface'"
            >
              <span class="truncate">{{ opt.label }}</span>
              <ComboboxItemIndicator class="absolute right-2">
                <IconLucideCheck class="size-3.5 text-primary" />
              </ComboboxItemIndicator>
            </ComboboxItem>
          </ComboboxViewport>
        </template>

        <!-- 虚拟 -->
        <template v-else>
          <div v-if="virtualEmpty" class="px-3 py-4 text-sm text-center text-on-surface-variant/60">
            {{ emptyText || t("common.noData") }}
          </div>
          <ComboboxViewport v-else class="p-1 max-h-60 overflow-y-auto">
            <ComboboxVirtualizer
              :options="virtualOptions"
              :estimate-size="34"
              :text-content="virtualTextContent"
            >
              <template #default="{ option }">
                <ComboboxItem
                  :value="option.value"
                  :disabled="option.disabled"
                  :title="option.label"
                  :style="option.style"
                  class="relative flex items-center w-full h-8.5 px-3 pr-8 text-sm rounded-md cursor-pointer transition-[background-color,color] duration-200 data-[highlighted]:bg-on-surface/8 data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
                  :class="
                    selectedValues.includes(option.value) ? 'text-primary' : 'text-on-surface'
                  "
                >
                  <span class="truncate">{{ option.label }}</span>
                  <ComboboxItemIndicator class="absolute right-2">
                    <IconLucideCheck class="size-3.5 text-primary" />
                  </ComboboxItemIndicator>
                </ComboboxItem>
              </template>
            </ComboboxVirtualizer>
          </ComboboxViewport>
        </template>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
