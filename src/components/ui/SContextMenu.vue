<script setup lang="ts">
import type { DropdownMenuItem } from "./SDropdownMenu.vue";

const props = withDefaults(
  defineProps<{
    /** 菜单项列表 */
    items: DropdownMenuItem[];
    /** 对齐方式 */
    alignOffset?: number;
  }>(),
  {
    alignOffset: 0,
  },
);

/** 选择菜单项事件 */
const emit = defineEmits<{
  select: [key: string];
}>();

/** 显示的项 */
const visibleItems = computed(() => props.items.filter((item) => item.show !== false));

/** 选择菜单项 */
const handleSelect = (item: DropdownMenuItem): void => {
  if (item.disabled) return;
  emit("select", item.key);
};

/** 内容区域样式 */
const contentClass =
  "z-300 min-w-32 max-w-52 rounded-lg bg-surface-bright shadow-lg p-1 text-sm data-[state=open]:animate-popover-in data-[state=closed]:animate-popover-out";

/** 菜单项样式 */
const menuItemClass =
  "flex items-center gap-2 px-2 py-1.5 rounded-md text-on-surface outline-none select-none cursor-pointer data-[highlighted]:bg-on-surface/12 data-[disabled]:opacity-40 data-[disabled]:pointer-events-none";
</script>

<template>
  <ContextMenuRoot>
    <ContextMenuTrigger as="div" class="contents">
      <slot />
    </ContextMenuTrigger>

    <ContextMenuPortal>
      <ContextMenuContent
        :align-offset="alignOffset"
        :avoid-collisions="true"
        :class="contentClass"
      >
        <slot name="header" />
        <SDivider v-if="$slots.header" class="mx-1.5 my-0.5" />
        <template v-for="item in visibleItems" :key="item.key">
          <SDivider v-if="item.separator" class="mx-1.5 my-0.5" />
          <!-- 子菜单 -->
          <ContextMenuSub v-if="item.children">
            <ContextMenuSubTrigger :disabled="item.disabled" :class="menuItemClass">
              <component :is="item.icon" v-if="item.icon" class="size-3.5 opacity-60 shrink-0" />
              <span class="flex-1">{{ item.label }}</span>
              <IconLucideChevronRight class="size-3 opacity-40 shrink-0" />
            </ContextMenuSubTrigger>
            <ContextMenuPortal>
              <ContextMenuSubContent
                :side-offset="4"
                :avoid-collisions="true"
                :class="[contentClass, 'max-h-60 overflow-y-auto']"
              >
                <template v-for="child in item.children" :key="child.key">
                  <SDivider v-if="child.separator" class="mx-1.5 my-0.5" />
                  <ContextMenuItem
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
                  </ContextMenuItem>
                </template>
              </ContextMenuSubContent>
            </ContextMenuPortal>
          </ContextMenuSub>
          <!-- 普通菜单项 -->
          <ContextMenuItem
            v-else
            :disabled="item.disabled"
            :class="menuItemClass"
            @select="handleSelect(item)"
          >
            <component :is="item.icon" v-if="item.icon" class="size-3.5 opacity-60 shrink-0" />
            <span>{{ item.label }}</span>
          </ContextMenuItem>
        </template>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
