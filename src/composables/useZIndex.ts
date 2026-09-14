import { ref, onBeforeUnmount, getCurrentInstance, type Ref } from "vue";

/** 浮层全局自增层级基准 */
export const DEFAULT_Z_INDEX = 300;

let currentNextZIndex = DEFAULT_Z_INDEX;
let activeCount = 0;

/**
 * 获取全局单调递增的下一个层级
 * 每次弹窗或浮层打开时调用，保证后激活的层级永远高于先激活的层级
 */
export const nextZIndex = (): number => {
  return ++currentNextZIndex;
};

/**
 * 弹出层/浮动层动态层级管理
 * 弹出层（Dialog/Select/Popover/Tooltip/Dropdown 等）展开时自动获取最新最高层级
 * @param customZIndex - 自定义层级
 */
export const usePopupZIndex = (customZIndex?: Ref<number | undefined> | number) => {
  const initial = typeof customZIndex === "number" ? customZIndex : customZIndex?.value;
  const zIndex = ref(initial ?? DEFAULT_Z_INDEX);
  let isRegistered = false;

  const acquire = (): number => {
    const fixed = typeof customZIndex === "number" ? customZIndex : customZIndex?.value;
    if (fixed !== undefined) {
      zIndex.value = fixed;
      return fixed;
    }
    if (!isRegistered) {
      activeCount++;
      isRegistered = true;
    }
    zIndex.value = nextZIndex();
    return zIndex.value;
  };

  const release = (): void => {
    if (isRegistered) {
      activeCount--;
      isRegistered = false;
      if (activeCount <= 0) {
        activeCount = 0;
        currentNextZIndex = DEFAULT_Z_INDEX;
      }
    }
  };

  const onOpenChange = (open: boolean): void => {
    if (open) {
      acquire();
    } else {
      release();
    }
  };

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      release();
    });
  }

  return {
    zIndex,
    acquire,
    release,
    onOpenChange,
  };
};
