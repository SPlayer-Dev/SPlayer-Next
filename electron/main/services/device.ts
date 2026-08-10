import { sendToMain } from "@main/utils/broadcast";
import { playerLog } from "@main/utils/logger";
import { evaluateDeviceChange } from "./devicePolicy";

type AudioEngineModule = typeof import("@splayer/audio-engine");
type PlayerInstance = InstanceType<AudioEngineModule["AudioPlayer"]>;

const DEVICE_POLL_INTERVAL_MS = 3000;
const DEVICE_EVENT_DEBOUNCE_MS = 200;

let activePlayer: PlayerInstance | null = null;
let pollingTimer: NodeJS.Timeout | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
let lastDefaultDevice: string | null | undefined;
let reinitPromise: Promise<void> | null = null;
let pendingReinitPlayer: PlayerInstance | null = null;

/** 串行重建音频输出，合并重建期间到达的设备变化 */
const requestReinit = (player: PlayerInstance): void => {
  if (reinitPromise !== null) {
    pendingReinitPlayer = player;
    return;
  }

  reinitPromise = player
    .reinitOutput()
    .then(() => {
      playerLog.info("音频输出已重建");
    })
    .catch((error) => {
      playerLog.warn("重建音频输出失败:", error);
    })
    .finally(() => {
      reinitPromise = null;
      const pendingPlayer = pendingReinitPlayer;
      pendingReinitPlayer = null;
      if (pendingPlayer !== null && activePlayer === pendingPlayer) {
        try {
          const hasDefaultDevice = pendingPlayer.getDefaultDeviceName() != null;
          const followsDefaultDevice = pendingPlayer.getSelectedDeviceName() == null;
          if (hasDefaultDevice && followsDefaultDevice) requestReinit(pendingPlayer);
        } catch (error) {
          playerLog.warn("确认待处理设备变化失败:", error);
        }
      }
    });
};

/** 处理一次设备变化信号 */
const handleDeviceChange = (notifyListChange: boolean): void => {
  const player = activePlayer;
  if (player === null) return;

  try {
    const currentDefault = player.getDefaultDeviceName() ?? null;
    if (lastDefaultDevice === undefined) {
      lastDefaultDevice = currentDefault;
      if (notifyListChange) {
        sendToMain("player:event", {
          type: "deviceChanged",
          data: { defaultDevice: currentDefault },
        });
      }
      return;
    }

    const previousDefault = lastDefaultDevice;
    const decision = evaluateDeviceChange(
      previousDefault,
      currentDefault,
      player.getSelectedDeviceName() ?? null,
    );
    lastDefaultDevice = currentDefault;

    if (decision.defaultChanged) {
      playerLog.info(`默认音频设备变化: ${previousDefault} → ${currentDefault}`);
    }
    if (notifyListChange || decision.defaultChanged) {
      sendToMain("player:event", {
        type: "deviceChanged",
        data: { defaultDevice: currentDefault },
      });
    }
    if (decision.shouldReinit) {
      requestReinit(player);
    }
  } catch (error) {
    playerLog.warn("检查音频设备变化失败:", error);
  }
};

/** 合并 Windows 在一次插拔过程中连续发出的设备事件 */
const scheduleDeviceChange = (): void => {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    handleDeviceChange(true);
  }, DEVICE_EVENT_DEBOUNCE_MS);
};

/** 非 Windows 平台和原生监听失败时使用低频轮询兜底 */
const startPollingFallback = (): void => {
  pollingTimer = setInterval(() => handleDeviceChange(false), DEVICE_POLL_INTERVAL_MS);
};

/** 启动音频设备监听，Windows 使用系统事件，其它平台暂用轮询 */
export const startDeviceMonitoring = (player: PlayerInstance): void => {
  stopDeviceMonitoring();
  activePlayer = player;

  try {
    lastDefaultDevice = player.getDefaultDeviceName() ?? null;
  } catch (error) {
    lastDefaultDevice = undefined;
    playerLog.warn("读取默认音频设备失败:", error);
  }

  if (player.supportsDeviceWatcher()) {
    try {
      player.onDeviceChange(scheduleDeviceChange);
      playerLog.info("已启用原生音频设备事件监听");
      return;
    } catch (error) {
      playerLog.warn("原生音频设备监听启动失败，回退到轮询:", error);
    }
  }

  startPollingFallback();
};

/** 停止音频设备监听并清理待处理事件 */
export const stopDeviceMonitoring = (): void => {
  if (pollingTimer !== null) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (activePlayer !== null) {
    try {
      activePlayer.stopDeviceWatcher();
    } catch (error) {
      playerLog.warn("停止原生音频设备监听失败:", error);
    }
  }

  activePlayer = null;
  lastDefaultDevice = undefined;
  pendingReinitPlayer = null;
};
