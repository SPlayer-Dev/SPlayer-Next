<script setup lang="ts">
import type { Component, VNode } from "vue";

export interface SMenuItem {
  /** 菜单项类型 */
  type?: "item" | "divider" | "group";
  key: string;
  label?: string;
  icon?: Component;
  disabled?: boolean;
  /** group 类型的自定义渲染内容 */
  render?: () => VNode;
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
      return {
        item: "h-11 px-3.5 text-[15px] gap-3.5",
        icon: collapsed ? "size-6" : "size-[22px]",
      };
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
    <template v-for="item in items" :key="item.key">
      <!-- 分隔线 -->
      <SDivider v-if="item.type === 'divider'" class="mx-1" />
      <!-- 分类标题 -->
      <div
        v-else-if="item.type === 'group' && item.render"
        class="overflow-hidden transition-[max-height,opacity] duration-300"
        :class="collapsed ? 'max-h-0 opacity-0' : 'max-h-11 opacity-100'"
      >
        <component :is="item.render" />
      </div>
      <!-- 菜单项 -->
      <STooltip
        v-else-if="!item.type || item.type === 'item'"
        :content="item.label ?? ''"
        :disabled="!collapsed"
        :side-offset="12"
        side="right"
      >
        <div
          class="relative flex items-center rounded-lg cursor-pointer select-none overflow-hidden whitespace-nowrap transition-[background-color,color] duration-250"
          :class="[
            sizeClass.item,
            modelValue === item.key
              ? 'bg-primary/10 text-primary'
              : 'text-on-surface/80 hover:bg-on-surface/5',
            item.disabled ? 'opacity-40 pointer-events-none' : '',
          ]"
          @click="handleSelect(item)"
        >
          <component
            :is="item.icon"
            v-if="item.icon"
            :class="[sizeClass.icon, 'shrink-0 transition-[width,height] duration-300']"
          />
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
    </template>
  </nav>
</template>
