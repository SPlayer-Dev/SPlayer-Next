import { K20GTController } from "./controller";
import type { K20GTWorkerApi } from "@shared/types/k20gt";

declare global {
  interface Window {
    k20gtWorker: K20GTWorkerApi;
    stopK20GT: () => Promise<void>;
  }
}

const controller = new K20GTController(navigator.hid, window.k20gtWorker.status);
const unsubscribe = window.k20gtWorker.onReport((report) => controller.submit(report));

/** 停止设备页面并解除报文监听 */
window.stopK20GT = async (): Promise<void> => {
  unsubscribe();
  await controller.dispose();
};

void controller.connect();
