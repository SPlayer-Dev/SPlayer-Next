<script setup lang="ts">
import type { Component } from "vue";

export interface SMenuItem {
  key: string;
  label: string;
  icon?: Component;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    items: SMenuItem[];
    modelValue?: string;
    /** 尺寸：small（紧凑）| medium（默认）| large（宽松） */
    size?: "small" | "medium" | "large";
    /** 折叠模式 */
    collapsed?: boolean;
  }>(),
  { size: "medium", collapsed: false },
);

const emit = defineEmits<{
  "update:modelValue": [key: string];
  select: [key: string];
}>();

const sizeClass = computed(() => {
  const collapsed = props.collapsed;
  switch (props.size) {
    case "small":
      return { item: "h-9 px-2.5 text-sm gap-2.5", icon: collapsed ? "size-5" : "size-[18px]" };
    case "large":
      return { item: "h-11 px-3.5 text-[15px] gap-3.5", icon: collapsed ? "size-6" : "size-[22px]" };
    default:
      return { item: "h-10.5 px-3 text-sm gap-3", icon: collapsed ? "size-5.5" : "size-5" };
  }
});

const handleSelect = (item: SMenuItem) => {
  if (item.disabled) return;
  emit("update:modelValue", item.key);
  emit("select", item.key);
};
</script>

<template>
  <nav class="flex flex-col gap-1">
    <STooltip
      v-for="item in items"
      :key="item.key"
      :content="item.label"
      :disabled="!collapsed"
      :side-offset="12"
      side="right"
    >
      <div
        class="relative flex items-center rounded-lg cursor-pointer select-none overflow-hidden whitespace-nowrap"
        :class="[
          sizeClass.item,
          modelValue === item.key
            ? 'bg-primary/10 text-primary'
            : 'text-on-surface-variant hover:bg-on-surface/5',
          item.disabled ? 'opacity-40 pointer-events-none' : '',
        ]"
        @click="handleSelect(item)"
      >
        <component v-if="item.icon" :is="item.icon" :class="[sizeClass.icon, 'shrink-0 transition-[width,height] duration-300']" />
        <span
          class="truncate transition-opacity duration-300"
          :class="collapsed ? 'opacity-0' : 'opacity-100'"
        >
          {{ item.label }}
        </span>
        <Transition name="fade">
          <span
            v-if="modelValue === item.key"
            class="absolute left-0 top-2 bottom-2 w-0.75 rounded-full bg-primary"
          />
        </Transition>
      </div>
    </STooltip>
  </nav>
</template>
