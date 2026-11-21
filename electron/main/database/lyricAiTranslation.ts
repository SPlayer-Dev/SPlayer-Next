/**
 * LLM 歌词翻译缓存
 *
 * 表：lyric_ai_translation(cache_key PK, data JSON, created_at)
 * - cache_key 由模型配置、目标语言和歌词原文共同决定，模型变化后自然失效
 * - 歌词译文体积小，保留最近若干条即可，避免长期播放不断累积
 */

import { getDb } from "./index";

/** 最多保留的翻译条数 */
const MAX_ROWS = 5000;

/**
 * 读取歌词翻译缓存
 * @param cacheKey - 翻译内容指纹
 * @returns 与输入行一一对应的译文，未命中或数据损坏时返回 null
 */
export const getLyricAiTranslation = (cacheKey: string): string[] | null => {
  const row = getDb()
    .prepare("SELECT data FROM lyric_ai_translation WHERE cache_key = ?")
    .get(cacheKey) as { data: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.data) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) return null;
    return parsed;
  } catch {
    return null;
  }
};

/**
 * 写入歌词翻译缓存并清理旧记录
 * @param cacheKey - 翻译内容指纹
 * @param translations - 与输入行一一对应的译文
 */
export const setLyricAiTranslation = (cacheKey: string, translations: string[]): void => {
  const db = getDb();
  db.prepare(
    `INSERT INTO lyric_ai_translation (cache_key, data, created_at) VALUES (?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       data = excluded.data,
       created_at = excluded.created_at`,
  ).run(cacheKey, JSON.stringify(translations), Date.now());
  db.prepare(
    `DELETE FROM lyric_ai_translation WHERE cache_key NOT IN (
       SELECT cache_key FROM lyric_ai_translation ORDER BY created_at DESC LIMIT ?
     )`,
  ).run(MAX_ROWS);
};

/** 清空全部 LLM 歌词翻译缓存 */
export const clearLyricAiTranslation = (): void => {
  getDb().prepare("DELETE FROM lyric_ai_translation").run();
};
