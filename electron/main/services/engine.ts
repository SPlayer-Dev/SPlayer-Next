import { loadNativeModule } from "../utils/nativeLoader";
import { coverCacheDir, isDev } from "../utils/config";
import { playerLog, nativeLogsDir } from "../utils/logger";

type AudioEngineModule = typeof import("@splayer/audio-engine");
type PlayerInstance = InstanceType<AudioEngineModule["AudioPlayer"]>;

let audioEngine: AudioEngineModule | null = null;
let playerInstance: PlayerInstance | null = null;

/** 实例创建后的回调列表（注册事件、启动轮询等） */
const onCreatedCallbacks: Array<(inst: PlayerInstance) => void> = [];

/** 获取原生音频引擎模块 */
export const getEngine = (): AudioEngineModule => {
  if (!audioEngine) {
    audioEngine = loadNativeModule<AudioEngineModule>("audio-engine.node", "audio-engine");
    if (!audioEngine) {
      throw new Error("Failed to load audio-engine.node");
    }
    audioEngine.initLogger(nativeLogsDir, isDev);
  }
  return audioEngine;
};

/**
 * 注册播放器实例创建后的回调（在创建/重建时都会触发）
 * 在 getPlayer 首次调用前注册
 */
export const onPlayerCreated = (callback: (inst: PlayerInstance) => void): void => {
  onCreatedCallbacks.push(callback);
};

/** 获取播放器实例 */
export const getPlayer = (): PlayerInstance => {
  if (!playerInstance) {
    const mod = getEngine();
    playerInstance = new mod.AudioPlayer();
    playerInstance.setCoverCacheDir(coverCacheDir);
    for (const cb of onCreatedCallbacks) {
      cb(playerInstance);
    }
    playerLog.info("播放器实例已创建");
  }
  return playerInstance;
};

/** 销毁播放器实例，下次 getPlayer 时自动重建 */
export const resetPlayer = (): void => {
  if (playerInstance) {
    try {
      playerInstance.stop();
    } catch {
      // 设备已丢失时 stop 可能失败，忽略
    }
  }
  playerLog.warn("销毁播放器实例，将在下次操作时重建");
  playerInstance = null;
};

/** 同步音量均衡设置到播放器 */
export const setNormalizationEnabled = (enabled: boolean): void => {
  if (playerInstance) {
    playerInstance.setNormalizationEnabled(enabled);
  }
};
