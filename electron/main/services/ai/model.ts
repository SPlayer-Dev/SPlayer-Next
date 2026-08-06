import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { safeStorage } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { configDir } from "@main/utils/paths";
import { ipcLog } from "@main/utils/logger";
import type {
  AiModelConfig,
  AiModelProtocol,
  AiModelSaveInput,
  AiModelState,
} from "@shared/types/ai";

const STORAGE_FILE = path.join(configDir, "ai-models.json");

interface PersistedAiModel {
  id: string;
  name: string;
  protocol: AiModelProtocol;
  baseUrl: string;
  model: string;
  encryptedApiKey: string;
}

interface PersistedAiModelState {
  models: PersistedAiModel[];
  activeModelId: string | null;
}

const emptyState = (): PersistedAiModelState => ({ models: [], activeModelId: null });

const readPersisted = (): PersistedAiModelState => {
  try {
    const raw = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8")) as PersistedAiModelState;
    if (!Array.isArray(raw?.models)) return emptyState();
    const activeModelId = raw.models.some((model) => model.id === raw.activeModelId)
      ? raw.activeModelId
      : null;
    return { models: raw.models, activeModelId };
  } catch {
    return emptyState();
  }
};

const writePersisted = (state: PersistedAiModelState): void => {
  try {
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    atomicWriteSync(STORAGE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    ipcLog.error("写入 AI 模型配置失败:", error);
    throw new Error("AI 模型配置保存失败");
  }
};

const encryptApiKey = (apiKey: string): string => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("系统安全存储不可用，无法保存 API Key");
  }
  return safeStorage.encryptString(apiKey).toString("base64");
};

const toPublicState = (state: PersistedAiModelState): AiModelState => ({
  activeModelId: state.activeModelId,
  models: state.models.map<AiModelConfig>((model) => ({
    id: model.id,
    name: model.name,
    protocol: model.protocol,
    baseUrl: model.baseUrl,
    model: model.model,
    hasApiKey: Boolean(model.encryptedApiKey),
  })),
});

const normalizeInput = (input: AiModelSaveInput): Omit<AiModelSaveInput, "id" | "apiKey"> => {
  const name = input.name?.trim();
  const baseUrl = input.baseUrl?.trim().replace(/\/+$/, "");
  const model = input.model?.trim();
  if (!name || !model || !/^https?:\/\//i.test(baseUrl)) {
    throw new Error("请填写有效的模型名称、API 地址和模型 ID");
  }
  if (input.protocol !== "openai-compatible" && input.protocol !== "anthropic") {
    throw new Error("不支持的 AI 模型协议");
  }
  return { name, protocol: input.protocol, baseUrl, model };
};

/**
 * 获取 AI 模型配置
 * @returns 不包含密钥明文的模型配置
 */
export const listAiModels = (): AiModelState => toPublicState(readPersisted());

/**
 * 保存 AI 模型配置
 * @param input - 模型配置输入
 * @returns 保存后的模型配置状态
 */
export const saveAiModel = (input: AiModelSaveInput): AiModelState => {
  const state = readPersisted();
  const normalized = normalizeInput(input);
  const existing = input.id ? state.models.find((item) => item.id === input.id) : undefined;
  if (input.id && !existing) throw new Error("AI 模型配置不存在");

  const encryptedApiKey = input.apiKey?.trim()
    ? encryptApiKey(input.apiKey.trim())
    : (existing?.encryptedApiKey ?? "");
  if (!encryptedApiKey) throw new Error("请填写 API Key");

  const saved: PersistedAiModel = {
    id: existing?.id ?? randomUUID(),
    ...normalized,
    encryptedApiKey,
  };
  if (existing) state.models.splice(state.models.indexOf(existing), 1, saved);
  else state.models.push(saved);
  if (!state.activeModelId) state.activeModelId = saved.id;
  writePersisted(state);
  return toPublicState(state);
};

/**
 * 删除 AI 模型配置
 * @param id - 本地配置 ID
 * @returns 删除后的模型配置状态
 */
export const removeAiModel = (id: string): AiModelState => {
  const state = readPersisted();
  state.models = state.models.filter((model) => model.id !== id);
  if (state.activeModelId === id) state.activeModelId = null;
  writePersisted(state);
  return toPublicState(state);
};

/**
 * 设置当前使用的 AI 模型
 * @param id - 本地配置 ID，传入 null 表示不启用模型
 * @returns 更新后的模型配置状态
 */
export const setActiveAiModel = (id: string | null): AiModelState => {
  const state = readPersisted();
  if (id !== null && !state.models.some((model) => model.id === id)) {
    throw new Error("AI 模型配置不存在");
  }
  state.activeModelId = id;
  writePersisted(state);
  return toPublicState(state);
};
