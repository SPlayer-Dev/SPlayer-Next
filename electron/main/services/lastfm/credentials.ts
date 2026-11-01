import fs from "node:fs";
import path from "node:path";
import { writeFileSync as atomicWriteSync } from "atomically";
import { lastfmLog } from "@main/utils/logger";
import { configDir } from "@main/utils/paths";
import { decryptSecret, encryptSecret, isSecureStorageAvailable } from "@main/utils/secureStorage";

/** 凭证文件 */
const STORAGE_FILE = path.join(configDir, "lastfm.json");

/** 解密后的凭证 */
export interface LastfmCredentials {
  username: string;
  sessionKey: string;
}

/** 持久化形态 */
interface PersistedCredentials {
  username: string;
  encryptedSessionKey: string;
}

/** 加密会话密钥 */
const encrypt = async (plain: string): Promise<string> => {
  if (!plain) return "";
  if (!(await isSecureStorageAvailable())) {
    lastfmLog.warn("safeStorage 不可用，sessionKey 将以 base64 明文落盘");
    return Buffer.from(plain, "utf-8").toString("base64");
  }
  return (await encryptSecret(plain)).toString("base64");
};

/**
 * 解密会话密钥
 * @param encrypted - base64 密文
 * @returns 明文与是否需要重新加密
 */
const decrypt = async (
  encrypted: string,
): Promise<{ sessionKey: string; needsReEncrypt: boolean }> => {
  if (!encrypted) return { sessionKey: "", needsReEncrypt: false };
  try {
    const buf = Buffer.from(encrypted, "base64");
    if (!(await isSecureStorageAvailable())) {
      return { sessionKey: buf.toString("utf-8"), needsReEncrypt: false };
    }
    const { plainText, needsReEncrypt } = await decryptSecret(buf);
    return { sessionKey: plainText, needsReEncrypt };
  } catch {
    return { sessionKey: "", needsReEncrypt: false };
  }
};

/**
 * 读取本地凭证
 * @returns 凭证；不存在或损坏时返回 null
 */
export const load = async (): Promise<LastfmCredentials | null> => {
  try {
    const raw = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8")) as PersistedCredentials;
    const { sessionKey, needsReEncrypt } = await decrypt(raw.encryptedSessionKey);
    if (!raw.username || !sessionKey) return null;
    if (needsReEncrypt) await save(raw.username, sessionKey);
    return { username: raw.username, sessionKey };
  } catch {
    return null;
  }
};

/**
 * 保存凭证
 * @param username - 用户名
 * @param sessionKey - 会话密钥
 */
export const save = async (username: string, sessionKey: string): Promise<void> => {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data: PersistedCredentials = {
      username,
      encryptedSessionKey: await encrypt(sessionKey),
    };
    atomicWriteSync(STORAGE_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    lastfmLog.error("写入 lastfm.json 失败:", err);
  }
};

/** 清除凭证 */
export const clear = (): void => {
  try {
    if (fs.existsSync(STORAGE_FILE)) fs.rmSync(STORAGE_FILE);
  } catch (err) {
    lastfmLog.error("删除 lastfm.json 失败:", err);
  }
};
