<script setup lang="ts">
import type { MusicCommentItem } from "@shared/types/comment";
import type { CommentDensity } from "@shared/types/settings";
import { layoutMasonry } from "@/utils/commentMasonry";
import CommentCard from "./CommentCard.vue";

interface Props {
  /** 评论列表 */
  items: MusicCommentItem[];
  /** 最小列宽（px），容器更宽时自动增加列数 */
  columnMinWidth?: number;
  /** 主创评论 id 集合，命中时卡片显示主创徽章 */
  creatorIds?: Set<string>;
  /** 评论卡片密度 */
  density?: CommentDensity;
  /** 是否使用全屏播放器配色 */
  cover?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  columnMinWidth: 280,
  creatorIds: () => new Set<string>(),
  density: "standard",
  cover: false,
});

const GAPS: Record<CommentDensity, number> = { compact: 8, standard: 12, comfortable: 16 };
const gap = computed(() => GAPS[props.density]);

const rootRef = ref<HTMLElement | null>(null);
const itemElements = new Map<string, HTMLElement>();
const positions = reactive(new Map<string, { x: number; y: number }>());
const columnWidth = ref(0);
const containerHeight = ref(0);

let resizeObserver: ResizeObserver | undefined;
let rootObserver: ResizeObserver | undefined;
let layoutFrame = 0;
let layoutToken = 0;

/** 合并同一帧内的多次布局请求 */
const scheduleLayout = (): void => {
  if (layoutFrame) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0;
    void runLayout();
  });
};

/**
 * 测量卡片高度并重新计算绝对位置
 * 列宽变化时先等待 DOM 更新，确保按新宽度测量换行后的高度
 */
const runLayout = async (): Promise<void> => {
  const root = rootRef.value;
  if (!root) return;
  const width = root.clientWidth;
  if (width <= 0) return;

  const token = ++layoutToken;
  const gapValue = gap.value;
  const columns = Math.max(1, Math.floor((width + gapValue) / (props.columnMinWidth + gapValue)));
  const nextColumnWidth = (width - gapValue * (columns - 1)) / columns;
  if (nextColumnWidth !== columnWidth.value) {
    columnWidth.value = nextColumnWidth;
    await nextTick();
    if (token !== layoutToken) return;
  }

  const heights = props.items.map((item) => {
    const element = itemElements.get(item.id);
    return element ? element.getBoundingClientRect().height : 0;
  });
  const layout = layoutMasonry(heights, columns, nextColumnWidth, gapValue);

  positions.clear();
  props.items.forEach((item, index) => {
    const position = layout.positions[index];
    if (position) positions.set(item.id, position);
  });
  containerHeight.value = layout.height;
};

/**
 * 记录卡片元素引用并触发重新布局
 * @param id - 评论 id
 * @param value - 模板 ref 值
 */
const setItemRef = (id: string, value: unknown): void => {
  const element = value instanceof HTMLElement ? value : null;
  const previous = itemElements.get(id);
  if (previous === element) return;
  if (previous) {
    const content = previous.firstElementChild;
    if (content) resizeObserver?.unobserve(content);
    itemElements.delete(id);
  }
  if (!element) {
    positions.delete(id);
    scheduleLayout();
    return;
  }
  itemElements.set(id, element);
  const content = element.firstElementChild;
  if (content) resizeObserver?.observe(content);
  scheduleLayout();
};

// 列表变化后清理已移除的卡片并重新排布
watch(
  () => props.items,
  (items) => {
    const ids = new Set(items.map((item) => item.id));
    for (const id of positions.keys()) {
      if (!ids.has(id)) positions.delete(id);
    }
    scheduleLayout();
  },
  { flush: "post" },
);

// 密度或最小列宽变化会改变卡片尺寸与列数，DOM 更新后重新测量
watch([gap, () => props.columnMinWidth], scheduleLayout, { flush: "post" });

onMounted(() => {
  resizeObserver = new ResizeObserver(() => scheduleLayout());
  for (const element of itemElements.values()) {
    const content = element.firstElementChild;
    if (content) resizeObserver.observe(content);
  }

  let lastWidth = 0;
  rootObserver = new ResizeObserver(([entry]) => {
    if (!entry || Math.abs(entry.contentRect.width - lastWidth) < 0.5) return;
    lastWidth = entry.contentRect.width;
    scheduleLayout();
  });
  if (rootRef.value) {
    lastWidth = rootRef.value.clientWidth;
    rootObserver.observe(rootRef.value);
  }
  scheduleLayout();
});

onBeforeUnmount(() => {
  layoutToken += 1;
  cancelAnimationFrame(layoutFrame);
  resizeObserver?.disconnect();
  rootObserver?.disconnect();
  itemElements.clear();
  positions.clear();
});
</script>

<template>
  <div ref="rootRef" class="relative w-full" :style="{ height: `${containerHeight}px` }">
    <div
      v-for="item in items"
      :key="item.id"
      :ref="(value) => setItemRef(item.id, value)"
      class="absolute"
      :style="{
        left: `${positions.get(item.id)?.x ?? 0}px`,
        top: `${positions.get(item.id)?.y ?? 0}px`,
        width: `${columnWidth}px`,
        visibility: positions.has(item.id) ? 'visible' : 'hidden',
      }"
    >
      <CommentCard
        :item="item"
        :creator="creatorIds.has(item.id)"
        :density="density"
        :cover="cover"
      />
    </div>
  </div>
</template>
