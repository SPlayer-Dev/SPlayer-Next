import { getPlayer, resetPlayer } from "./engine";
import { broadcast } from "../utils/broadcast";
import { playerLog } from "../utils/logger";

/** 设备是否丢失 */
let deviceLost = false;
/** 轮询是否已启动 */
let pollingStarted = false;

/** 获取当前默认设备名，失败返回 null */
const queryDefaultDevice = (): string | null => {
  try {
    return getPlayer().getDefaultDeviceName() ?? null;
  } catch {
    return null;
  }
};

/** 设备丢失：销毁实例，通知前端 */
const onDeviceLost = (): void => {
  deviceLost = true;
  resetPlayer();
  playerLog.warn("音频设备丢失，已销毁播放器实例");
  broadcast("player:event", {
    type: "status",
    data: { state: "stopped", position: 0, duration: 0, volume: 1, isFinished: false },
  });
};

/** 设备恢复：重建实例（getPlayer 自动触发 onCreated 回调） */
const onDeviceRestored = (): void => {
  try {
    getPlayer();
    playerLog.info("音频设备恢复，已重建播放器实例");
    deviceLost = false;
  } catch (error) {
    playerLog.warn("设备恢复时重建失败:", error);
  }
};

/** 设备切换（非丢失）：reinit 当前实例 */
const onDeviceSwitched = (): void => {
  try {
    const inst = getPlayer();
    if (inst.getSelectedDeviceName() == null) {
      inst.reinitOutput();
      playerLog.info("已自动切换到新的默认设备");
    }
  } catch (error) {
    playerLog.warn("自动切换设备失败:", error);
    resetPlayer();
  }
};

/** 启动设备轮询 */
export const startDevicePolling = (): void => {
  if (pollingStarted) return;
  pollingStarted = true;
  let lastDefaultDevice: string | null = null;

  setInterval(() => {
    const current = queryDefaultDevice();
    if (lastDefaultDevice === null || current === lastDefaultDevice) {
      lastDefaultDevice = current;
      return;
    }

    playerLog.info(`检测到默认音频设备变化: ${lastDefaultDevice} → ${current}`);

    if (current === null) {
      onDeviceLost();
    } else if (deviceLost) {
      onDeviceRestored();
    } else {
      onDeviceSwitched();
    }

    broadcast("player:event", {
      type: "deviceChanged",
      data: { defaultDevice: current },
    });
    lastDefaultDevice = current;
  }, 3000);
};
