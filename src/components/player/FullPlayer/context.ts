import type { InjectionKey, Ref } from "vue";

/** 全屏播放器壳层下发给各布局的共享状态 */
export interface FullPlayerContext {
  /** 是否处于沉浸模式 */
  immersive: Readonly<Ref<boolean>>;
  /** 是否已允许挂载歌词引擎 */
  lyricMounted: Readonly<Ref<boolean>>;
  /** 展开完成且窗口可见，允许运行高频渲染 */
  contentActive: Readonly<Ref<boolean>>;
  /** 歌词完成首次布局 */
  onLyricReady: () => void;
  /** 鼠标进入顶栏或底栏 */
  onBarEnter: () => void;
  /** 鼠标离开顶栏或底栏 */
  onBarLeave: () => void;
}

export const fullPlayerContextKey = Symbol("fullPlayer") as InjectionKey<FullPlayerContext>;

/**
 * 读取全屏播放器壳层上下文
 * @returns 壳层共享状态
 */
export const useFullPlayer = (): FullPlayerContext => inject(fullPlayerContextKey)!;
