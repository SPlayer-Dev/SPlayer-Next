/**
 * AI 模型通用对话客户端
 *
 * 读取当前启用的模型配置，按协议调用 OpenAI 兼容接口或 Anthropic Messages 接口
 */

import { fetchWithProxy } from "@main/utils/proxy";
import type { AiRuntimeModel } from "./model";

/** 对话消息 */
export interface AiChatMessage {
  role: "system" | "user";
  content: string;
}

/** 单次请求超时 */
const REQUEST_TIMEOUT_MS = 90_000;

/**
 * 拼接接口地址
 * @param baseUrl - API 根地址
 * @param path - 接口路径
 * @returns 完整请求地址
 */
const joinUrl = (baseUrl: string, path: string): string => {
  const base = baseUrl.replace(/\/+$/, "");
  return base.endsWith(path) ? base : `${base}${path}`;
};

/**
 * 从 OpenAI 兼容响应中提取文本
 * @param body - 响应 JSON
 * @returns 模型输出文本
 */
const extractOpenAiContent = (body: unknown): string => {
  const content = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]
    ?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const text = (part as { text?: unknown })?.text;
        return typeof text === "string" ? text : "";
      })
      .join("");
  }
  throw new Error("AI 接口未返回内容");
};

/**
 * 从 Anthropic 响应中提取文本
 * @param body - 响应 JSON
 * @returns 模型输出文本
 */
const extractAnthropicContent = (body: unknown): string => {
  const content = (body as { content?: unknown })?.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const text = (part as { text?: unknown })?.text;
        return typeof text === "string" ? text : "";
      })
      .join("");
  }
  throw new Error("AI 接口未返回内容");
};

/**
 * 提取接口错误信息
 * @param body - 原始响应文本
 * @returns 便于展示的错误信息
 */
const extractErrorMessage = (body: string): string => {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string;
      message?: string;
    };
    const message =
      typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? parsed.message);
    if (message) return message;
  } catch {}
  return body.slice(0, 300);
};

/**
 * 发送一次非流式对话请求
 * @param model - 当前启用的模型配置
 * @param messages - 对话消息
 * @returns 模型输出文本
 */
export const chatCompletion = async (
  model: AiRuntimeModel,
  messages: AiChatMessage[],
): Promise<string> => {
  const isAnthropic = model.protocol === "anthropic";
  const url = joinUrl(model.baseUrl, isAnthropic ? "/messages" : "/chat/completions");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let payload: Record<string, unknown>;

  if (isAnthropic) {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    headers["x-api-key"] = model.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    payload = {
      model: model.model,
      max_tokens: 4096,
      system: system || undefined,
      messages: messages
        .filter((message) => message.role !== "system")
        .map(({ role, content }) => ({ role, content })),
    };
  } else {
    headers.Authorization = `Bearer ${model.apiKey}`;
    payload = { model: model.model, messages };
  }

  let response: Response;
  try {
    response = await fetchWithProxy(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("AI 接口请求超时");
    }
    throw error;
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`AI 接口请求失败（${response.status}）：${extractErrorMessage(text)}`);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("AI 接口返回了无法解析的响应");
  }
  return isAnthropic ? extractAnthropicContent(body) : extractOpenAiContent(body);
};
