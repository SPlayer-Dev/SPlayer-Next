import type { Ref } from "vue";

/** 可拖拽的歌单项 */
export interface SidebarDragItem {
  key: string;
  label: string;
}

/** 一个可独立排序的歌单分组 */
export interface SidebarDragGroup {
  /** 该组当前可见的歌单项（按显示顺序） */
  items: SidebarDragItem[];
  /** 拖放结束后提交新的 key 顺序 */
  commit: (keys: string[]) => void;
}

export interface SidebarDragOptions {
  /** 滚动容器元素引用 */
  containerRef: Ref<HTMLElement | null>;
  /** 获取当前可拖拽的分组（我的歌单 / 收藏的歌单） */
  getGroups: () => SidebarDragGroup[];
  /** 是否允许拖拽（折叠态等场景禁用） */
  enabled?: () => boolean;
  /** 长按触发毫秒数，默认 300 */
  longPressDelay?: number;
}

/** 拖拽时插入指示线的视口定位 */
interface DropLineStyle {
  top: number;
  left: number;
  width: number;
}

/** 歌单行的视口矩形 */
interface RowRect {
  top: number;
  bottom: number;
  centerY: number;
}

/**
 * 侧边栏歌单长按拖拽排序
 * 基于 DOM 矩形计算落点，不依赖虚拟列表，适配 SMenu 混合渲染结构
 */
export const useSidebarPlaylistDrag = (options: SidebarDragOptions) => {
  const { containerRef, getGroups, enabled = () => true, longPressDelay = 300 } = options;

  const isDragging = ref(false);
  const dragLabel = ref<SidebarDragItem | null>(null);
  const labelPos = reactive({ top: 0, left: 0 });
  const lineStyle = ref<DropLineStyle | null>(null);

  /** 指示线左右内缩，避免贴边 */
  const LINE_INSET = 12;
  /** 触发自动滚动的边缘高度 */
  const EDGE = 48;
  /** 长按等待期内的位移阈值，超过则取消 */
  const MOVE_THRESHOLD = 6;

  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let activeGroup: SidebarDragGroup | null = null;
  let draggedIndex = -1;
  let targetIndex = -1;
  let startX = 0;
  let startY = 0;
  /** 本次手势是否发生过拖拽，用于抑制松手后的点击跳转 */
  let draggedThisGesture = false;

  /** 查询分组内各歌单行的当前视口矩形 */
  const collectRows = (): RowRect[] => {
    const container = containerRef.value;
    if (!container || !activeGroup) return [];
    const rows: RowRect[] = [];
    for (const item of activeGroup.items) {
      const el = container.querySelector<HTMLElement>(`[data-menu-key="${item.key}"]`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      rows.push({ top: rect.top, bottom: rect.bottom, centerY: rect.top + rect.height / 2 });
    }
    return rows;
  };

  /** 根据指针 Y 计算落点索引并更新插入线位置 */
  const updateDrop = (clientY: number, containerRect: DOMRect) => {
    const rows = collectRows();
    if (rows.length === 0) return;
    let gap = rows.length;
    for (let i = 0; i < rows.length; i++) {
      if (clientY < rows[i].centerY) {
        gap = i;
        break;
      }
    }
    const lineTop = gap < rows.length ? rows[gap].top : rows[rows.length - 1].bottom;
    lineStyle.value = {
      top: lineTop - 1,
      left: containerRect.left + LINE_INSET,
      width: Math.max(0, containerRect.width - LINE_INSET * 2),
    };
    targetIndex = gap > draggedIndex ? gap - 1 : gap;
  };

  /** 拖拽移动：跟随指针更新标签、边缘自动滚动与落点 */
  const handleMove = (event: PointerEvent) => {
    const container = containerRef.value;
    if (!container) return;
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const { clientX, clientY } = event;
    labelPos.top = clientY;
    labelPos.left = clientX;
    if (clientY < rect.top + EDGE)
      container.scrollTop -= Math.max(2, rect.top + EDGE - clientY) / 3;
    else if (clientY > rect.bottom - EDGE)
      container.scrollTop += Math.max(2, clientY - (rect.bottom - EDGE)) / 3;
    updateDrop(clientY, rect);
  };

  /** 复位拖拽相关状态 */
  const resetDragState = (): void => {
    isDragging.value = false;
    dragLabel.value = null;
    lineStyle.value = null;
    activeGroup = null;
    draggedIndex = -1;
    targetIndex = -1;
  };

  /** 移除拖拽阶段监听 */
  const cleanupDragListeners = (): void => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleEnd);
    window.removeEventListener("pointercancel", handleEnd);
    window.removeEventListener("keydown", handleKeyDown);
  };

  /** 拖拽中按 Esc 取消，不落库 */
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    cleanupDragListeners();
    resetDragState();
  };

  /** 松手：落点有效则提交新顺序，并复位拖拽状态 */
  const handleEnd = (): void => {
    cleanupDragListeners();
    if (targetIndex !== -1 && targetIndex !== draggedIndex && activeGroup) {
      const keys = activeGroup.items.map((item) => item.key);
      const [moved] = keys.splice(draggedIndex, 1);
      keys.splice(targetIndex, 0, moved);
      activeGroup.commit(keys);
    }
    resetDragState();
  };

  /** 长按计时到，激活拖拽 */
  const activate = (group: SidebarDragGroup, item: SidebarDragItem, index: number): void => {
    cancelLongPress();
    cleanupPendingListeners();
    activeGroup = group;
    draggedIndex = index;
    targetIndex = index;
    draggedThisGesture = true;
    isDragging.value = true;
    dragLabel.value = item;
    const container = containerRef.value;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    labelPos.top = startY;
    labelPos.left = startX;
    updateDrop(startY, rect);
    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
    window.addEventListener("keydown", handleKeyDown);
  };

  /** 清除长按计时器 */
  const cancelLongPress = (): void => {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  /** 长按等待期移动超阈值则取消 */
  const handlePendingMove = (event: PointerEvent): void => {
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_THRESHOLD) {
      cancelLongPress();
      cleanupPendingListeners();
    }
  };

  /** 长按等待期松手则取消 */
  const handlePendingUp = (): void => {
    cancelLongPress();
    cleanupPendingListeners();
  };

  /** 移除长按阶段监听 */
  const cleanupPendingListeners = (): void => {
    window.removeEventListener("pointermove", handlePendingMove);
    window.removeEventListener("pointerup", handlePendingUp);
    window.removeEventListener("pointercancel", handlePendingUp);
  };

  /**
   * 容器级 pointerdown 入口：命中歌单行则进入长按等待
   * @param event - 指针事件
   */
  const onPointerDown = (event: PointerEvent): void => {
    draggedThisGesture = false;
    if (event.button !== 0) return;
    if (!enabled()) return;
    const container = containerRef.value;
    if (!container) return;
    const rowEl = (event.target as HTMLElement).closest<HTMLElement>("[data-menu-key]");
    const key = rowEl?.getAttribute("data-menu-key") ?? "";
    if (!key.startsWith("/collection/")) return;
    const group = getGroups().find((g) => g.items.some((item) => item.key === key));
    if (!group) return;
    const item = group.items.find((it) => it.key === key);
    if (!item) return;
    startX = event.clientX;
    startY = event.clientY;
    const index = group.items.findIndex((it) => it.key === key);
    cancelLongPress();
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      navigator.vibrate?.(50);
      activate(group, item, index);
    }, longPressDelay);
    window.addEventListener("pointermove", handlePendingMove, { passive: false });
    window.addEventListener("pointerup", handlePendingUp);
    window.addEventListener("pointercancel", handlePendingUp);
  };

  /** 本次手势是否发生过拖拽，供点击回调抑制跳转 */
  const shouldSuppressClick = (): boolean => draggedThisGesture;

  onUnmounted(() => {
    cancelLongPress();
    cleanupPendingListeners();
    cleanupDragListeners();
  });

  return {
    isDragging,
    dragLabel,
    labelPos,
    lineStyle,
    onPointerDown,
    shouldSuppressClick,
  };
};
