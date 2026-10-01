import { onBeforeUnmount, onMounted, type Ref } from "vue";

/**
 * 歌词手动滚动的边界约束
 *
 * 两个歌词引擎都把全部歌词行常驻在 `overflow: hidden` 的容器内，仅靠 `translateY`
 * 移动，因此不存在原生滚动，浏览器不会代为钳制滚动量。`lyric-dom` 的
 * `applyUserScroll` 对偏移量无任何上限，AMLL 的边界又按全部歌词行的几何尺寸计算，
 * 开启「隐藏已播放行」后仍会放行已隐藏行所占的高度——两者都会滚出大面积空白。
 *
 * 此组合式函数在捕获阶段拦截滚轮 / 触摸手势，按屏内实际可见的歌词行算出当前姿态
 * 下还能滚动多少，越界的增量直接吞掉，不再传给引擎。
 *
 * 由于捕获阶段先于引擎执行，引擎只会应用被放行的增量，因此测量值始终反映引擎已
 * 应用完毕的状态，用测量值判断即可，无需另行累计偏移（重复累计会导致边界被算两遍，
 * 表现为滚轮很快“粘住”不动）。
 */

/**
 * 判定行已隐藏的透明度上限
 *
 * 两个引擎都用极小值而非 0 表示「隐藏」，AMLL 写入 1e-4，且渲染层有 0.05 的
 * 更新阈值，因此阈值必须取得足够小才能区分隐藏行与正常行。
 */
const HIDDEN_OPACITY_MAX = 5e-4;

/** 判定为滚动的死区，滤掉触控板的抖动 */
const SCROLL_EPSILON = 0.5;

/** 触摸手势忽略范围，避免和点击歌词行跳转冲突 */
const TOUCH_SLOP_PX = 4;

/** 两次滚动间隔超过此毫秒数视为新手势，需重新采集行元素 */
const SCROLL_SESSION_GAP_MS = 250;

interface ScrollMetrics {
  /** 首个可见行相对容器顶部的位移 */
  firstTop: number;
  /** 末个可见行相对容器顶部的位移 */
  lastBottom: number;
  /** 容器高度 */
  containerHeight: number;
}

interface LineCache {
  /** 行元素列表；歌词变更后需置空重取 */
  lines: HTMLElement[] | undefined;
  /** 行高，按行号索引 */
  heights: number[];
}

/**
 * 从内联 transform 中解析纵向位移
 *
 * 两个引擎的歌词行都由引擎逐帧写入内联 `translateY`：`lyric-dom` 写成
 * `translateY(12.3px) scale(0.9700)`，AMLL 写成 `translateY(12.3px)`。
 * 纯字符串解析，不触发任何布局计算。
 *
 * @param transform - 元素的内联 transform
 * @returns 纵向位移；无法解析时返回 null
 */
const parseTranslateY = (transform: string): number | null => {
  const match = /translateY\((-?[\d.]+)px\)/.exec(transform);
  return match ? Number.parseFloat(match[1]) : null;
};

/**
 * 判断一行当前是否可见
 *
 * `lyric-dom` 通过 `--ba`（文字遮罩透明度）表达隐藏，AMLL 则直接写元素
 * `opacity`；两者都读内联样式，避免 `getComputedStyle` 触发样式重算。
 *
 * @param lineEl - 歌词行元素
 * @returns 该行是否对用户可见
 */
const isLineVisible = (lineEl: HTMLElement): boolean => {
  const cssAlpha = Number.parseFloat(lineEl.style.getPropertyValue("--ba"));
  if (Number.isFinite(cssAlpha)) return cssAlpha > HIDDEN_OPACITY_MAX;

  const inlineAlpha = Number.parseFloat(lineEl.style.opacity);
  if (Number.isFinite(inlineAlpha)) return inlineAlpha > HIDDEN_OPACITY_MAX;

  return true;
};

/**
 * 判断是否为底部署名行
 *
 * 两个引擎都会把署名行与歌词行放在同一层，署名行不应参与滚动范围计算。
 *
 * @param el - 待判断的元素
 * @returns 是否为署名行
 */
const isCreditLine = (el: HTMLElement): boolean => {
  if (el.dataset.bottomLine === "true") return true;
  for (const name of el.classList) {
    if (name.endsWith("bottomLineWrapper") || name === "lp-credit") return true;
  }
  return false;
};

/**
 * 判断是否为歌词行元素
 *
 * 两个引擎的行类名不同：`lyric-dom` 用 `.lp-line`，AMLL 使用
 * `{哈希}_lyricLineWrapper`，哈希由构建期生成、不可硬编码，但后缀稳定。
 * 因此按类名后缀匹配，避开易变的前缀。
 *
 * @param el - 待判断的元素
 * @returns 是否为歌词行
 */
const isLyricLine = (el: HTMLElement): boolean => {
  for (const name of el.classList) {
    if (name === "lp-line" || name.endsWith("lyricLineWrapper")) return true;
  }
  return false;
};

/**
 * 收集容器内的歌词行元素
 *
 * @param container - 歌词容器元素
 * @returns 歌词行元素数组
 */
const collectLineElements = (container: HTMLElement): HTMLElement[] => {
  const lines: HTMLElement[] = [];
  for (const el of container.querySelectorAll<HTMLElement>("div")) {
    if (!isLyricLine(el) || isCreditLine(el)) continue;
    lines.push(el);
  }
  return lines;
};

/**
 * 读取当前所有可见歌词行形成的实际内容范围
 *
 * 刻意避免逐行调用 `getBoundingClientRect` / `getComputedStyle`：这两者都会强制
 * 同步布局，而行数可达上百，滚轮事件又以 60~120Hz 触发，逐行测量会与引擎的
 * 渲染循环互相打断造成掉帧。改为解析引擎已写好的内联 `translateY`，行元素与行高
 * 均按会话缓存复用，整个过程不触发布局。
 *
 * @param container - 歌词容器元素
 * @param cache - 行元素与行高缓存
 * @returns 内容范围；无可用行时返回 null
 */
const measureScrollMetrics = (container: HTMLElement, cache: LineCache): ScrollMetrics | null => {
  if (cache.lines === undefined) cache.lines = collectLineElements(container);
  const lineEls = cache.lines;
  if (lineEls.length === 0) return null;

  const containerHeight = container.clientHeight;
  let firstTop = Number.POSITIVE_INFINITY;
  let lastBottom = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < lineEls.length; i++) {
    const lineEl = lineEls[i];
    if (!isLineVisible(lineEl)) continue;

    const top = parseTranslateY(lineEl.style.transform);
    if (top === null) continue;

    // 行高在一首歌内基本不变，缺失时才读一次并缓存
    let height = cache.heights[i];
    if (height === undefined) {
      height = lineEl.offsetHeight;
      cache.heights[i] = height;
    }
    if (height <= 0) continue;

    if (top < firstTop) firstTop = top;
    const bottom = top + height;
    if (bottom > lastBottom) lastBottom = bottom;
  }

  if (!Number.isFinite(firstTop) || !Number.isFinite(lastBottom)) return null;
  return { firstTop, lastBottom, containerHeight };
};

/**
 * 由可见内容范围推导当前姿态下允许的滚动区间
 *
 * 引擎的滚动量为 `userScrollOffset`，内容随其增大而上移，即某行的屏幕位置为
 * `contentY - offset`。再滚动 `d` 后首行顶部变为 `firstTop - d`、末行底部变为
 * `lastBottom - d`，于是：
 *
 * - 内容顶端不得低于容器顶端：`firstTop - d <= 0`，得 `d >= firstTop`
 * - 内容底端不得高于容器底端：`lastBottom - d >= H`，得 `d <= lastBottom - H`
 *
 * 故允许的增量为 `[firstTop, lastBottom - H]`。
 *
 * @param metrics - 可见内容范围
 * @returns 允许的滚动区间；无法滚动时返回 null
 */
export const resolveScrollRangeFromMetrics = (
  metrics: ScrollMetrics,
): { min: number; max: number } | null => {
  const contentHeight = metrics.lastBottom - metrics.firstTop;
  if (contentHeight <= 0) return null;

  // 内容不高于容器时无需滚动，锁死在原位
  if (contentHeight <= metrics.containerHeight) return { min: 0, max: 0 };

  const min = metrics.firstTop;
  const max = metrics.lastBottom - metrics.containerHeight;

  // 内容已被滚过边界（如「隐藏已播放行」令范围骤然收缩）时不再放行滚动，
  // 交由引擎自身的回弹把内容拉回可见范围
  if (min > max) return { min: 0, max: 0 };

  return { min, max };
};

/**
 * 给歌词容器附加首尾滚动边界
 *
 * @param containerRef - 歌词容器元素引用
 */
export const useLyricScrollBound = (containerRef: Ref<HTMLElement | null | undefined>) => {
  /** 触摸手势的起始纵坐标 */
  let touchStartY = 0;
  /** 当前触摸手势是否已越过死区 */
  let touchActive = false;
  /** 行元素与行高缓存，避免滚动时反复遍历 DOM 或触发布局 */
  const cache: LineCache = { lines: undefined, heights: [] };
  /** 容器尺寸监听，尺寸变化时让缓存失效 */
  let resizeObserver: ResizeObserver | undefined;
  /** 上一次滚动的时间戳，用于识别新手势 */
  let lastScrollAt = 0;

  /**
   * 新手势开始时让缓存失效
   *
   * 换歌会替换行元素，缓存若继续复用会指向已脱离文档的旧节点；一次手势内歌词
   * 不会变化，因此每个手势重新采集一次即可，采集开销不随滚动事件数增长。
   */
  const beginScrollSession = () => {
    const now = performance.now();
    if (now - lastScrollAt > SCROLL_SESSION_GAP_MS) {
      cache.lines = undefined;
      cache.heights = [];
    }
    lastScrollAt = now;
  };

  /**
   * 读取当前姿态下允许的滚动区间
   *
   * @returns 允许的滚动区间；无法测量时返回 null
   */
  const resolveScrollRange = (): { min: number; max: number } | null => {
    const container = containerRef.value;
    if (!container) return null;

    const metrics = measureScrollMetrics(container, cache);
    if (!metrics) return null;

    return resolveScrollRangeFromMetrics(metrics);
  };

  /**
   * 判断本次滚动增量是否落在边界内
   *
   * `WheelEvent.deltaY` 是只读访问器，无法改写事件本身，因此这里只做放行判定：
   * 越界时连同剩余的零头一并吞掉，确保内容不会滚出边界。
   *
   * @param deltaY - 本次滚动的像素量，正值表示向下滚动
   * @returns 是否允许放行
   */
  const allowScrollDelta = (deltaY: number): boolean => {
    if (Math.abs(deltaY) <= SCROLL_EPSILON) return false;

    beginScrollSession();

    const range = resolveScrollRange();
    // 测不到行时不做限制，交回引擎自身行为
    if (!range) return true;

    if (deltaY > 0) return deltaY <= range.max + SCROLL_EPSILON;
    return -deltaY <= -range.min + SCROLL_EPSILON;
  };

  const handleWheel = (event: WheelEvent) => {
    // 非像素单位先折算成像素，与引擎的换算保持一致
    const deltaY =
      event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? event.deltaY : event.deltaY * 50;
    if (allowScrollDelta(deltaY)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const handleTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) return;
    touchStartY = event.touches[0].clientY;
    touchActive = false;
  };

  const handleTouchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1) return;
    const currentY = event.touches[0].clientY;
    const deltaY = touchStartY - currentY;

    if (!touchActive) {
      if (Math.abs(deltaY) < TOUCH_SLOP_PX) return;
      touchActive = true;
    }

    if (!allowScrollDelta(deltaY)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    touchStartY = currentY;
  };

  onMounted(() => {
    const container = containerRef.value;
    if (!container) return;

    container.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    container.addEventListener("touchstart", handleTouchStart, { capture: true, passive: true });
    container.addEventListener("touchmove", handleTouchMove, { capture: true, passive: false });

    // 容器尺寸变化通常伴随字号/布局调整，缓存随之失效
    resizeObserver = new ResizeObserver(() => {
      cache.lines = undefined;
      cache.heights = [];
    });
    resizeObserver.observe(container);
  });

  onBeforeUnmount(() => {
    resizeObserver?.disconnect();
    resizeObserver = undefined;

    const container = containerRef.value;
    if (!container) return;

    container.removeEventListener("wheel", handleWheel, { capture: true });
    container.removeEventListener("touchstart", handleTouchStart, { capture: true });
    container.removeEventListener("touchmove", handleTouchMove, { capture: true });
  });
};
