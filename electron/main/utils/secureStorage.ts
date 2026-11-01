import { safeStorage } from "electron";

/**
 * 判断异步安全存储是否可用
 * @returns 是否可用
 */
export const isSecureStorageAvailable = (): Promise<boolean> =>
  safeStorage.isAsyncEncryptionAvailable();

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
