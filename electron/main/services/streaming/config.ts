import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { streamingLog } from "@main/utils/logger";
import { configDir } from "@main/utils/paths";
import type {
  StreamingServerConfig,
  StreamingServerInput,
  StreamingRuntimeConfig,
} from "@shared/types/streaming";

const STORAGE_FILE = path.join(configDir, "streaming.json");

interface PersistedServer {
  id: string;
  name: string;
  type: StreamingServerConfig["type"];
  url: string;
  username: string;
  encryptedPassword: string;
  lastConnected?: number;
}

interface PersistedState {
  servers: PersistedServer[];
  activeServerId: string | null;
}

let state: PersistedState | undefined;

/**
 * 读取流媒体配置
 * @returns 内存中的完整配置
 */
const getState = (): PersistedState => {
  if (state) return state;
  try {
    const parsed = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8")) as PersistedState;
    state = Array.isArray(parsed?.servers)
      ? { servers: parsed.servers, activeServerId: parsed.activeServerId ?? null }
      : { servers: [], activeServerId: null };
  } catch {
    state = { servers: [], activeServerId: null };
  }
  return state;
};

/** 保存当前流媒体配置 */
const save = (): void => {
  const dir = path.dirname(STORAGE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  atomicWriteSync(STORAGE_FILE, JSON.stringify(getState(), null, 2));
};

/**
 * 加密服务器密码
 * @param password - 明文密码
 * @returns 加密内容
 */
const encryptPassword = (password: string): string => {
  if (!password) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    streamingLog.warn("系统安全存储不可用，流媒体密码将以 base64 形式保存");
    return Buffer.from(password, "utf-8").toString("base64");
  }
  return safeStorage.encryptString(password).toString("base64");
};

/**
 * 解密服务器密码
 * @param encrypted - 加密内容
 * @returns 明文密码
 */
const decryptPassword = (encrypted: string): string => {
  if (!encrypted) return "";
  const buffer = Buffer.from(encrypted, "base64");
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.decryptString(buffer)
    : buffer.toString("utf-8");
};

/**
 * 转换为 renderer 可见配置
 * @param server - 持久化配置
 * @returns 不含凭据的配置
 */
const toServerConfig = (server: PersistedServer): StreamingServerConfig => ({
  id: server.id,
  name: server.name,
  type: server.type,
  url: server.url,
  username: server.username,
  hasPassword: Boolean(server.encryptedPassword),
  lastConnected: server.lastConnected,
});

/**
 * 转换为主进程运行时配置
 * @param server - 持久化配置
 * @returns 包含凭据的配置
 */
const toRuntimeConfig = (server: PersistedServer): StreamingRuntimeConfig => ({
  ...toServerConfig(server),
  password: decryptPassword(server.encryptedPassword),
});

/**
 * 获取服务器列表和当前服务器
 * @returns renderer 可见配置状态
 */
export const getStreamingConfig = (): {
  servers: StreamingServerConfig[];
  activeServerId: string | null;
} => ({
  servers: getState().servers.map(toServerConfig),
  activeServerId: getState().activeServerId,
});

/**
 * 获取指定服务器的运行时配置
 * @param serverId - 服务器 ID
 * @returns 包含凭据的配置
 */
export const getStreamingServer = (serverId: string): StreamingRuntimeConfig => {
  const server = getState().servers.find((item) => item.id === serverId);
  if (!server) throw new Error("找不到流媒体服务器");
  return toRuntimeConfig(server);
};

/**
 * 新增服务器
 * @param input - 服务器表单
 * @returns 新服务器配置
 */
export const addStreamingServer = (input: StreamingServerInput): StreamingServerConfig => {
  const server: PersistedServer = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    type: input.type,
    url: input.url.trim().replace(/\/+$/, ""),
    username: input.username,
    encryptedPassword: encryptPassword(input.password),
  };
  getState().servers.push(server);
  save();
  return toServerConfig(server);
};

/**
 * 更新服务器
 * @param serverId - 服务器 ID
 * @param input - 服务器表单
 * @returns 更新后的服务器配置
 */
export const updateStreamingServer = (
  serverId: string,
  input: StreamingServerInput,
): StreamingServerConfig => {
  const server = getState().servers.find((item) => item.id === serverId);
  if (!server) throw new Error("找不到流媒体服务器");
  server.name = input.name.trim();
  server.type = input.type;
  server.url = input.url.trim().replace(/\/+$/, "");
  server.username = input.username;
  if (input.password) server.encryptedPassword = encryptPassword(input.password);
  server.lastConnected = undefined;
  save();
  return toServerConfig(server);
};

/**
 * 删除服务器
 * @param serverId - 服务器 ID
 */
export const removeStreamingServer = (serverId: string): void => {
  const current = getState();
  current.servers = current.servers.filter((server) => server.id !== serverId);
  if (current.activeServerId === serverId) current.activeServerId = null;
  save();
};

/**
 * 设置当前服务器
 * @param serverId - 服务器 ID
 */
export const setActiveStreamingServer = (serverId: string | null): void => {
  const current = getState();
  if (serverId && !current.servers.some((server) => server.id === serverId)) {
    throw new Error("找不到流媒体服务器");
  }
  current.activeServerId = serverId;
  save();
};

/**
 * 记录服务器连接成功
 * @param serverId - 服务器 ID
 * @returns 更新后的服务器配置
 */
export const markStreamingServerConnected = (serverId: string): StreamingServerConfig => {
  const server = getState().servers.find((item) => item.id === serverId);
  if (!server) throw new Error("找不到流媒体服务器");
  server.lastConnected = Date.now();
  save();
  return toServerConfig(server);
};

/**
 * 创建连接测试使用的临时配置
 * @param input - 服务器表单
 * @param serverId - 编辑中的服务器 ID
 * @returns 临时运行时配置
 */
export const createTestStreamingServer = (
  input: StreamingServerInput,
  serverId?: string,
): StreamingRuntimeConfig => {
  const saved = serverId ? getState().servers.find((server) => server.id === serverId) : undefined;
  const password = input.password || (saved ? decryptPassword(saved.encryptedPassword) : "");

  const base = {
    id: `__test__:${crypto.randomUUID()}`,
    name: input.name.trim(),
    url: input.url.trim().replace(/\/+$/, ""),
    username: input.username,
    password,
    hasPassword: Boolean(password),
  };

  return {
    ...base,
    type: input.type,
  };
};
