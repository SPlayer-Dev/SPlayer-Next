import { shallowRef } from "vue";
import type { AutoMixComponentStatus } from "@shared/types/automix";

/** 只存紧凑的组件状态，不持有模型或音频数据 */
export const autoMixComponentStatus = shallowRef<AutoMixComponentStatus>({
  state: "missing",
  models: [],
});
/**
 * 仅在全部组件就绪后启用 AutoMix，下载进度变化不使 PCM 预载失效
 * @returns 所需模型和运行时均已就绪时为 true
 */
export const isAutoMixReady = (): boolean => autoMixComponentStatus.value.state === "ready";

/** 读取已校验的状态，设置页与预载服务共享结果，首次检查由主进程合并 */
export const refreshAutoMixComponents = async (): Promise<void> => {
  autoMixComponentStatus.value = await window.api.automix.getStatus();
};

/**
 * 在播放器生命周期内接收低频组件状态与下载进度
 * @returns 解绑函数
 */
export const connectAutoMixComponents = (): (() => void) => {
  const unsubscribe = window.api.automix.onStatus((status) => {
    autoMixComponentStatus.value = status;
  });
  void refreshAutoMixComponents().catch(console.warn);
  return unsubscribe;
};
