import { safeStorage } from "electron";
import type { SecretStorageBackend, SecretStorageStatus } from "@shared/types/secureStorage";

/** 加密凭据的存储版本前缀 */
export const SECRET_VERSION_PREFIX = "safe:v1:";

/**
 * 判断异步安全存储是否可用
 * @returns 是否可用
 */
export const isSecureStorageAvailable = async (): Promise<boolean> => {
  try {
    return await safeStorage.isAsyncEncryptionAvailable();
  } catch {
    return false;
  }
};

/**
 * 读取当前安全存储后端
 * @returns 后端名称
 */
export const getSecretStorageBackend = (): SecretStorageBackend => {
  if (process.platform === "win32") return "dpapi";
  if (process.platform === "darwin") return "keychain";
  if (process.platform !== "linux") return "unknown";
  try {
    return safeStorage.getSelectedStorageBackend() as SecretStorageBackend;
  } catch {
    return "unknown";
  }
};

/**
 * 读取安全存储状态，basic_text 仍可用于混淆保存但强度不足
 * @returns 安全存储能力
 */
export const getSecretStorageStatus = async (): Promise<SecretStorageStatus> => {
  const backend = getSecretStorageBackend();
  return {
    available: await isSecureStorageAvailable(),
    weak: backend === "basic_text",
    backend,
  };
};

/**
 * 加密文本
 * @param plainText - 明文
 * @returns 加密后的字节
 */
export const encryptSecret = (plainText: string): Promise<Buffer> =>
  safeStorage.encryptStringAsync(plainText);

/**
 * 解密文本并返回系统是否需要重新加密
 * @param encrypted - 加密字节
 * @returns 明文与重新加密标记
 */
export const decryptSecret = async (
  encrypted: Buffer,
): Promise<{ plainText: string; needsReEncrypt: boolean }> => {
  const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(encrypted);
  return { plainText: result, needsReEncrypt: shouldReEncrypt };
};

/**
 * 解密 1.1.0 使用的同步 safeStorage 密文
 * @param encrypted - 加密字节
 * @returns 明文，无法解密时返回 null
 */
export const decryptLegacySecret = (encrypted: Buffer): string | null => {
  try {
    const text = safeStorage.decryptString(encrypted);
    return isPlainText(text) ? text : null;
  } catch {
    return null;
  }
};

/**
 * 严格解码 base64，避免 Buffer 忽略非法字符后得到空内容
 * @param value - base64 文本
 * @returns 解码结果，格式非法时返回 null
 */
export const decodeBase64 = (value: string): Buffer | null => {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  return Buffer.from(value, "base64");
};

/**
 * 把明文加密为带版本前缀的存储字符串
 * @param plainText - 明文
 * @returns safe:v1 存储字符串
 */
export const encodeSecret = async (plainText: string): Promise<string> =>
  `${SECRET_VERSION_PREFIX}${(await encryptSecret(plainText)).toString("base64")}`;

/**
 * 解析带版本前缀的存储字符串
 * @param stored - 持久化字符串
 * @returns 密文字节，没有版本前缀或内容损坏时返回 null
 */
export const decodeSecretPayload = (stored: string): Buffer | null => {
  if (!stored.startsWith(SECRET_VERSION_PREFIX)) return null;
  return decodeBase64(stored.slice(SECRET_VERSION_PREFIX.length));
};

/**
 * 判断文本是否可能是明文凭据
 * @param text - 待检查文本
 * @returns 是否可能为明文
 */
export const isPlainText = (text: string): boolean =>
  text.length > 0 &&
  text.length <= 4096 &&
  !text.includes("\uFFFD") &&
  ![...text].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return (
      code <= 0x08 ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f
    );
  });

/**
 * 判断字节是否可能是明文凭据
 * 旧版本会把 base64 明文直接落盘，密文字节通常无法通过严格 UTF-8 和控制字符检查
 * @param buffer - 待检查字节
 * @returns 合法明文，否则返回 null
 */
export const decodePlainText = (buffer: Buffer): string | null => {
  if (buffer.length === 0 || buffer.length > 4096) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return isPlainText(text) ? text : null;
  } catch {
    return null;
  }
};
