<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import type { SVirtualListExposed } from "@/components/ui/SVirtualList.vue";
import artistFallback from "@/assets/images/artist.jpg";

export interface CoverListProps {
  /** 列表数据 */
  items: CoverItem[];
  /** 列表类型 */
  type?: "default" | "artist";
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
}

const props = withDefaults(defineProps<CoverListProps>(), {
  type: "default",
  minSize: 140,
  gap: 20,
  rounded: "rounded-xl",
  paddingX: 0,
  paddingTop: 0,
  paddingBottom: 0,
});

const coverRounded = computed(() => {
  if (props.type === "artist") return "rounded-full";
  return props.rounded;
});

const actualFallback = computed(() => {
  if (props.type === "artist") return artistFallback;
  return props.fallback;
});

const emit = defineEmits<{
  click: [item: CoverItem];
  reachBottom: [];
}>();

const virtualListRef = ref<SVirtualListExposed | null>(null);
const scrollEl = computed(() => virtualListRef.value?.scrollRef ?? null);
const { width: scrollWidth } = useElementSize(scrollEl);

/** 实际可用网格宽度 = scrollEl 内容宽度 − 左右 padding */
const innerWidth = computed(() => Math.max(0, scrollWidth.value - props.paddingX * 2));

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
  <SVirtualList
    ref="virtualListRef"
    :items="rows"
    :item-height="rowHeight"
    item-fixed
    :get-item-key="getRowKey"
    :padding-top="paddingTop"
    :padding-bottom="paddingBottom"
    height="100%"
    @reach-bottom="emit('reachBottom')"
  >
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
        <div
          v-for="item in row.items"
          :key="item.id"
          class="cursor-pointer group rounded-xl transition-colors duration-300"
          :class="type !== 'artist' ? 'hover:bg-primary/10' : ''"
          @click="emit('click', item)"
        >
          <!-- 封面 -->
          <div
            class="relative overflow-hidden group-hover:will-change-transform"
            :class="coverRounded"
          >
            <SImg
              :src="item.cover"
              :fallback="actualFallback"
              :alt="item.title"
              class="w-full aspect-square transition-[transform,filter] duration-300 ease-out group-hover:scale-108 group-hover:brightness-80"
            />
            <!-- 播放按钮 -->
            <div
              class="absolute size-9 flex items-center justify-center rounded-full opacity-0 transition-[opacity,transform] duration-300 group-hover:opacity-100"
              :class="
                type === 'artist'
                  ? 'inset-0 m-auto'
                  : 'right-2 bottom-2 bg-white/50 translate-y-1.5 group-hover:translate-y-0'
              "
            >
              <IconLucidePlay v-if="type !== 'artist'" class="size-4.5 text-white" />
              <IconLucideUser v-else class="size-8 text-white" />
            </div>
          </div>
          <!-- 信息 -->
          <div
            class="flex flex-col gap-0.5 px-2.5 py-2.5"
            :class="type === 'artist' ? 'items-center' : ''"
          >
            <div
              class="text-sm text-on-surface line-clamp-2 leading-snug"
              :class="type === 'artist' ? 'text-center w-full' : ''"
            >
              {{ item.title }}
            </div>
            <div
              v-if="item.subtitle"
              class="text-xs text-on-surface-variant/50 truncate"
              :class="type === 'artist' ? 'text-center w-full' : ''"
            >
              {{ item.subtitle }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </SVirtualList>
</template>
