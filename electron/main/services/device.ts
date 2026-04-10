import { getPlayer } from "./engine";
import { broadcast } from "@main/utils/broadcast";
import { playerLog } from "@main/utils/logger";

let pollingStarted = false;
/** undefined = 尚未初始化，null = 无设备，string = 设备名 */
let lastDefaultDevice: string | null | undefined = undefined;

/** 启动设备轮询，检测默认音频设备变化并自动重建输出 */
export const startDevicePolling = (): void => {
  if (pollingStarted) return;
  pollingStarted = true;

  setInterval(() => {
    try {
      const current = getPlayer().getDefaultDeviceName() ?? null;

      // 首次记录，不触发动作
      if (lastDefaultDevice === undefined) {
        lastDefaultDevice = current;
        return;
      }
      if (current === lastDefaultDevice) return;

      playerLog.info(`默认音频设备变化: ${lastDefaultDevice} → ${current}`);
      lastDefaultDevice = current;

      // 设备恢复或切换时重建音频输出
      if (current !== null) {
        try {
          getPlayer().reinitOutput();
          playerLog.info("音频输出已重建");
        } catch (error) {
          playerLog.warn("重建音频输出失败:", error);
        }
      }

      broadcast("player:event", {
        type: "deviceChanged",
        data: { defaultDevice: current },
      });
    } catch {}
  }, 3000);
};
