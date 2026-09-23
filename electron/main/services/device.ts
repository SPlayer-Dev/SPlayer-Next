import { sendToMain } from "@main/utils/broadcast";
import { playerLog } from "@main/utils/logger";

type AudioEngineModule = typeof import("@splayer/audio-engine");
type PlayerInstance = InstanceType<AudioEngineModule["AudioPlayer"]>;

const DEVICE_EVENT_DEBOUNCE_MS = 200;
// 首次重建前等待
const REINIT_DELAY_MS = 300;

let activePlayer: PlayerInstance | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
/** 默认输出设备 ID */
let lastDefaultId: string | null | undefined;
let reinitPromise: Promise<void> | null = null;
let pendingReinitPlayer: PlayerInstance | null = null;
let retryTimer: NodeJS.Timeout | null = null;
/** 上次重建失败后输出仍不可用；后续设备事件到来时再尝试 */
let outputBroken = false;
let pauseOnDeviceSwitch = false;

/** 设置默认输出设备切换前是否立即暂停 */
export const setPauseOnDeviceSwitch = (enabled: boolean): void => {
  pauseOnDeviceSwitch = enabled;
};

/** 取消尚未开始的恢复重试；正在执行的原生重建由新的 load token / 输出代次接管。 */
export const cancelPendingReinit = (): void => {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  pendingReinitPlayer = null;
};

/** 读取当前默认设备 ID */
const readDefaultId = (player: PlayerInstance): string | null => {
  try {
    return player.getDefaultDeviceId() ?? null;
  } catch {
    return null;
  }
};

/**
 * 执行一次恢复
 * 仅对端点未就绪的瞬态失败重试一次，持续失败交给设备事件或用户操作
 */
const runReinit = (player: PlayerInstance, attempt: number): void => {
  const startedDefault = readDefaultId(player);
  reinitPromise = player
    .reinitOutput()
    .then(() => {
      outputBroken = false;
      playerLog.info("音频输出已重建");
    })
    .catch((error) => {
      if (attempt === 0 && activePlayer === player) {
        playerLog.warn(`音频输出重建失败，将在 ${REINIT_DELAY_MS}ms 后重试:`, error);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          pendingReinitPlayer = null;
          if (activePlayer === player) runReinit(player, attempt + 1);
        }, REINIT_DELAY_MS);
        return;
      }
      outputBroken = true;
      playerLog.warn("音频输出重建失败，等待设备事件或用户操作恢复:", error);
    })
    .finally(() => {
      reinitPromise = null;
      if (retryTimer !== null) return;
      const pendingPlayer = pendingReinitPlayer;
      pendingReinitPlayer = null;
      if (pendingPlayer === null || activePlayer !== pendingPlayer) return;
      // 仅当重建期间默认设备又变化、或上次尝试失败时才补一次
      if (outputBroken || readDefaultId(pendingPlayer) !== startedDefault) {
        requestReinit(pendingPlayer);
      }
    });
};

/** 串行重建音频输出，合并重建期间到达的设备变化 / 输出流错误 */
export const requestReinit = (player: PlayerInstance): void => {
  // 流错误触发的重建
  if (pauseOnDeviceSwitch) player.pauseImmediately();
  if (reinitPromise !== null || retryTimer !== null) {
    pendingReinitPlayer = player;
    return;
  }
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (activePlayer === player) runReinit(player, 0);
  }, REINIT_DELAY_MS);
};

/** 处理一次设备变化信号 */
const handleDeviceChange = (notifyListChange: boolean, defaultChanged: boolean): void => {
  const player = activePlayer;
  if (player === null) return;

  try {
    const currentDefault = player.getDefaultDeviceName() ?? null;
    const currentDefaultId = readDefaultId(player);
    if (lastDefaultId === undefined) {
      lastDefaultId = currentDefaultId;
      if (notifyListChange) {
        sendToMain("player:event", {
          type: "deviceChanged",
          data: { defaultDevice: currentDefault },
        });
      }
      return;
    }

    const selectedDevice = player.getSelectedDeviceName() ?? null;
    const defaultSwitched = lastDefaultId !== currentDefaultId;
    lastDefaultId = currentDefaultId;

    if (defaultSwitched) {
      playerLog.info(`默认音频设备变化，当前设备: ${currentDefault}`);
    }
    if (notifyListChange || defaultSwitched) {
      sendToMain("player:event", {
        type: "deviceChanged",
        data: { defaultDevice: currentDefault },
      });
    }
    // 重建仅在看护默认设备时跟随切换；默认设备暂时消失（currentDefaultId 为 null）时等它回来，
    // 用户固定设备时不跟随——引擎按具体端点打开输出，固定设备的流不受默认切换影响
    const shouldReinit = defaultSwitched && currentDefaultId !== null && selectedDevice === null;
    if (shouldReinit || (outputBroken && currentDefault !== null && selectedDevice === null)) {
      requestReinit(player);
    }
    // Linux 的 cpal PipeWire 后端默认设备名恒为哨兵值，上面判不出切换
    if (defaultChanged && selectedDevice === null && pauseOnDeviceSwitch) {
      player.pauseImmediately();
    }
  } catch (error) {
    playerLog.warn("检查音频设备变化失败:", error);
  }
};

/** 合并 Windows 在一次插拔过程中连续发出的设备事件 */
let pendingDefaultChange = false;
const scheduleDeviceChange = (defaultChanged: boolean): void => {
  // 合并窗口内任一事件为默认变化即按默认变化处理
  pendingDefaultChange ||= defaultChanged;
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const mergedDefaultChange = pendingDefaultChange;
    pendingDefaultChange = false;
    handleDeviceChange(true, mergedDefaultChange);
  }, DEVICE_EVENT_DEBOUNCE_MS);
};

/** 启动原生音频设备监听；不支持的后端依赖输出流错误和停滞检测恢复。 */
export const startDeviceMonitoring = (player: PlayerInstance): void => {
  stopDeviceMonitoring();
  activePlayer = player;

  lastDefaultId = readDefaultId(player);

  if (player.supportsDeviceWatcher()) {
    try {
      player.onDeviceChange(scheduleDeviceChange);
      playerLog.info("已启用原生音频设备事件监听");
      return;
    } catch (error) {
      playerLog.warn("原生音频设备监听启动失败，将依赖输出流错误恢复:", error);
    }
  }
};

/** 停止音频设备监听并清理待处理事件 */
export const stopDeviceMonitoring = (): void => {
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
  lastDefaultId = undefined;
  outputBroken = false;
  pendingDefaultChange = false;
  cancelPendingReinit();
};
