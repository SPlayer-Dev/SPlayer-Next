<script setup lang="ts" generic="T extends object">
import { TreeRoot, TreeItem } from "reka-ui";

/** reka-ui 内部节点类型；T 通过 unknown 桥接，避免在外部签名里出现 any */
type RekaNode = Record<string, unknown>;

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
  }>(),
  {
    indent: 16,
    getChildren: ((node: { children?: unknown[] }) => node.children) as never,
    expanded: undefined,
    modelValue: undefined,
  },
);

const emit = defineEmits<{
  "update:expanded": [keys: string[]];
  "update:modelValue": [value: T | null];
}>();
</script>

<template>
  <TreeRoot
    v-slot="{ flattenItems }"
    :items="(items as unknown as RekaNode[])"
    :get-key="(getKey as unknown as (val: RekaNode) => string)"
    :get-children="(getChildren as unknown as (val: RekaNode) => RekaNode[] | undefined)"
    :expanded="expanded"
    :model-value="(modelValue as unknown as RekaNode | undefined)"
    selection-behavior="replace"
    class="list-none m-0 p-0 select-none"
    @update:expanded="emit('update:expanded', $event)"
    @update:model-value="emit('update:modelValue', ($event as unknown as T | null) ?? null)"
  >
    <TreeItem
      v-for="item in flattenItems"
      :key="item._id"
      v-slot="{ isExpanded, isSelected }"
      v-bind="item.bind"
      class="group flex items-center gap-2 h-9 my-0.5 rounded-lg outline-none cursor-pointer transition-colors duration-150 hover:bg-on-surface/6 active:bg-on-surface/10 data-[selected]:bg-primary/12 data-[selected]:text-primary"
      :style="{ paddingLeft: (item.level - 1) * indent + 8 + 'px', paddingRight: '8px' }"
    >
      <slot
        name="node"
        :node="(item.value as unknown as T)"
        :level="item.level"
        :is-expanded="isExpanded"
        :is-selected="isSelected"
        :has-children="item.hasChildren"
      />
    </TreeItem>
  </TreeRoot>
</template>
