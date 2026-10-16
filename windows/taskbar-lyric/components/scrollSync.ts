/**
 * 任务栏歌词窗口内主行与翻译行共享的滚动比例
 * 任务栏歌词窗口只有一个主行实例；翻译行允许有一帧读取延迟
 */
let primaryScrollRatio = 0;

export const setPrimaryScrollRatio = (r: number): void => {
  primaryScrollRatio = r;
};

export const getPrimaryScrollRatio = (): number => primaryScrollRatio;
