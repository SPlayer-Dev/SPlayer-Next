/**
 * 流媒体服务器配置存储。
 * 复用主配置 store（settings.json）的 streaming 节，所有写盘走同一个原子写。
 */
import { randomUUID } from "node:crypto";
import type {
  StreamingServerConfig,
  StreamingServerInput,
  StreamingServerSummary,
} from "@shared/types/streaming";
import { encrypt } from "../services/streaming/auth";
import { store } from "./index";

/** 规范化服务器 URL：去掉尾斜杠 */
const normalizeUrl = (url: string): string => url.trim().replace(/\/+$/, "");

/** 读全部服务器（含加密密码） */
export const listConfigs = (): StreamingServerConfig[] => {
  return [...store.get("streaming.servers")];
};

/** 取单个 */
export const getConfig = (id: string): StreamingServerConfig | null => {
  return store.get("streaming.servers").find((s) => s.id === id) ?? null;
};

/** 转 summary（剥密码） */
export const toSummary = (cfg: StreamingServerConfig): StreamingServerSummary => ({
  id: cfg.id,
  name: cfg.name,
  type: cfg.type,
  url: cfg.url,
  username: cfg.username,
  hasToken: !!cfg.accessToken,
  lastConnected: cfg.lastConnected,
});

/** 整体回写（接受新数组引用，触发 store 写盘） */
const writeAll = (servers: StreamingServerConfig[]): void => {
  store.set("streaming.servers", servers);
};

/** 添加；password 必填，会立即加密后落盘 */
export const addConfig = (input: StreamingServerInput): StreamingServerConfig => {
  const cfg: StreamingServerConfig = {
    id: randomUUID(),
    name: input.name.trim(),
    type: input.type,
    url: normalizeUrl(input.url),
    username: input.username,
    passwordEncrypted: encrypt(input.password),
  };
  writeAll([...listConfigs(), cfg]);
  return cfg;
};

/**
 * 局部更新；password 字段为 undefined 时保留原密码。
 * 改动 URL/账号会清空 accessToken/userId（强制重新登录）。
 */
export const updateConfig = (
  id: string,
  patch: Partial<StreamingServerInput>,
): StreamingServerConfig | null => {
  const list = listConfigs();
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const old = list[idx];
  const credentialsChanged =
    (patch.url !== undefined && normalizeUrl(patch.url) !== old.url) ||
    (patch.username !== undefined && patch.username !== old.username) ||
    patch.password !== undefined;
  const next: StreamingServerConfig = {
    ...old,
    name: patch.name?.trim() ?? old.name,
    type: patch.type ?? old.type,
    url: patch.url !== undefined ? normalizeUrl(patch.url) : old.url,
    username: patch.username ?? old.username,
    passwordEncrypted:
      patch.password !== undefined ? encrypt(patch.password) : old.passwordEncrypted,
    accessToken: credentialsChanged ? undefined : old.accessToken,
    userId: credentialsChanged ? undefined : old.userId,
    lastConnected: old.lastConnected,
  };
  list[idx] = next;
  writeAll(list);
  return next;
};

/** 移除；如果是当前激活的服务器，激活 ID 一并清空 */
export const removeConfig = (id: string): boolean => {
  const list = listConfigs();
  const next = list.filter((s) => s.id !== id);
  if (next.length === list.length) return false;
  writeAll(next);
  if (store.get("streaming.activeServerId") === id) {
    store.set("streaming.activeServerId", null);
  }
  return true;
};

/** 内部：仅修改单条 config 的部分字段（accessToken/lastConnected 等运行时回填） */
export const patchConfig = (id: string, patch: Partial<StreamingServerConfig>): void => {
  const list = listConfigs();
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return;
  list[idx] = { ...list[idx], ...patch };
  writeAll(list);
};

/** 激活服务器 */
export const getActiveId = (): string | null => store.get("streaming.activeServerId");
export const setActiveId = (id: string | null): void => {
  if (id !== null && !getConfig(id)) return;
  store.set("streaming.activeServerId", id);
};
