/**
 * 展开视图状态管理
 * 参照 WinIsland 的 ContextManager + App 结构体
 */

export type IslandView = "mini" | "expanded";

export function useExpandedView(defaultTimeoutSec = 8) {
  const currentView = ref<IslandView>("mini");
  let expandTimer: number | null = null;
  /** 当前生效的超时秒数 */
  let activeTimeoutSec = defaultTimeoutSec;

  const startAutoCollapse = (timeoutSec: number): void => {
    if (expandTimer !== null) window.clearTimeout(expandTimer);
    activeTimeoutSec = timeoutSec;
    expandTimer = window.setTimeout(() => {
      currentView.value = "mini";
      expandTimer = null;
    }, timeoutSec * 1000);
  };

  /** 展开视图 */
  const expand = (timeoutSec?: number): void => {
    if (currentView.value === "expanded") return;
    currentView.value = "expanded";
    startAutoCollapse(timeoutSec ?? defaultTimeoutSec);
  };

  /** 收起视图 */
  const collapse = (): void => {
    if (currentView.value === "mini") return;
    currentView.value = "mini";
    if (expandTimer !== null) {
      window.clearTimeout(expandTimer);
      expandTimer = null;
    }
  };

  /** 切换展开/收起 */
  const toggle = (): void => {
    if (currentView.value === "mini") expand();
    else collapse();
  };

  /** 重置自动收起计时器（用户交互时续期） */
  const resetTimer = (): void => {
    if (currentView.value !== "expanded" || expandTimer === null) return;
    startAutoCollapse(activeTimeoutSec);
  };

  onBeforeUnmount(() => {
    if (expandTimer !== null) {
      window.clearTimeout(expandTimer);
      expandTimer = null;
    }
  });

  return { currentView, expand, collapse, toggle, resetTimer };
}
