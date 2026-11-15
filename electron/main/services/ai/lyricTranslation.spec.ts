// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cache: new Map<string, string[]>(),
  chat: vi.fn(),
}));

vi.mock("./client", () => ({ chatCompletion: state.chat }));
vi.mock("./model", () => ({
  getActiveAiModel: async () => ({
    id: "test-model",
    name: "Test",
    protocol: "openai-compatible",
    baseUrl: "https://example.com/v1",
    model: "test",
    apiKey: "key",
  }),
}));
vi.mock("@main/database/lyricAiTranslation", () => ({
  getLyricAiTranslation: (key: string) => state.cache.get(key) ?? null,
  setLyricAiTranslation: (key: string, value: string[]) => {
    state.cache.set(key, value);
  },
}));
vi.mock("@main/utils/logger", () => ({ coreLog: { warn: vi.fn() } }));

import { chunkLines, parseTranslationArray, translateLyrics } from "./lyricTranslation";

/**
 * 从提示词中提取歌词数组并生成译文
 * @param _model - 模型配置
 * @param messages - 对话消息
 * @returns 模型输出
 */
const echoChat = async (_model: unknown, messages: { content: string }[]): Promise<string> => {
  const text = messages[messages.length - 1].content;
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  const lines = JSON.parse(text.slice(start, end + 1)) as string[];
  return JSON.stringify(lines.map((line) => `译:${line}`));
};

describe("LLM 歌词翻译", () => {
  beforeEach(() => {
    state.cache.clear();
    state.chat.mockReset();
    state.chat.mockImplementation(echoChat);
  });

  it("解析带代码块与说明文字的数组", () => {
    expect(parseTranslationArray('```json\n["甲","乙"]\n```', 2)).toEqual(["甲", "乙"]);
    expect(parseTranslationArray('结果如下：\n["甲","乙"]\n以上。', 2)).toEqual(["甲", "乙"]);
    expect(parseTranslationArray('{"translations":["甲","乙"]}', 2)).toEqual(["甲", "乙"]);
    expect(parseTranslationArray('["甲"]', 2)).toBeNull();
  });

  it("按行数与字符数拆分歌词", () => {
    const lines = Array.from({ length: 51 }, (_, index) => `line-${index}`);
    const chunks = chunkLines(lines);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(50);
    expect(chunks[1]).toEqual(["line-50"]);
  });

  it("逐行返回译文并复用缓存", async () => {
    const request = {
      lines: ["hello", "world"],
      targetLanguage: "zh-CN" as const,
      track: { title: "Song", artists: ["Artist"] },
    };
    expect(await translateLyrics(request)).toEqual(["译:hello", "译:world"]);
    expect(state.chat).toHaveBeenCalledTimes(1);
    expect(await translateLyrics(request)).toEqual(["译:hello", "译:world"]);
    expect(state.chat).toHaveBeenCalledTimes(1);
  });

  it("行数不一致时重试一次", async () => {
    state.chat.mockImplementationOnce(async (_model: unknown, messages: { content: string }[]) => {
      const text = messages[messages.length - 1].content;
      const start = text.indexOf("[");
      const end = text.lastIndexOf("]");
      const lines = JSON.parse(text.slice(start, end + 1)) as string[];
      return JSON.stringify(lines.slice(1).map((line) => `译:${line}`));
    });
    const result = await translateLyrics({
      lines: ["a", "b", "c"],
      targetLanguage: "ja-JP",
    });
    expect(result).toEqual(["译:a", "译:b", "译:c"]);
    expect(state.chat).toHaveBeenCalledTimes(2);
  });
});
