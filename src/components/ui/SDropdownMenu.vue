<script setup lang="ts">
import type { Component } from "vue";

export interface DropdownMenuItem {
  /** 唯一标识 */
  key: string;
  /** 显示文本 */
  label: string;
  /** 图标组件 */
  icon?: Component;
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否显示 */
  show?: boolean;
  /** 分割线：在此项上方显示分割线 */
  separator?: boolean;
  /** 子菜单 */
  children?: DropdownMenuItem[];
}

const props = withDefaults(
  defineProps<{
    /** 菜单项列表 */
    items: DropdownMenuItem[];
    /** 弹出位置 */
    side?: "top" | "right" | "bottom" | "left";
    /** 对齐方式 */
    align?: "start" | "center" | "end";
    /** 与触发元素的距离（px） */
    sideOffset?: number;
  }>(),
  {
    side: "bottom",
    align: "center",
    sideOffset: 4,
  },
);

const emit = defineEmits<{
  select: [key: string];
}>();

/** 显示的项 */
const visibleItems = computed(() => props.items.filter((item) => item.show !== false));

const handleSelect = (item: DropdownMenuItem): void => {
  if (item.disabled) return;
  emit("select", item.key);
};

/** 内容区域样式 */
const contentClass =
  "z-300 min-w-32 rounded-lg bg-surface-bright shadow-lg p-1 text-sm data-[state=open]:animate-popover-in data-[state=closed]:animate-popover-out";

/** 菜单项样式 */
const menuItemClass =
  "flex items-center gap-2 px-2 py-1.5 rounded-md text-on-surface outline-none select-none cursor-pointer transition-colors data-[highlighted]:bg-on-surface/5 data-[disabled]:opacity-40 data-[disabled]:pointer-events-none";
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as="div" class="inline-flex">
      <slot name="trigger" />
    </DropdownMenuTrigger>

    <DropdownMenuPortal>
      <DropdownMenuContent
        :side="side"
        :align="align"
        :side-offset="sideOffset"
        :avoid-collisions="true"
        :class="contentClass"
      >
        <template v-for="item in visibleItems" :key="item.key">
          <SDivider v-if="item.separator" class="mx-1.5 my-0.5" />
          <!-- 子菜单 -->
          <DropdownMenuSub v-if="item.children">
            <DropdownMenuSubTrigger :disabled="item.disabled" :class="menuItemClass">
              <component :is="item.icon" v-if="item.icon" class="size-3.5 opacity-60 shrink-0" />
              <span class="flex-1">{{ item.label }}</span>
              <IconLucideChevronRight class="size-3 opacity-40 shrink-0" />
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent
                :side-offset="4"
                :avoid-collisions="true"
                :class="[contentClass, 'max-h-60 overflow-y-auto']"
              >
                <template v-for="child in item.children" :key="child.key">
                  <SDivider v-if="child.separator" class="mx-1.5 my-0.5" />
                  <DropdownMenuItem
                    v-else
                    :disabled="child.disabled"
                    :class="menuItemClass"
                    @select="handleSelect(child)"
                  >
                    <component
                      :is="child.icon"
                      v-if="child.icon"
                      class="size-3.5 opacity-60 shrink-0"
                    />
                    <span>{{ child.label }}</span>
                  </DropdownMenuItem>
                </template>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <!-- 普通菜单项 -->
          <DropdownMenuItem
            v-else
            :disabled="item.disabled"
            :class="menuItemClass"
            @select="handleSelect(item)"
          >
            <component :is="item.icon" v-if="item.icon" class="size-3.5 opacity-60 shrink-0" />
            <span>{{ item.label }}</span>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
