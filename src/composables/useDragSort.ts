import type { ComputedRef, Ref } from "vue";
import type { SVirtualListExposed } from "@/components/ui/SVirtualList.vue";

export interface DragSortOptions {
  /** SVirtualList 组件实例引用 */
  virtualListRef: Ref<SVirtualListExposed | null>;
  /** 列表项总数 */
  itemCount: ComputedRef<number>;
  /** 排序完成回调 */
  onReorder: (fromIndex: number, toIndex: number) => void;
  /** 滚动区域顶部内边距 */
  paddingTop?: number;
  /** 触发模式: handle（手柄点击立即触发）| longpress（长按触发） */
  triggerMode?: "handle" | "longpress";
  /** 长按延迟毫秒数，默认 300 */
  longPressDelay?: number;
}

/**
 * 列表拖拽排序 composable，配合 SVirtualList 使用
 * 支持手柄触发和长按触发两种模式，拖拽时自动滚动
 */
export const useDragSort = (options: DragSortOptions) => {
  const {
    virtualListRef,
    itemCount,
    onReorder,
    paddingTop = 0,
    triggerMode = "handle",
    longPressDelay = 300,
  } = options;

  const isDragging = ref(false);
  const draggedIndex = ref(-1);
  const targetIndex = ref(-1);
  const dropIndicator = reactive({ index: -1, position: "none" as string });
  const dragLabelData = ref<{ name: string } | null>(null);
  const dragLabelPosition = reactive({ top: 0, left: 0 });
  let listRect: DOMRect | null = null;
  let autoScrollRafId: number | null = null;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingIndex = -1;
  let pendingLabelText = "";
  let pointerStartX = 0;
  let pointerStartY = 0;
  const MOVE_THRESHOLD = 5;

  /** 从鼠标或触摸事件中提取坐标 */
  const getPointerPos = (event: MouseEvent | TouchEvent) => {
    if ("touches" in event && event.touches.length > 0) {
      return { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }
    return { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
  };

  /** 激活拖拽，绑定移动和释放监听 */
  const activateDrag = (event: MouseEvent | TouchEvent, index: number, labelText: string) => {
    if (event.cancelable) event.preventDefault();
    isDragging.value = true;
    draggedIndex.value = index;
    targetIndex.value = index;
    dragLabelData.value = { name: labelText };
    const wrapper = virtualListRef.value?.wrapperRef;
    if (wrapper) listRect = wrapper.getBoundingClientRect();
    updateDragLabelPosition(event);
    window.addEventListener("mousemove", handleDragMove);
    window.addEventListener("touchmove", handleDragMove, { passive: false });
    window.addEventListener("mouseup", handleDragEnd);
    window.addEventListener("touchend", handleDragEnd);
  };

  /** 处理拖拽移动，更新标签位置并计算目标索引 */
  const handleDragMove = (event: MouseEvent | TouchEvent) => {
    if (!isDragging.value) return;
    if (event.cancelable) event.preventDefault();
    updateDragLabelPosition(event);
    const wrapper = virtualListRef.value?.wrapperRef;
    if (wrapper) listRect = wrapper.getBoundingClientRect();
    if (!listRect) return;
    const { y: clientY } = getPointerPos(event);
    handleAutoScroll(clientY, listRect);
    calculateTargetIndex(clientY);
  };

  /** 处理拖拽释放，触发排序回调 */
  const handleDragEnd = () => {
    if (draggedIndex.value !== targetIndex.value && targetIndex.value !== -1) {
      onReorder(draggedIndex.value, targetIndex.value);
    }
    cleanupDragState();
  };

  /** 重置所有拖拽状态并移除事件监听 */
  const cleanupDragState = () => {
    stopAutoScroll();
    cancelLongPress();
    isDragging.value = false;
    draggedIndex.value = -1;
    targetIndex.value = -1;
    dropIndicator.index = -1;
    dropIndicator.position = "none";
    dragLabelData.value = null;
    window.removeEventListener("mousemove", handleDragMove);
    window.removeEventListener("touchmove", handleDragMove);
    window.removeEventListener("mouseup", handleDragEnd);
    window.removeEventListener("touchend", handleDragEnd);
    window.removeEventListener("mousemove", handleLongPressMove);
    window.removeEventListener("touchmove", handleLongPressMove);
    window.removeEventListener("mouseup", handleLongPressCancel);
    window.removeEventListener("touchend", handleLongPressCancel);
  };

  /** 根据指针 Y 坐标计算放置目标索引和指示线位置 */
  const calculateTargetIndex = (clientY: number, overrideScrollTop?: number) => {
    if (!listRect || !virtualListRef.value) return;
    const currentScrollTop = overrideScrollTop ?? virtualListRef.value.getScrollTop();
    const relativeY = clientY - listRect.top + currentScrollTop - paddingTop;
    const dropInfo = virtualListRef.value.getDropInfoByOffset(relativeY);
    let gapIndex = dropInfo.index;
    if (dropInfo.position === "bottom") gapIndex += 1;
    const maxGap = itemCount.value;
    gapIndex = Math.max(0, Math.min(gapIndex, maxGap));
    if (gapIndex === maxGap) {
      dropIndicator.index = maxGap - 1;
      dropIndicator.position = "bottom";
    } else {
      dropIndicator.index = gapIndex;
      dropIndicator.position = "top";
    }
    let insertIndex = draggedIndex.value;
    if (draggedIndex.value < gapIndex) {
      insertIndex = gapIndex - 1;
    } else if (draggedIndex.value > gapIndex) {
      insertIndex = gapIndex;
    }
    targetIndex.value = Math.max(0, Math.min(insertIndex, maxGap - 1));
  };

  /** 更新拖拽标签跟随指针位置 */
  const updateDragLabelPosition = (event: MouseEvent | TouchEvent) => {
    const { x, y } = getPointerPos(event);
    dragLabelPosition.left = x;
    dragLabelPosition.top = y;
  };

  /** 检测指针是否靠近列表边缘，触发或停止自动滚动 */
  const handleAutoScroll = (clientY: number, rect: DOMRect) => {
    const edgeThreshold = 40;
    const scrollSpeed = 12;
    if (clientY < rect.top + edgeThreshold) {
      startAutoScroll(-scrollSpeed);
    } else if (clientY > rect.bottom - edgeThreshold) {
      startAutoScroll(scrollSpeed);
    } else {
      stopAutoScroll();
    }
  };

  /** 启动 RAF 驱动的自动滚动循环 */
  const startAutoScroll = (amount: number) => {
    if (autoScrollRafId !== null) return;
    let expectedScroll = virtualListRef.value?.getScrollTop() || 0;
    const scrollStep = () => {
      if (!isDragging.value) return stopAutoScroll();
      const actualScroll = virtualListRef.value?.getScrollTop() || 0;
      if (Math.abs(actualScroll - expectedScroll) > Math.abs(amount) * 3) {
        expectedScroll = actualScroll;
      }
      expectedScroll = Math.max(0, expectedScroll + amount);
      virtualListRef.value?.scrollTo(expectedScroll, "auto");
      const wrapper = virtualListRef.value?.wrapperRef;
      if (wrapper) listRect = wrapper.getBoundingClientRect();
      calculateTargetIndex(dragLabelPosition.top, expectedScroll);
      autoScrollRafId = requestAnimationFrame(scrollStep);
    };
    autoScrollRafId = requestAnimationFrame(scrollStep);
  };

  /** 停止自动滚动 */
  const stopAutoScroll = () => {
    if (autoScrollRafId !== null) {
      cancelAnimationFrame(autoScrollRafId);
      autoScrollRafId = null;
    }
  };

  /** 取消长按计时器 */
  const cancelLongPress = () => {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  /** 长按等待期间检测手指移动，超过阈值则取消 */
  const handleLongPressMove = (event: MouseEvent | TouchEvent) => {
    const { x, y } = getPointerPos(event);
    if (Math.sqrt((x - pointerStartX) ** 2 + (y - pointerStartY) ** 2) > MOVE_THRESHOLD) {
      cancelLongPress();
      window.removeEventListener("mousemove", handleLongPressMove);
      window.removeEventListener("touchmove", handleLongPressMove);
      window.removeEventListener("mouseup", handleLongPressCancel);
      window.removeEventListener("touchend", handleLongPressCancel);
    }
  };

  /** 长按等待期间释放指针，取消长按 */
  const handleLongPressCancel = () => {
    cancelLongPress();
    window.removeEventListener("mousemove", handleLongPressMove);
    window.removeEventListener("touchmove", handleLongPressMove);
    window.removeEventListener("mouseup", handleLongPressCancel);
    window.removeEventListener("touchend", handleLongPressCancel);
  };

  /** 统一入口：handle 模式立即激活，longpress 模式延迟激活 */
  const handlePointerDown = (event: MouseEvent | TouchEvent, index: number, labelText: string) => {
    if (triggerMode === "handle") {
      activateDrag(event, index, labelText);
      return;
    }
    const { x, y } = getPointerPos(event);
    pointerStartX = x;
    pointerStartY = y;
    pendingIndex = index;
    pendingLabelText = labelText;
    cancelLongPress();
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      navigator.vibrate?.(50);
      activateDrag(event, pendingIndex, pendingLabelText);
      window.removeEventListener("mousemove", handleLongPressMove);
      window.removeEventListener("touchmove", handleLongPressMove);
      window.removeEventListener("mouseup", handleLongPressCancel);
      window.removeEventListener("touchend", handleLongPressCancel);
    }, longPressDelay);
    window.addEventListener("mousemove", handleLongPressMove);
    window.addEventListener("touchmove", handleLongPressMove, { passive: false });
    window.addEventListener("mouseup", handleLongPressCancel);
    window.addEventListener("touchend", handleLongPressCancel);
  };

  onUnmounted(() => {
    cleanupDragState();
  });

  return {
    isDragging,
    draggedIndex,
    dropIndicator,
    dragLabelData,
    dragLabelPosition,
    handlePointerDown,
    cleanupDragState,
  };
};
