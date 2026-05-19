<script setup lang="ts">
import type { Component, VNode } from "vue";

export interface SMenuItem {
  /** 菜单项类型 */
  type?: "item" | "divider" | "group";
  key: string;
  label?: string;
  icon?: Component;
  cover?: string;
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
      return {
        item: collapsed ? "h-9 text-sm gap-0 justify-center" : "h-9 px-2.5 text-sm gap-2.5",
        coverItem: collapsed
          ? "h-10 text-sm gap-0 justify-center"
          : "h-11 px-2.5 text-sm gap-2.5",
        icon: collapsed ? "size-5" : "size-4.5",
        cover: collapsed ? "size-6" : "size-8",
      };
    case "large":
      return {
        item: collapsed
          ? "h-11 text-[15px] gap-0 justify-center"
          : "h-11 px-3.5 text-[15px] gap-3.5",
        coverItem: collapsed
          ? "h-12 text-[15px] gap-0 justify-center"
          : "h-14 px-3.5 text-[15px] gap-3.5",
        icon: collapsed ? "size-6" : "size-5.5",
        cover: collapsed ? "size-7" : "size-10",
      };
    default:
      return {
        item: collapsed ? "h-10.5 text-sm gap-0 justify-center" : "h-10.5 px-3 text-sm gap-3",
        coverItem: collapsed ? "h-11 text-sm gap-0 justify-center" : "h-13 px-3 text-sm gap-3",
        icon: collapsed ? "size-5.5" : "size-5",
        cover: collapsed ? "size-7" : "size-9",
      };
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
          class="relative flex items-center rounded-lg cursor-pointer select-none overflow-hidden whitespace-nowrap transition-[background-color,color,height,padding] duration-250"
          :class="[
            item.cover !== undefined ? sizeClass.coverItem : sizeClass.item,
            modelValue === item.key
              ? 'bg-primary/10 text-primary'
              : 'text-on-surface/80 hover:bg-on-surface/5',
            item.disabled ? 'opacity-40 pointer-events-none' : '',
          ]"
          @click="handleSelect(item)"
        >
          <SImg
            v-if="item.cover !== undefined"
            :src="item.cover"
            :class="[
              sizeClass.cover,
              'shrink-0 rounded-md object-cover transition-[width,height] duration-300',
            ]"
          />
          <component
            :is="item.icon"
            v-else-if="item.icon"
            :class="[sizeClass.icon, 'shrink-0 transition-[width,height] duration-300']"
          />
          <span
            class="truncate transition-[opacity,width] duration-300"
            :class="collapsed ? 'opacity-0 w-0' : 'opacity-100'"
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
