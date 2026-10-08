<script setup lang="ts">
import type { Component, VNode, ComponentPublicInstance } from "vue";

export interface SMenuItem {
  /** 菜单项类型 */
  type?: "item" | "divider" | "group";
  key: string;
  label?: string;
  icon?: Component;
  /** 封面 URL */
  cover?: string;
  /** 是否以封面形式展示 */
  showCover?: boolean;
  disabled?: boolean;
  /** group 类型的自定义渲染内容 */
  render?: () => VNode;
  /** item 类型的行尾自定义内容 */
  trailing?: () => VNode;
}

const props = withDefaults(
  defineProps<{
    items: SMenuItem[];
    modelValue?: string;
    /** 尺寸：small（紧凑）| medium（默认）| large（宽松） */
    size?: "small" | "medium" | "large";
    /** 折叠模式 */
    collapsed?: boolean;
    /** 挂载时把选中项滚动到可视区中间 */
    centerActiveOnMount?: boolean;
  }>(),
  { size: "medium", collapsed: false, centerActiveOnMount: false },
);

const emit = defineEmits<{
  "update:modelValue": [key: string];
  select: [key: string];
}>();

/** 各菜单项行元素，按 key 收集，用于定位选中项 */
const itemEls = new Map<string, HTMLElement>();
const setItemEl = (key: string, el: Element | ComponentPublicInstance | null): void => {
  if (el instanceof HTMLElement) itemEls.set(key, el);
  else itemEls.delete(key);
};

onMounted(() => {
  if (!props.centerActiveOnMount) return;
  const key = props.modelValue;
  if (!key) return;
  nextTick(() => itemEls.get(key)?.scrollIntoView({ block: "center" }));
});

const sizeClass = computed(() => {
  const collapsed = props.collapsed;
  switch (props.size) {
    case "small":
      return {
        item: "h-9 px-2.5 text-sm gap-2.5",
        coverItem: "h-11 px-2.5 text-sm gap-2.5",
        icon: collapsed ? "size-5" : "size-4.5",
        cover: collapsed ? "size-6" : "size-8",
      };
    case "large":
      return {
        item: "h-11 px-3.5 text-[15px] gap-3.5",
        coverItem: collapsed
          ? "h-14 px-2.5 text-[15px] gap-3.5"
          : "h-14 px-3.5 text-[15px] gap-3.5",
        icon: collapsed ? "size-6" : "size-5.5",
        cover: collapsed ? "size-7" : "size-10",
      };
    default:
      return {
        item: "h-10.5 px-3 text-sm gap-3",
        coverItem: collapsed ? "h-13 px-2.5 text-sm gap-3" : "h-13 px-3 text-sm gap-3",
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
          :ref="(el) => setItemEl(item.key, el)"
          :data-menu-key="item.key"
          class="relative flex items-center rounded-lg cursor-pointer select-none overflow-hidden whitespace-nowrap transition-[background-color,color,height,padding] duration-250"
          :class="[
            item.showCover ? sizeClass.coverItem : sizeClass.item,
            modelValue === item.key
              ? 'bg-primary/10 text-primary'
              : 'text-on-surface/80 hover:bg-on-surface/5',
            item.disabled ? 'opacity-40 pointer-events-none' : '',
          ]"
          @click="handleSelect(item)"
        >
          <SImg
            v-if="item.showCover"
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
            class="flex-1 min-w-0 truncate transition-opacity duration-300"
            :class="collapsed ? 'opacity-0' : 'opacity-100'"
          >
            {{ item.label }}
          </span>
          <!-- 行尾自定义 -->
          <div
            v-if="!collapsed && item.trailing"
            class="shrink-0 transition-opacity duration-300"
            @click.stop
          >
            <component :is="item.trailing" />
          </div>
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
