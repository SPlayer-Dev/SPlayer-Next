/**
 * LLM 歌词翻译
 *
 * 把歌词行分批交给当前启用的 AI 模型，要求按相同顺序返回 JSON 字符串数组
 */

import { createHash } from "node:crypto";
import type { LyricTranslationLanguage, LyricTranslationRequest } from "@shared/types/lyrics";
import { getLyricAiTranslation, setLyricAiTranslation } from "@main/database/lyricAiTranslation";
import { coreLog } from "@main/utils/logger";
import { chatCompletion, type AiChatMessage } from "./client";
import { getActiveAiModel, type AiRuntimeModel } from "./model";

/** 单次请求的最大歌词行数 */
const MAX_LINES_PER_REQUEST = 50;

/** 单次请求的最大原文字符数 */
const MAX_CHARS_PER_REQUEST = 4000;

/** 提示词版本，调整翻译提示词时递增以失效旧缓存 */
const PROMPT_VERSION = 1;

/** 目标语言显示名称 */
const LANGUAGE_NAMES: Record<LyricTranslationLanguage, string> = {
  "zh-CN": "简体中文",
  "en-US": "English",
  "ja-JP": "日本語",
  "ko-KR": "한국어",
};

/** 进行中的翻译请求，避免同一份歌词重复计费 */
const inflight = new Map<string, Promise<string[]>>();

/**
 * 校验目标语言
 * @param value - 渲染端传入的语言
 * @returns 受支持的语言，非法值回退为简体中文
 */
const normalizeLanguage = (value: unknown): LyricTranslationLanguage =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(LANGUAGE_NAMES, value)
    ? (value as LyricTranslationLanguage)
    : "zh-CN";

/**
 * 按行数和字符数拆分歌词
 * @param lines - 原始歌词行
 * @returns 分批后的歌词行
 */
export const chunkLines = (lines: string[]): string[][] => {
  const chunks: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const line of lines) {
    if (
      current.length >= MAX_LINES_PER_REQUEST ||
      (current.length > 0 && chars + line.length > MAX_CHARS_PER_REQUEST)
    ) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(line);
    chars += line.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
};

/**
 * 生成缓存与去重键
 * @param model - 当前模型配置
 * @param request - 翻译请求
 * @returns SHA-256 指纹
 */
const buildCacheKey = (model: AiRuntimeModel, request: LyricTranslationRequest): string =>
  createHash("sha256")
    .update(
      [
        model.id,
        model.protocol,
        model.baseUrl,
        model.model,
        `v${PROMPT_VERSION}`,
        request.targetLanguage,
        request.lines.join("\u0000"),
      ].join("\u0000"),
    )
    .digest("hex");

/**
 * 构造翻译提示词
 * @param lines - 本批歌词行
 * @param request - 翻译请求
 * @param retry - 是否为重试，重试时追加更严格的格式要求
 * @returns 对话消息
 */
const buildMessages = (
  lines: string[],
  request: LyricTranslationRequest,
  retry: boolean,
): AiChatMessage[] => {
  const title = request.track?.title?.trim();
  const artists = request.track?.artists?.filter(Boolean).join(" / ");
  const album = request.track?.album?.trim();
  const context = [
    title ? `歌曲：${title}` : "",
    artists ? `歌手：${artists}` : "",
    album ? `专辑：${album}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const system = [
    "你是一名专业的音乐歌词翻译，擅长保留原歌词的语气、情感和文化语境。",
    `请把输入数组中的每一行歌词翻译成${LANGUAGE_NAMES[normalizeLanguage(request.targetLanguage)]}。`,
    "保留原意，不要合并、拆分行，不要遗漏任何一行。",
    "只输出一个 JSON 字符串数组，元素数量必须与输入数组完全一致。",
    "无法翻译、为空或是纯器乐符号的行输出空字符串。",
    "不要输出解释、标题、Markdown 代码块或多余文字。",
  ].join("\n");

  const user = [
    context ? `歌曲信息：\n${context}` : "",
    "输入歌词（JSON 数组）：",
    JSON.stringify(lines),
    `请输出恰好 ${lines.length} 个字符串。`,
    retry ? "上一次输出的数组长度不一致，这次请务必逐行对应，不要合并或省略。" : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
};

/**
 * 规范化模型返回的数组
 * @param value - 已解析的 JSON 值
 * @returns 字符串数组，结构不合法时返回 null
 */
const normalizeEntries = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  return value.map((item) => {
    if (typeof item === "string") return item.replace(/\r?\n+/g, " ").trim();
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const text = record.translation ?? record.text ?? record.value;
      if (typeof text === "string") return text.replace(/\r?\n+/g, " ").trim();
    }
    return "";
  });
};

/**
 * 从模型输出中解析译文数组
 * @param content - 模型输出文本
 * @param expected - 期望的行数
 * @returns 行数匹配的译文数组，否则返回 null
 */
export const parseTranslationArray = (content: string, expected: number): string[] | null => {
  const text = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const candidates: unknown[] = [];

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      candidates.push(JSON.parse(text.slice(start, end + 1)));
    } catch {}
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      candidates.push(record.translations ?? record.result ?? record.data);
    }
  } catch {}

  for (const candidate of candidates) {
    const entries = normalizeEntries(candidate);
    if (entries?.length === expected) return entries;
  }
  return null;
};

/**
 * 请求单个批次并做一次格式重试
 * @param model - 当前模型配置
 * @param lines - 本批歌词行
 * @param request - 翻译请求
 * @returns 与输入行一一对应的译文
 */
const requestChunk = async (
  model: AiRuntimeModel,
  lines: string[],
  request: LyricTranslationRequest,
): Promise<string[]> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = await chatCompletion(model, buildMessages(lines, request, attempt > 0));
    const parsed = parseTranslationArray(content, lines.length);
    if (parsed) return parsed;
    coreLog.warn(`[aiLyric] 模型返回行数与输入不一致，attempt=${attempt + 1}`);
  }
  throw new Error("AI 返回的翻译行数与歌词不一致，请重试");
};

/**
 * 翻译歌词
 * @param request - 歌词行、目标语言与歌曲上下文
 * @returns 与输入行一一对应的译文
 */
export const translateLyrics = async (request: LyricTranslationRequest): Promise<string[]> => {
  if (!request || !Array.isArray(request.lines)) {
    throw new Error("歌词内容无效");
  }
  const lines = request.lines
    .filter((line): line is string => typeof line === "string")
    .slice(0, 500);
  if (lines.length === 0) return [];

  const model = await getActiveAiModel();
  if (!model) throw new Error("尚未启用 AI 模型，请先在设置中配置并启用");

  const normalizedRequest: LyricTranslationRequest = {
    ...request,
    lines,
    targetLanguage: normalizeLanguage(request.targetLanguage),
  };
  const cacheKey = buildCacheKey(model, normalizedRequest);
  const cached = getLyricAiTranslation(cacheKey);
  if (cached) return cached;

  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const task = (async (): Promise<string[]> => {
    const result: string[] = [];
    for (const chunk of chunkLines(lines)) {
      result.push(...(await requestChunk(model, chunk, normalizedRequest)));
    }
    setLyricAiTranslation(cacheKey, result);
    return result;
  })();

  inflight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    if (inflight.get(cacheKey) === task) inflight.delete(cacheKey);
  }
};
