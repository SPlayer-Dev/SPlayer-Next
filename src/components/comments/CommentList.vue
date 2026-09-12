<script setup lang="ts">
import type { MusicCommentItem } from "@shared/types/comment";
import { getMasonryRowSpan } from "@/utils/commentMasonry";
import CommentCard from "./CommentCard.vue";

interface Props {
  /** 评论列表 */
  items: MusicCommentItem[];
  /** 最小列宽（px），容器更宽时自动增加列数 */
  columnMinWidth?: number;
  /** 主创评论 id 集合，命中时卡片显示主创徽章 */
  creatorIds?: Set<string>;
  /** 紧凑模式透传给 CommentCard */
  compact?: boolean;
  /** 是否使用全屏播放器配色 */
  cover?: boolean;
  /** 列间距（px） */
  gap?: number;
}

const props = withDefaults(defineProps<Props>(), {
  columnMinWidth: 280,
  creatorIds: () => new Set<string>(),
  compact: false,
  cover: false,
  gap: 12,
});

const GRID_ROW_HEIGHT = 1;
const itemElements = new Map<string, HTMLElement>();
const rowSpans = reactive(new Map<string, number>());
let resizeObserver: ResizeObserver | undefined;

const gridStyle = computed(() => ({
  display: "grid",
  gridTemplateColumns: `repeat(auto-fill, minmax(${props.columnMinWidth}px, 1fr))`,
  gridAutoRows: `${GRID_ROW_HEIGHT}px`,
  gap: `${props.gap}px`,
}));

const updateItemSpan = (id: string, element: HTMLElement): void => {
  const content = element.firstElementChild;
  if (!(content instanceof HTMLElement)) return;
  rowSpans.set(
    id,
    getMasonryRowSpan(content.getBoundingClientRect().height, GRID_ROW_HEIGHT, props.gap),
  );
};

const updateAllSpans = (): void => {
  for (const [id, element] of itemElements) updateItemSpan(id, element);
};

const setItemRef = (id: string, value: unknown): void => {
  const element = value instanceof HTMLElement ? value : null;
  const previous = itemElements.get(id);
  if (previous && previous !== element) {
    const previousContent = previous.firstElementChild;
    if (previousContent) resizeObserver?.unobserve(previousContent);
  }
  if (!element) {
    itemElements.delete(id);
    rowSpans.delete(id);
    return;
  }
  itemElements.set(id, element);
  const content = element.firstElementChild;
  if (content) resizeObserver?.observe(content);
  updateItemSpan(id, element);
};

watch(
  () => [props.items, props.gap] as const,
  async ([items]) => {
    const ids = new Set(items.map((item) => item.id));
    for (const id of rowSpans.keys()) {
      if (!ids.has(id)) rowSpans.delete(id);
    }
    await nextTick();
    updateAllSpans();
  },
  { deep: true },
);

onMounted(() => {
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const wrapper = entry.target.parentElement;
      const id = wrapper?.getAttribute("data-comment-id");
      if (id && wrapper) updateItemSpan(id, wrapper);
    }
  });
  for (const element of itemElements.values()) {
    const content = element.firstElementChild;
    if (content) resizeObserver.observe(content);
  }
  updateAllSpans();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  itemElements.clear();
  rowSpans.clear();
});
</script>

<template>
  <div :style="gridStyle">
    <div
      v-for="item in items"
      :key="item.id"
      :ref="(value) => setItemRef(item.id, value)"
      :data-comment-id="item.id"
      :style="{ gridRowEnd: `span ${rowSpans.get(item.id) ?? 1}` }"
    >
      <CommentCard
        :item="item"
        :creator="creatorIds.has(item.id)"
        :compact="compact"
        :cover="cover"
      />
    </div>
  </div>
</template>
