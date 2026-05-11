<script setup lang="ts" generic="T">
export interface SVirtualListExposed {
  wrapperRef: HTMLElement | null;
  /** 实际滚动容器 */
  scrollRef: HTMLElement | null;
  contentRef: HTMLElement | null;
  actualStartIndex: number;
  scrollTo: (top: number, behavior?: ScrollBehavior) => void;
  scrollToIndex: (index: number, behavior?: ScrollBehavior) => void;
  getScrollTop: () => number;
  getItemTop: (index: number) => number;
  getDropInfoByOffset: (offsetY: number) => { index: number; position: "top" | "bottom" };
}

export interface SVirtualListProps<T> {
  /** 列表数据 */
  items: T[];
  /** 每项预估高度（定高模式下为精确高度） */
  itemHeight: number;
  /** 定高模式（跳过 DOM 测量，性能更佳） */
  itemFixed?: boolean;
  /** 容器高度，支持 CSS 值 */
  height?: number | string;
  /** 顶部内边距（px） */
  paddingTop?: number;
  /** 底部内边距（px） */
  paddingBottom?: number;
  /** 上下额外渲染的缓冲项数 */
  bufferSize?: number;
  /** 初始滚动到的索引 */
  defaultScrollIndex?: number;
  /** 获取唯一键 */
  getItemKey?: (item: T, index: number) => string | number;
}

const props = withDefaults(defineProps<SVirtualListProps<T>>(), {
  itemFixed: false,
  height: "100%",
  paddingTop: 0,
  paddingBottom: 0,
  bufferSize: 5,
  getItemKey: (_item: T, index: number) => index,
});

const emit = defineEmits<{
  scroll: [event: Event];
  reachBottom: [];
}>();

const wrapperRef = ref<HTMLElement | null>(null);
const scrollRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const itemRefs = ref<HTMLElement[]>([]);

const scrollTop = ref(0);

// 测量滚动容器高度
const { height: scrollViewportHeight } = useElementSize(scrollRef);

const containerHeightStyle = computed(() =>
  typeof props.height === "number" ? `${props.height}px` : props.height,
);

const viewportHeight = computed(() => scrollViewportHeight.value || 0);

// 每项实际高度、累积顶部位置（仅动态高度模式）
const itemHeights = shallowRef<number[]>([]);
const itemTops = shallowRef<number[]>([]);

/** 初始化高度数组，复用已测量的值 */
const initializeHeights = (): void => {
  if (props.itemFixed) return;
  const length = props.items.length;
  if (itemHeights.value.length !== length) {
    const old = itemHeights.value;
    itemHeights.value = Array.from({ length }, (_, idx) => old[idx] || props.itemHeight);
  }
  updateTops();
};

/** 从指定索引开始重算累积位置 */
const updateTops = (fromIndex = 0): void => {
  if (props.itemFixed) return;
  const heights = itemHeights.value;
  const tops =
    itemTops.value.length === heights.length ? itemTops.value : new Array<number>(heights.length);
  let top = fromIndex > 0 ? tops[fromIndex - 1] + heights[fromIndex - 1] : 0;
  for (let idx = fromIndex; idx < heights.length; idx++) {
    tops[idx] = top;
    top += heights[idx];
  }
  itemTops.value = tops;
};

const totalHeight = computed(() => {
  if (props.itemFixed) {
    return props.items.length * props.itemHeight + props.paddingTop;
  }
  if (itemTops.value.length === 0) return props.paddingTop;
  const last = itemTops.value.length - 1;
  return itemTops.value[last] + itemHeights.value[last] + props.paddingTop;
});

const actualStartIndex = ref(0);
const actualEndIndex = ref(0);

/** 根据滚动位置计算可见范围，动态高度使用二分查找 */
const calculateVisibleRange = (currentScrollTop: number): void => {
  if (props.items.length === 0) {
    actualStartIndex.value = 0;
    actualEndIndex.value = -1;
    return;
  }
  const vHeight = viewportHeight.value;
  if (!vHeight) return;

  // 扣掉顶部 padding 后再换算项索引（itemTops 不含 paddingTop 偏移）
  const effectiveScroll = Math.max(0, currentScrollTop - props.paddingTop);

  let startIndex = 0;
  let endIndex = 0;

  if (props.itemFixed) {
    startIndex = Math.floor(effectiveScroll / props.itemHeight);
    endIndex = startIndex + Math.ceil(vHeight / props.itemHeight);
  } else {
    const tops = itemTops.value;
    const heights = itemHeights.value;
    const len = tops.length;

    let lo = 0;
    let hi = len - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (tops[mid] + heights[mid] > effectiveScroll) {
        startIndex = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    const viewportBottom = effectiveScroll + vHeight;
    lo = startIndex;
    hi = len - 1;
    endIndex = startIndex;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (tops[mid] <= viewportBottom) {
        endIndex = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
  }

  const newStart = Math.max(0, startIndex - props.bufferSize);
  const newEnd = Math.min(props.items.length - 1, endIndex + props.bufferSize);
  if (newStart !== actualStartIndex.value || newEnd !== actualEndIndex.value) {
    actualStartIndex.value = newStart;
    actualEndIndex.value = newEnd;
  }
};

const visibleItems = computed(() => {
  if (actualStartIndex.value > actualEndIndex.value) return [];
  return props.items.slice(actualStartIndex.value, actualEndIndex.value + 1);
});

/** 测量可见项的真实 DOM 高度，允许 0.5px 误差 */
const measureItemHeights = (): void => {
  if (props.itemFixed || !itemRefs.value.length || props.items.length === 0) return;
  let hasChanges = false;
  itemRefs.value.forEach((element, visibleIdx) => {
    if (!element) return;
    const actualIndex = actualStartIndex.value + visibleIdx;
    if (actualIndex < 0 || actualIndex >= props.items.length) return;
    const height = element.getBoundingClientRect().height;
    if (height > 0 && Math.abs(height - itemHeights.value[actualIndex]) > 0.5) {
      itemHeights.value[actualIndex] = height;
      hasChanges = true;
    }
  });
  if (hasChanges) {
    triggerRef(itemHeights);
    updateTops();
  }
};

const debouncedMeasure = useDebounceFn(measureItemHeights, 50);

let rafId: number | null = null;
let pendingScrollTarget: HTMLElement | null = null;

const processScroll = (): void => {
  rafId = null;
  const target = pendingScrollTarget;
  if (!target) return;
  const { scrollTop: st, scrollHeight, clientHeight } = target;
  scrollTop.value = st;
  calculateVisibleRange(st);
  if (scrollHeight - st - clientHeight < 50) {
    emit("reachBottom");
  }
};

const handleScroll = (event: Event): void => {
  const target = event.target as HTMLElement;
  if (!target) return;
  emit("scroll", event);
  pendingScrollTarget = target;
  if (rafId === null) {
    rafId = requestAnimationFrame(processScroll);
  }
};

/** 获取指定索引项的顶部偏移（含 paddingTop） */
const getItemTop = (index: number): number => {
  if (props.itemFixed) return index * props.itemHeight + props.paddingTop;
  return (itemTops.value[index] || 0) + props.paddingTop;
};

/** 根据 Y 轴偏移量计算放置位置（供拖拽排序使用） */
const getDropInfoByOffset = (offsetY: number): { index: number; position: "top" | "bottom" } => {
  const len = props.items.length;
  if (len === 0) return { index: 0, position: "top" };
  // 扣掉 paddingTop，落到 itemTops 坐标系
  const adjusted = offsetY - props.paddingTop;
  if (props.itemFixed) {
    const index = Math.floor(adjusted / props.itemHeight);
    const remainder = ((adjusted % props.itemHeight) + props.itemHeight) % props.itemHeight;
    const position = remainder < props.itemHeight / 2 ? "top" : "bottom";
    return { index: Math.max(0, Math.min(index, len - 1)), position };
  }
  const tops = itemTops.value;
  const heights = itemHeights.value;
  if (adjusted <= 0) return { index: 0, position: "top" };
  if (adjusted >= tops[len - 1] + heights[len - 1]) return { index: len - 1, position: "bottom" };

  let low = 0;
  let high = len - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const top = tops[mid];
    const bottom = top + heights[mid];
    if (adjusted >= top && adjusted < bottom) {
      const position = adjusted - top < heights[mid] / 2 ? "top" : "bottom";
      return { index: mid, position };
    } else if (adjusted < top) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return { index: len - 1, position: "bottom" };
};

/** 滚动到指定像素位置 */
const scrollToPosition = (top: number, behavior: ScrollBehavior = "auto"): void => {
  scrollRef.value?.scrollTo({ top, behavior });
};

/** 滚动到指定索引项 */
const scrollToIndex = (index: number, behavior: ScrollBehavior = "auto"): void => {
  if (props.items.length === 0) return;
  const targetIndex = Math.max(0, Math.min(index, props.items.length - 1));
  let top = 0;
  if (props.itemFixed) {
    top = targetIndex * props.itemHeight + props.paddingTop;
  } else {
    if (itemTops.value.length <= targetIndex) initializeHeights();
    top = (itemTops.value[targetIndex] || 0) + props.paddingTop;
  }
  scrollToPosition(top, behavior);
};

/** 获取当前滚动位置 */
const getScrollTop = (): number => scrollTop.value;

watch(
  () => props.items,
  () => {
    initializeHeights();
    calculateVisibleRange(scrollTop.value);
    nextTick(debouncedMeasure);
  },
  { deep: false },
);

watch(
  () => props.items.length,
  () => {
    initializeHeights();
    calculateVisibleRange(scrollTop.value);
  },
);

watch(viewportHeight, () => {
  calculateVisibleRange(scrollTop.value);
});

watch(
  () => [actualStartIndex.value, actualEndIndex.value],
  () => {
    if (!props.itemFixed) nextTick(debouncedMeasure);
  },
  { flush: "post" },
);

onMounted(() => {
  initializeHeights();
  calculateVisibleRange(0);
  if (props.defaultScrollIndex) scrollToIndex(props.defaultScrollIndex);
  nextTick(() => {
    if (!props.itemFixed) measureItemHeights();
    // 重新计算
    if (viewportHeight.value > 0) calculateVisibleRange(scrollTop.value);
  });
});

/** 滚动位置 */
let savedScrollTop = 0;

onDeactivated(() => {
  savedScrollTop = scrollRef.value?.scrollTop ?? scrollTop.value;
});

/** 恢复滚动位置并重算可见范围 */
onActivated(() => {
  nextTick(() => {
    scrollRef.value?.scrollTo({ top: savedScrollTop });
    scrollTop.value = savedScrollTop;
    calculateVisibleRange(savedScrollTop);
  });
});

onUnmounted(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
});

defineExpose({
  wrapperRef,
  scrollRef,
  contentRef,
  actualStartIndex,
  scrollTo: scrollToPosition,
  scrollToIndex,
  getScrollTop,
  getItemTop,
  getDropInfoByOffset,
});
</script>

<template>
  <div
    ref="wrapperRef"
    class="w-full flex flex-col [overflow-anchor:none] contain-[layout_paint]"
    :style="{ height: containerHeightStyle }"
  >
    <div v-if="items.length === 0 && $slots.empty" class="flex-1 flex items-center justify-center">
      <slot name="empty" />
    </div>
    <template v-else>
      <div v-if="$slots.header" class="shrink-0">
        <slot name="header" />
      </div>
      <div ref="scrollRef" class="flex-1 min-h-0 overflow-y-auto" @scroll="handleScroll">
        <div
          v-show="items.length > 0"
          :style="{
            height: `${totalHeight}px`,
            position: 'relative',
            transition: 'height 0.3s ease',
          }"
        >
          <div ref="contentRef" class="absolute inset-x-0 top-0">
            <div
              v-for="(item, visibleIdx) in visibleItems"
              :key="getItemKey(item, actualStartIndex + visibleIdx)"
              ref="itemRefs"
              :data-index="actualStartIndex + visibleIdx"
              class="absolute inset-x-0 top-0 contain-[layout_paint]"
              :style="{ transform: `translateY(${getItemTop(actualStartIndex + visibleIdx)}px)` }"
            >
              <slot :item="item" :index="actualStartIndex + visibleIdx" />
            </div>
          </div>
        </div>
        <div
          v-if="$slots.footer && items.length > 0"
          class="shrink-0"
          :style="{ paddingBottom: `${paddingBottom}px` }"
        >
          <slot name="footer" />
        </div>
      </div>
    </template>
  </div>
</template>
