import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { lastfmLog } from "@main/utils/logger";

/** 凭证文件 */
const STORAGE_FILE = path.join(app.getPath("userData"), "lastfm.json");

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
const encrypt = (plain: string): string => {
  if (!plain) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    lastfmLog.warn("safeStorage 不可用，sessionKey 将以 base64 明文落盘");
    return Buffer.from(plain, "utf-8").toString("base64");
  }
  return safeStorage.encryptString(plain).toString("base64");
};

/** 解密会话密钥 */
const decrypt = (encrypted: string): string => {
  if (!encrypted) return "";
  try {
    const buf = Buffer.from(encrypted, "base64");
    if (!safeStorage.isEncryptionAvailable()) {
      return buf.toString("utf-8");
    }
    return safeStorage.decryptString(buf);
  } catch {
    return "";
  }
};

/**
 * 读取本地凭证
 * @returns 凭证；不存在或损坏时返回 null
 */
export const load = (): LastfmCredentials | null => {
  try {
    const raw = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8")) as PersistedCredentials;
    const sessionKey = decrypt(raw.encryptedSessionKey);
    if (!raw.username || !sessionKey) return null;
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
export const save = (username: string, sessionKey: string): void => {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data: PersistedCredentials = {
      username,
      encryptedSessionKey: encrypt(sessionKey),
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
