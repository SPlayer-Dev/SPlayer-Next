/**
 * 灵动岛窗口拖拽
 * - 用 clientX/Y 作为鼠标在窗口内的偏移，pointermove 时 targetX = screenX - offsetX
 *   不依赖渲染端窗口位置缓存，避开 Windows 高 DPI 下 DIP↔物理像素回环造成的尺寸漂移
 * - setPointerCapture 保证拖拽期间鼠标移出窗口也能持续派发事件
 * - rAF 节流降低 IPC 频率
 * - 区分点击与拖拽：移动距离 < DRAG_THRESHOLD 视为点击，pointerup 时回调
 */

/** 拖拽阈值（px）：移动距离小于此值视为点击 */
const DRAG_THRESHOLD = 5;

interface DragOptions {
  /** 是否允许拖拽（notchFusion / nonOcclusive 等模式下禁用） */
  enabled: () => boolean;
  /** 点击（未拖拽）时回调 */
  onClick: () => void;
}

export const useDragWindow = (options: DragOptions): {
  onContentPointerDown: (event: PointerEvent) => void;
} => {
  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragPointerId = -1;
  let dragTarget: HTMLElement | null = null;
  let moveRafPending = false;
  let pendingX = 0;
  let pendingY = 0;
  let hasMoved = false;

  const flushMove = (): void => {
    moveRafPending = false;
    window.api.dynamicIsland.move(pendingX, pendingY);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    const dx = event.screenX - dragStartX;
    const dy = event.screenY - dragStartY;
    if (!hasMoved && Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
      hasMoved = true;
    }
    pendingX = Math.round(event.screenX - dragOffsetX);
    pendingY = Math.round(event.screenY - dragOffsetY);
    if (!moveRafPending) {
      moveRafPending = true;
      requestAnimationFrame(flushMove);
    }
  };

  const onPointerUp = (): void => {
    if (!dragging) return;
    dragging = false;
    if (dragTarget && dragPointerId !== -1) {
      try {
        dragTarget.releasePointerCapture(dragPointerId);
      } catch {
        /* 捕获已失效 */
      }
    }
    dragTarget?.removeEventListener("pointermove", onPointerMove);
    dragTarget?.removeEventListener("pointerup", onPointerUp);
    dragTarget?.removeEventListener("pointercancel", onPointerUp);
    dragTarget = null;
    dragPointerId = -1;
    if (hasMoved) {
      window.api.dynamicIsland.saveState();
    } else {
      options.onClick();
    }
  };

  const onContentPointerDown = (event: PointerEvent): void => {
    if (!options.enabled()) return;
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    dragging = true;
    hasMoved = false;
    dragOffsetX = event.clientX;
    dragOffsetY = event.clientY;
    dragStartX = event.screenX;
    dragStartY = event.screenY;
    dragPointerId = event.pointerId;
    dragTarget = target;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      /* target 不支持捕获 */
    }
    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", onPointerUp);
    target.addEventListener("pointercancel", onPointerUp);
  };

  onBeforeUnmount(() => {
    if (dragTarget) {
      dragTarget.removeEventListener("pointermove", onPointerMove);
      dragTarget.removeEventListener("pointerup", onPointerUp);
      dragTarget.removeEventListener("pointercancel", onPointerUp);
    }
  });

  return { onContentPointerDown };
};
