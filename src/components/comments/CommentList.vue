<script setup lang="ts">
import type { MusicCommentItem } from "@shared/types/comment";
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
  /** 列间距（px） */
  gap?: number;
}

const props = withDefaults(defineProps<Props>(), {
  columnMinWidth: 280,
  creatorIds: () => new Set<string>(),
  compact: false,
  gap: 12,
});

const gridStyle = computed(() => ({
  display: "grid",
  gridTemplateColumns: `repeat(auto-fill, minmax(${props.columnMinWidth}px, 1fr))`,
  gap: `${props.gap}px`,
}));
</script>

<template>
  <div :style="gridStyle">
    <CommentCard
      v-for="item in items"
      :key="item.id"
      :item="item"
      :creator="creatorIds.has(item.id)"
      :compact="compact"
    />
  </div>
</template>
