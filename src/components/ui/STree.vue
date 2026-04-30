<script setup lang="ts" generic="T extends object">
import { TreeRoot, TreeItem } from "reka-ui";

withDefaults(
  defineProps<{
    /** 树的根节点列表 */
    items: T[];
    /** 取节点唯一 key */
    getKey: (node: T) => string;
    /** 取节点子节点；返回 undefined 表示叶子 */
    getChildren?: (node: T) => T[] | undefined;
    /** 受控展开 keys（v-model:expanded） */
    expanded?: string[];
    /** 受控选中节点（v-model） */
    modelValue?: T | null;
    /** 每级缩进（px） */
    indent?: number;
    /** 单行高度（含上下 margin） */
    itemHeight?: number;
  }>(),
  {
    indent: 16,
    getChildren: ((node: { children?: unknown[] }) => node.children) as never,
    expanded: undefined,
    modelValue: undefined,
    itemHeight: 40,
  },
);

const emit = defineEmits<{
  "update:expanded": [keys: string[]];
  /** 节点选中变化（v-model）；传 null 表示无选中 */
  "update:modelValue": [value: T | null];
}>();

const getFlatKey = (item: { _id: string }): string => item._id;
</script>

<template>
  <TreeRoot
    v-slot="{ flattenItems }"
    as="div"
    :items="items as any[]"
    :get-key="getKey as any"
    :get-children="getChildren as any"
    :expanded="expanded"
    :model-value="modelValue as any"
    selection-behavior="replace"
    class="size-full select-none py-2"
    @update:expanded="emit('update:expanded', $event)"
    @update:model-value="emit('update:modelValue', ($event as T | null) ?? null)"
  >
    <SVirtualList
      :items="flattenItems"
      :item-height="itemHeight"
      :get-item-key="getFlatKey as any"
      item-fixed
      height="100%"
    >
      <template #default="{ item }: { item: any }">
        <TreeItem
          v-slot="{ isExpanded, isSelected }"
          v-bind="item.bind"
          class="group flex items-center gap-2 h-9 my-0.5 mx-2 rounded-lg outline-none cursor-pointer transition-colors duration-150 hover:bg-on-surface/6 active:bg-on-surface/10 data-[selected]:bg-primary/12 data-[selected]:text-primary"
          :style="{ paddingLeft: (item.level - 1) * indent + 8 + 'px', paddingRight: '8px' }"
        >
          <slot
            name="node"
            :node="item.value as T"
            :level="item.level"
            :is-expanded="isExpanded"
            :is-selected="isSelected"
            :has-children="item.hasChildren"
          />
        </TreeItem>
      </template>
    </SVirtualList>
  </TreeRoot>
</template>
