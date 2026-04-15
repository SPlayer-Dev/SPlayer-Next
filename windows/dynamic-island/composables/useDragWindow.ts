/**
 * 灵动岛窗口拖拽
 * - 用 clientX/Y 作为鼠标在窗口内的偏移，pointermove 时 targetX = screenX - offsetX
 *   不依赖任何渲染端窗口位置缓存，避开 Windows 高 DPI 下 DIP↔物理像素回环造成的尺寸漂移
 * - setPointerCapture 保证拖拽期间鼠标移出窗口也能持续派发事件
 * - rAF 节流降低 IPC 频率
 */
export const useDragWindow = (): {
  onRootPointerDown: (event: PointerEvent) => void;
} => {
  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragPointerId = -1;
  let dragTarget: HTMLElement | null = null;
  let moveRafPending = false;
  let pendingX = 0;
  let pendingY = 0;

  /** 刷新移动 */
  const flushMove = (): void => {
    moveRafPending = false;
    window.api.dynamicIsland.move(pendingX, pendingY);
  };

  /** 指针移动事件 */
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    pendingX = Math.round(event.screenX - dragOffsetX);
    pendingY = Math.round(event.screenY - dragOffsetY);
    if (!moveRafPending) {
      moveRafPending = true;
      requestAnimationFrame(flushMove);
    }
  };

  /** 指针抬起事件 */
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
    window.api.dynamicIsland.saveState();
  };

  /** 根节点指针按下事件 */
  const onRootPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (!target || target.closest(".no-drag")) return;
    dragging = true;
    dragOffsetX = event.clientX;
    dragOffsetY = event.clientY;
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
    event.preventDefault();
  };

  onBeforeUnmount(() => {
    if (dragTarget) {
      dragTarget.removeEventListener("pointermove", onPointerMove);
      dragTarget.removeEventListener("pointerup", onPointerUp);
      dragTarget.removeEventListener("pointercancel", onPointerUp);
    }
  });

  return { onRootPointerDown };
};
