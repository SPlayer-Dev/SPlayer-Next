import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { coverTransitionActive } from "@/services/coverTransition";

export const fullPlayerReady = shallowRef(false);
export const playerTransition = shallowRef<ViewTransition | null>(null);
export const playerTransitionActive = computed(() => playerTransition.value !== null);
let covers: HTMLElement[] = [];
let layoutTransition: ViewTransition | null = null;

/** 跳过进行中的布局过渡，避免与展开过渡的共享元素命名冲突 */
const skipLayoutTransition = (): void => {
  const active = layoutTransition;
  if (!active) return;
  layoutTransition = null;
  active.skipTransition();
  document.documentElement.removeAttribute("data-player-layout-transition");
};

/**
 * 在全屏播放器布局之间做快照过渡，播放器不可见或动效关闭时直接切换
 * @param update - 切换实际渲染布局的回调
 */
export const switchPlayerLayout = (update: () => void): void => {
  skipLayoutTransition();
  const status = useStatusStore();
  const settings = useSettingsStore();
  if (
    !status.isPlayerExpanded ||
    playerTransitionActive.value ||
    !settings.appearance.seamlessTransition ||
    settings.reducedMotion ||
    !document.startViewTransition ||
    document.hidden ||
    coverTransitionActive.value
  ) {
    update();
    return;
  }
  const root = document.documentElement;
  const coverSelector = '[data-player-cover="full"] img[data-cover-image]';
  const previousCover = document.querySelector<HTMLImageElement>(coverSelector)?.src;
  root.setAttribute("data-player-layout-transition", "");
  // 快照过渡只在合成层插值，歌词区域仅在切换瞬间重排一次
  const active = document.startViewTransition(async () => {
    update();
    await nextTick();
    // 新布局重建了封面节点；仅等待同地址原图的内存缓存解码，避免网络请求卡住过渡回调
    const image = document.querySelector<HTMLImageElement>(coverSelector);
    if (image && image.src === previousCover) await image.decode().catch(() => {});
  });
  layoutTransition = active;
  void active.ready.catch(() => {});
  void active.finished
    .finally(() => {
      if (layoutTransition !== active) return;
      layoutTransition = null;
      root.removeAttribute("data-player-layout-transition");
    })
    .catch(() => {});
};

/** 释放播放器快照和临时标记，取消尚未完成的封面匹配 */
export const cancelPlayerTransition = (): void => {
  const active = playerTransition.value;
  if (!active) return;
  playerTransition.value = null;
  active.skipTransition();
  for (const cover of covers) cover.removeAttribute("data-player-shared");
  covers = [];
  const root = document.documentElement;
  root.removeAttribute("data-player-transition");
  root.style.removeProperty("--player-cover-from-radius");
  root.style.removeProperty("--player-cover-to-radius");
};

/**
 * 在底栏与展开播放器之间匹配封面，其余情况沿用原有展开动画
 * @param expanded - 是否展开播放器
 */
export const setPlayerExpanded = (expanded: boolean): void => {
  cancelPlayerTransition();
  skipLayoutTransition();
  const status = useStatusStore();
  if (status.isPlayerExpanded === expanded) return;
  const settings = useSettingsStore();
  // 全屏歌词没有可衔接的大封面，展开时沿用默认滑入动画
  if (
    !settings.appearance.seamlessTransition ||
    settings.reducedMotion ||
    !document.startViewTransition ||
    document.hidden ||
    coverTransitionActive.value ||
    (expanded && settings.player.layout === "fullLyric")
  ) {
    status.isPlayerExpanded = expanded;
    return;
  }

  const source = document.querySelector<HTMLElement>(
    `[data-player-cover="${expanded ? "bar" : "full"}"]`,
  );
  const image = source?.querySelector<HTMLImageElement>(expanded ? "img[data-cover-image]" : "img");
  if (!source || !image?.complete || !image.naturalWidth || !source.checkVisibility()) {
    status.isPlayerExpanded = expanded;
    return;
  }

  const root = document.documentElement;
  source.setAttribute("data-player-shared", "");
  covers.push(source);
  root.setAttribute("data-player-transition", expanded ? "expand" : "collapse");
  root.style.setProperty("--player-cover-from-radius", getComputedStyle(source).borderRadius);
  const active = document.startViewTransition(async () => {
    if (playerTransition.value !== active) return;
    source.removeAttribute("data-player-shared");
    status.isPlayerExpanded = expanded;
    // 首次展开等待懒加载挂载，取消时也结束等待
    if (expanded) {
      await until(() => fullPlayerReady.value || playerTransition.value !== active).toBe(true);
    }
    await nextTick();
    if (playerTransition.value !== active) return;
    const target = document.querySelector<HTMLElement>(
      `[data-player-cover="${expanded ? "full" : "bar"}"]`,
    );
    const targetImage = target?.querySelector<HTMLImageElement>("img");
    // 仅解码已加载图片或相同地址的缩略图，避免等待高清图片的网络请求
    if (targetImage && (targetImage.complete || targetImage.src === image.src)) {
      await targetImage.decode().catch(() => {});
    }
    if (playerTransition.value !== active || !target) return;
    covers.push(target);
    target.setAttribute("data-player-shared", "");
    root.style.setProperty("--player-cover-to-radius", getComputedStyle(target).borderRadius);
  });
  playerTransition.value = active;
  void active.ready.catch(() => {});
  void active.finished
    .finally(() => {
      if (playerTransition.value === active) cancelPlayerTransition();
    })
    .catch(() => {});
};
