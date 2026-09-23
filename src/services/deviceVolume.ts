/** 存储 Key */
const STORAGE_KEY = "splayer:device-volumes";

/** 最大记录设备数上限 */
const MAX_DEVICE_RECORDS = 30;

/** 设备音量存储项结构 */
export interface DeviceVolumeRecord {
  /** 音量值（0.0 ~ 1.0） */
  volume: number;
  /** 最近更新时间戳（毫秒） */
  updatedAt: number;
}

/** 设备音量存储字典 */
export type DeviceVolumeStorage = Record<string, DeviceVolumeRecord>;

/** 初始化内存缓存 */
const loadFromStorage = (): DeviceVolumeStorage => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as DeviceVolumeStorage) : {};
  } catch {
    return {};
  }
};

/** 内存中的设备音量缓存 */
const memoryCache: DeviceVolumeStorage = loadFromStorage();

/**
 * 读取指定音频设备的记忆音量
 * @param deviceId - 音频设备稳定 ID
 * @returns 音量（0.0 ~ 1.0），无记录时返回 null
 */
export const getDeviceVolume = (deviceId: string): number | null => {
  const volume = memoryCache[deviceId]?.volume;
  if (typeof volume !== "number") return null;
  return Math.max(0, Math.min(1, volume));
};

/**
 * 保存指定音频设备的音量并同步落盘
 * @param deviceId - 音频设备稳定 ID
 * @param volume - 音量（0.0 ~ 1.0）
 */
export const setDeviceVolume = (deviceId: string, volume: number): void => {
  memoryCache[deviceId] = { volume, updatedAt: Date.now() };

  // 超出上限时淘汰最久未更新的记录
  const keys = Object.keys(memoryCache);
  if (keys.length > MAX_DEVICE_RECORDS) {
    keys.sort((a, b) => memoryCache[a].updatedAt - memoryCache[b].updatedAt);
    for (let i = 0; i < keys.length - MAX_DEVICE_RECORDS; i++) {
      delete memoryCache[keys[i]];
    }
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryCache));
  } catch {
    // 忽略存储配额满等异常
  }
};
