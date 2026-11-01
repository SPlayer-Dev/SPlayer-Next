import type { Router, RouteLocationNormalized } from "vue-router";
import type { CoverItem } from "@/types/artist";

type CoverPreview = Pick<CoverItem, "title" | "cover" | "trackCount">;

/** 只保留一次导航的头部摘要，不缓存歌曲和页面 DOM */
interface CoverNavigation {
  coverKey: string;
  header: CoverPreview;
  listPath: string;
  detailPath: string;
}

let pendingCover: Pick<CoverNavigation, "coverKey" | "header"> | null = null;
let preview: CoverNavigation | null = null;
let captureEnabled = false;

export const coverTransitionActive = shallowRef(false);

/**
 * 按稳定标识查找封面，卡片重新挂载后仍能匹配
 * 标识只含媒体类型与 ID，页面与服务器身份由 listPath 校验和主内容区作用域保证
 * @param scope - 主内容容器
 * @param key - 卡片声明的稳定标识
 * @returns 当前页面内的封面元素
 */
const findCover = (scope: HTMLElement, key: string): HTMLElement | null =>
  scope.querySelector<HTMLElement>(`[data-cover-key="${key}"]`);

/**
 * 记录本次点击的封面，路由守卫只在当前事件引发详情跳转时消费
 * @param item - 卡片摘要
 * @param coverKey - 卡片的稳定标识，不能使用组件实例 ID
 */
export const captureCover = (item: CoverItem, coverKey: string): void => {
  if (!captureEnabled || !item.cover) return;
  const captured = {
    coverKey,
    header: {
      title: item.title,
      cover: item.cover,
      trackCount: item.trackCount,
    },
  };
  pendingCover = captured;
  window.setTimeout(() => {
    if (pendingCover === captured) pendingCover = null;
  }, 0);
};

/**
 * 读取当前详情的首屏摘要，不等待歌曲详情请求
 * @param path - 详情完整路由，包含所属服务器
 * @returns 与当前导航匹配的摘要
 */
export const getCoverPreview = (path: string): CoverPreview | null =>
  preview?.detailPath === path ? preview.header : null;

/**
 * 在路由切换时共享封面，其余路由继续使用原有动效
 * @param router - 应用路由
 * @param getScope - 主内容容器
 * @param restoreScroll - 新页面挂载后的滚动位置恢复
 * @returns 移除守卫并释放本次过渡的函数
 */
export const installCoverTransitions = (
  router: Router,
  getScope: () => HTMLElement | null,
  restoreScroll: () => void,
): (() => void) => {
  captureEnabled = true;
  let returnNavigation: CoverNavigation | null = null;
  let navigation: CoverNavigation | null = null;
  let targetRoute: RouteLocationNormalized | null = null;
  let transition: ViewTransition | null = null;
  let finishUpdate: (() => void) | null = null;
  let releaseNavigation: (() => void) | null = null;
  let covers: HTMLElement[] = [];

  /** 释放原生快照和临时样式，允许连续导航和取消导航 */
  const cleanup = (): void => {
    transition?.skipTransition();
    transition = null;
    finishUpdate?.();
    finishUpdate = null;
    releaseNavigation?.();
    releaseNavigation = null;
    for (const cover of covers) cover.removeAttribute("data-cover-shared");
    document.documentElement.removeAttribute("data-cover-transition");
    getScope()?.style.removeProperty("--cover-transition-radius");
    covers = [];
    preview = null;
    coverTransitionActive.value = false;
  };

  const removeBeforeEach = router.beforeEach((to, from) => {
    cleanup();
    navigation = null;
    targetRoute = to;
    const captured = pendingCover;
    pendingCover = null;
    if ((to.name === "collection" || to.name === "artist") && captured) {
      navigation = { ...captured, listPath: from.fullPath, detailPath: to.fullPath };
    } else if (
      returnNavigation &&
      ((from.fullPath === returnNavigation.detailPath &&
        to.fullPath === returnNavigation.listPath) ||
        (from.fullPath === returnNavigation.listPath &&
          to.fullPath === returnNavigation.detailPath))
    ) {
      navigation = returnNavigation;
    }
  });

  const removeBeforeResolve = router.beforeResolve(async (to) => {
    const current = navigation;
    const scope = getScope();
    if (
      to !== targetRoute ||
      !current ||
      !scope ||
      !document.startViewTransition ||
      document.hidden ||
      document.documentElement.hasAttribute("data-player-transition")
    ) {
      return;
    }

    const entering = to.fullPath === current.detailPath;
    const cover = entering
      ? findCover(scope, current.coverKey)
      : scope.querySelector<HTMLElement>("[data-cover-hero]");
    const image = cover?.querySelector<HTMLImageElement>("img[data-cover-image]");
    if (!cover || !scope.contains(cover) || !image?.complete || !image.naturalWidth) return;

    covers.push(cover);
    cover.setAttribute("data-cover-shared", "");
    scope.style.setProperty("--cover-transition-radius", getComputedStyle(cover).borderRadius);
    if (entering) preview = current;
    coverTransitionActive.value = true;

    const committed = Promise.withResolvers<void>();
    const { promise: started, resolve: release } = Promise.withResolvers<void>();
    finishUpdate = committed.resolve;
    releaseNavigation = release;
    document.documentElement.setAttribute("data-cover-transition", entering ? "enter" : "back");
    const active = document.startViewTransition(async () => {
      release();
      if (releaseNavigation === release) releaseNavigation = null;
      await committed.promise;
    });
    transition = active;
    // 取消过渡会拒绝 ready，但 finished 仍会完成清理
    void active.ready.catch(() => {});
    void active.finished.then(() => {
      if (transition === active) cleanup();
    });
    await started;
  });

  const removeAfterEach = router.afterEach(async (to, _from, failure) => {
    if (to !== targetRoute) return;
    const current = navigation;
    const active = transition;
    if (failure) {
      cleanup();
      return;
    }
    if (!current || !active) return;
    if (to.fullPath === current.detailPath) returnNavigation = current;

    await nextTick();
    restoreScroll();
    // KeepAlive 中的虚拟列表会在激活后的 nextTick 恢复内部滚动
    await nextTick();
    if (transition !== active) return;
    const scope = getScope();
    const entering = to.fullPath === current.detailPath;
    const cover = entering
      ? scope?.querySelector<HTMLElement>("[data-cover-hero]")
      : scope
        ? findCover(scope, current.coverKey)
        : null;
    if (cover && scope?.contains(cover)) {
      const bounds = cover.getBoundingClientRect();
      const viewport = scope.getBoundingClientRect();
      if (bounds.bottom > viewport.top && bounds.top < viewport.bottom && bounds.width > 0) {
        const image = cover.querySelector<HTMLImageElement>("img[data-cover-image]");
        // 返回时只匹配已加载的卡片，避免等待网络图片冻结主内容区
        if (image && (entering || (image.complete && image.naturalWidth > 0))) {
          await image.decode().catch(() => {});
          if (transition === active && image.naturalWidth > 0) {
            covers.push(cover);
            cover.setAttribute("data-cover-shared", "");
          }
        }
      }
    }
    if (transition === active) {
      finishUpdate?.();
      finishUpdate = null;
    }
  });

  const removeError = router.onError((_error, to) => {
    if (to === targetRoute) cleanup();
  });
  return () => {
    captureEnabled = false;
    removeBeforeEach();
    removeBeforeResolve();
    removeAfterEach();
    removeError();
    cleanup();
    pendingCover = null;
    returnNavigation = null;
  };
};
