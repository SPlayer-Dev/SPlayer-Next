import { ErrorCode } from "@shared/types/errors";

/** 从原始错误信息推断错误码 */
export const classifyError = (error: unknown): ErrorCode => {
  const msg = String(error).toLowerCase();

  // 设备相关
  if (msg.includes("nodevice") || msg.includes("no device") || msg.includes("device not found")) {
    return ErrorCode.DEVICE_NOT_FOUND;
  }
  if (msg.includes("device") || msg.includes("output") || msg.includes("stream")) {
    return ErrorCode.DEVICE_INIT_FAILED;
  }

  // 文件相关
  if (msg.includes("no audio stream")) {
    return ErrorCode.FILE_NO_AUDIO_STREAM;
  }
  if (msg.includes("no such file") || msg.includes("not found") || msg.includes("failed to open")) {
    if (msg.includes("http://") || msg.includes("https://")) {
      return ErrorCode.NETWORK_ERROR;
    }
    return ErrorCode.FILE_NOT_FOUND;
  }
  if (msg.includes("decode") || msg.includes("codec") || msg.includes("invalid data")) {
    return ErrorCode.FILE_DECODE_ERROR;
  }

  // 网络相关
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return ErrorCode.NETWORK_TIMEOUT;
  }
  if (msg.includes("network") || msg.includes("connection") || msg.includes("eof")) {
    return ErrorCode.NETWORK_ERROR;
  }

  return ErrorCode.UNKNOWN;
};

/** 是否为需要重建播放器实例的设备错误 */
export const isDeviceError = (code: ErrorCode): boolean => {
  return code === ErrorCode.DEVICE_NOT_FOUND || code === ErrorCode.DEVICE_INIT_FAILED;
};
