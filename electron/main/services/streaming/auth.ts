import { safeStorage } from "electron";
import { streamingLog as log } from "../../utils/logger";

/**
 * 安全存储是否可用。Linux 在没有 keyring 时会返回 false。
 * 不可用时退化为 base64 明文（仍可正常工作，但相当于明文）。
 */
let availabilityCache: boolean | null = null;
const isAvailable = (): boolean => {
  if (availabilityCache !== null) return availabilityCache;
  try {
    availabilityCache = safeStorage.isEncryptionAvailable();
    if (!availabilityCache) {
      log.warn("safeStorage 不可用，密码将以 base64 形式存储（非加密）");
    }
  } catch (err) {
    log.warn("safeStorage 探测失败，退化为 base64", err);
    availabilityCache = false;
  }
  return availabilityCache;
};

/** 加密前缀，用于区分加密内容和 base64 fallback */
const ENC_PREFIX = "enc:";
const RAW_PREFIX = "raw:";

/** 把明文密码加密为可入库的字符串 */
export const encrypt = (plain: string): string => {
  if (!plain) return "";
  if (isAvailable()) {
    try {
      const buf = safeStorage.encryptString(plain);
      return `${ENC_PREFIX}${buf.toString("base64")}`;
    } catch (err) {
      log.error("加密失败，退化为 base64", err);
    }
  }
  return `${RAW_PREFIX}${Buffer.from(plain, "utf8").toString("base64")}`;
};

/** 还原密码；解密失败时返回空串 */
export const decrypt = (stored: string): string => {
  if (!stored) return "";
  if (stored.startsWith(ENC_PREFIX)) {
    try {
      const buf = Buffer.from(stored.slice(ENC_PREFIX.length), "base64");
      return safeStorage.decryptString(buf);
    } catch (err) {
      log.error("解密失败", err);
      return "";
    }
  }
  if (stored.startsWith(RAW_PREFIX)) {
    try {
      return Buffer.from(stored.slice(RAW_PREFIX.length), "base64").toString("utf8");
    } catch {
      return "";
    }
  }
  // 兼容裸字符串（不应出现，安全兜底）
  return stored;
};
