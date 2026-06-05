/**
 * 流媒体相关 IPC：
 * - loadServers / saveServers：服务器配置持久化
 */
import fs from "node:fs";
import path from "node:path";
import { ipcMain, safeStorage } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { streamingLog } from "@main/utils/logger";
import { configDir } from "@main/utils/paths";
import type { StreamingServerConfig } from "@shared/types/streaming";

const STORAGE_FILE = path.join(configDir, "streaming.json");

/** 持久化形态：密码加密、accessToken/userId 不持久化（每次会话重新登录） */
interface PersistedServer extends Omit<
  StreamingServerConfig,
  "password" | "accessToken" | "userId"
> {
  encryptedPassword: string;
}

interface PersistedState {
  servers: PersistedServer[];
  activeServerId: string | null;
}

const readPersisted = (): PersistedState => {
  try {
    const raw = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8")) as PersistedState;
    if (!Array.isArray(raw?.servers)) return { servers: [], activeServerId: null };
    return { servers: raw.servers, activeServerId: raw.activeServerId ?? null };
  } catch {
    return { servers: [], activeServerId: null };
  }
};

const writePersisted = (data: PersistedState): void => {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    atomicWriteSync(STORAGE_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    streamingLog.error("写入 streaming.json 失败:", err);
  }
};

/**
 * 加密密码
 * @param plain 明文密码
 * @returns 加密后的密码
 */
const encryptPassword = (plain: string): string => {
  if (!plain) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(plain, "utf-8").toString("base64");
  }
  return safeStorage.encryptString(plain).toString("base64");
};

/**
 * 解密密码
 * @param encrypted 加密后的密码
 * @returns 明文密码
 */
const decryptPassword = (encrypted: string): string => {
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

export const registerStreamingIpc = (): void => {
  ipcMain.handle("streaming:loadServers", () => {
    const persisted = readPersisted();
    const servers: StreamingServerConfig[] = persisted.servers.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      url: s.url,
      username: s.username,
      password: decryptPassword(s.encryptedPassword),
      lastConnected: s.lastConnected,
    }));
    return { servers, activeServerId: persisted.activeServerId };
  });

  ipcMain.handle(
    "streaming:saveServers",
    (_e, payload: { servers: StreamingServerConfig[]; activeServerId: string | null }): void => {
      const servers: PersistedServer[] = (payload?.servers ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        url: s.url,
        username: s.username,
        encryptedPassword: encryptPassword(s.password),
        lastConnected: s.lastConnected,
      }));
      writePersisted({ servers, activeServerId: payload?.activeServerId ?? null });
    },
  );
};
