import { handleOrpheus } from "@/services/orpheus";

/**
 * 主窗口接入 orpheus 协议唤起
 */
export const useOrpheusProtocol = (): void => {
  let unsubscribe: (() => void) | null = null;
  onMounted(() => {
    // 监听主进程下发的协议唤起事件
    unsubscribe = window.api.system.onProtocolUrl(handleOrpheus);
  });
  onBeforeUnmount(() => unsubscribe?.());
};
