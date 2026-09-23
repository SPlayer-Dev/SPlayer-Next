<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import type { SVirtualListExposed } from "@/components/ui/SVirtualList.vue";
import { useFloatingPlayerBar } from "@/composables/useFloatingPlayerBar";

export interface CoverListProps {
  /** 列表数据 */
  items: CoverItem[];
  /** 列表类型 */
  type?: "default" | "artist";
  /** 是否虚拟滚动 */
  virtual?: boolean;
  /** 单项最小宽度（px） */
  minSize?: number;
  /** 项间距（px） */
  gap?: number;
  /** 封面圆角 class */
  rounded?: string;
  /** 封面占位图 */
  fallback?: string;
  /** 横向 padding（px） */
  paddingX?: number;
  /** 顶部 padding（px） */
  paddingTop?: number;
  /** 底部 padding（px） */
  paddingBottom?: number;
  /** 是否还能继续触底加载 */
  hasMore?: boolean;
  /** 触底加载中 */
  loadingMore?: boolean;
}

const props = withDefaults(defineProps<CoverListProps>(), {
  type: "default",
  virtual: true,
  minSize: 140,
  gap: 20,
  rounded: "rounded-xl",
  paddingX: 0,
  paddingTop: 0,
  paddingBottom: 0,
  hasMore: false,
  loadingMore: false,
});

const { t } = useI18n();

const { isFloatingBar, PLAYER_BAR_GAP } = useFloatingPlayerBar();

/** 虚拟模式底部 padding：悬浮播放栏下留白避免遮挡 */
const virtualPaddingBottom = computed(() =>
  isFloatingBar.value ? PLAYER_BAR_GAP : props.paddingBottom,
);

const emit = defineEmits<{
  click: [item: CoverItem];
  reachBottom: [];
}>();

const virtualListRef = ref<SVirtualListExposed | null>(null);
const scrollEl = computed(() => virtualListRef.value?.scrollRef ?? null);
const { width: scrollWidth } = useElementSize(scrollEl);
let lastValidWidth = 0;

/** 实际可用网格宽度 = scrollEl 内容宽度 − 左右 padding */
const innerWidth = computed(() => {
  if (scrollWidth.value > 0) {
    lastValidWidth = scrollWidth.value;
  }
  const w = scrollWidth.value > 0 ? scrollWidth.value : lastValidWidth;
  return Math.max(0, w - props.paddingX * 2);
});

/** 信息区固定高度估算：标题 line-clamp-2 + 可选 subtitle + 上下 padding */
const INFO_HEIGHT = 76;

/** CSS auto-fill 等价计算：列数 = floor((W + G) / (M + G)) */
const columnCount = computed(() => {
  if (!innerWidth.value) return 1;
  return Math.max(1, Math.floor((innerWidth.value + props.gap) / (props.minSize + props.gap)));
});

/** 单列实际宽度 */
const colWidth = computed(() => {
  if (!innerWidth.value) return props.minSize;
  return (innerWidth.value - (columnCount.value - 1) * props.gap) / columnCount.value;
});

/** 行高 = 封面方形（aspect-square = colWidth）+ 信息区 + 行间距 */
const rowHeight = computed(() => colWidth.value + INFO_HEIGHT + props.gap);

interface Row {
  id: string;
  items: CoverItem[];
}

/** 把 items 按列数切成行 */
const rows = computed<Row[]>(() => {
  const cols = columnCount.value;
  if (cols <= 0 || props.items.length === 0) return [];
  const out: Row[] = [];
  for (let i = 0; i < props.items.length; i += cols) {
    const slice = props.items.slice(i, i + cols);
    out.push({ id: slice[0]?.id ?? `__pad_${i}`, items: slice });
  }
  return out;
});

const getRowKey = (row: Row): string => row.id;
</script>

<template>
  <!-- 虚拟滚动 -->
  <SVirtualList
    v-if="virtual"
    ref="virtualListRef"
    :items="rows"
    :item-height="rowHeight"
    item-fixed
    :get-item-key="getRowKey"
    :padding-top="paddingTop"
    :padding-bottom="virtualPaddingBottom"
    height="100%"
    @reach-bottom="emit('reachBottom')"
  >
    <template #footer>
      <div
        v-if="rows.length > 0 && loadingMore"
        class="py-3 flex items-center justify-center gap-2 text-sm text-on-surface-variant/50"
      >
        <SLoading class="size-3.5 text-primary/70 shrink-0" />
        <span>{{ t("common.loading") }}</span>
      </div>
      <div
        v-else-if="rows.length > 0 && !hasMore"
        class="py-3 text-center text-sm text-on-surface-variant/40"
      >
        {{ t("common.noMore") }}
      </div>
    </template>
    <template #default="{ item: row }: { item: Row }">
      <div
        class="grid"
        :style="{
          paddingLeft: `${paddingX}px`,
          paddingRight: `${paddingX}px`,
          gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
          gap: `${gap}px`,
        }"
      >
        <CoverCard
          v-for="item in row.items"
          :key="item.id"
          :item="item"
          :type="type"
          :rounded="rounded"
          :fallback="fallback"
          @click="emit('click', item)"
        />
      </div>
    </template>
  </SVirtualList>
  <!-- 普通网格 -->
  <div
    v-else
    class="grid"
    :style="{
      padding: `${paddingTop}px ${paddingX}px ${paddingBottom}px`,
      gridTemplateColumns: `repeat(auto-fill, minmax(${minSize}px, 1fr))`,
      gap: `${gap}px`,
    }"
  >
    <CoverCard
      v-for="item in items"
      :key="item.id"
      :item="item"
      :type="type"
      :rounded="rounded"
      :fallback="fallback"
      @click="emit('click', item)"
    />
  </div>
</template>
