/**
 * LLM 歌词翻译
 *
 * 收集当前歌词中缺失译文的主行，交给主进程 AI 模型翻译后写回解析结果
 */

import type { LyricLine } from "lyric-kit";
import type { LyricTranslationLanguage } from "@shared/types/lyrics";

import i18n from "@/i18n";
import { toast } from "@/composables/useToast";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";

/** 当前是否正在翻译 */
const translating = ref(false);

/** 自动翻译延迟，等待歌词来源稳定后再请求 */
const AUTO_TRANSLATE_DELAY_MS = 2000;

/** 自动翻译定时器 */
let autoTimer: ReturnType<typeof setTimeout> | null = null;

/** 最近一次已触发的自动翻译快照，避免同一份歌词重复请求 */
let lastAutoSnapshot = "";

/** 自动翻译请求进行中时收到的新请求 */
let pendingAuto = false;

/** 最近一次写入译文的语言 */
let lastTranslatedTarget: LyricTranslationLanguage | null = null;

/**
 * 重置自动翻译调度状态
 *
 * 切歌或歌词重新加载时调用，确保相同歌词也能重新应用缓存译文
 */
export const resetAutoLyricTranslation = (): void => {
  lastAutoSnapshot = "";
  pendingAuto = false;
  if (autoTimer) {
    clearTimeout(autoTimer);
    autoTimer = null;
  }
};

/**
 * 解析目标语言
 * @returns 设置中的固定语言，auto 时跟随界面语言
 */
const resolveTargetLanguage = (): LyricTranslationLanguage => {
  const settings = useSettingsStore();
  if (settings.lyric.llmTranslationTarget !== "auto") {
    return settings.lyric.llmTranslationTarget;
  }
  return settings.locale === "en-US" ? "en-US" : "zh-CN";
};

/**
 * 读取歌词行的纯文本
 * @param line - 歌词行
 * @returns 拼接后的行文本
 */
const lineText = (line: LyricLine): string =>
  line.words
    .map((word) => word.word)
    .join("")
    .trim();

/**
 * 判断歌词行是否需要翻译
 * @param line - 歌词行
 * @returns 无译文且包含可翻译文字时返回 true
 */
const needsTranslation = (line: LyricLine): boolean => {
  if (line.isBG) return false;
  const text = lineText(line);
  if (!text || !/\p{L}/u.test(text)) return false;
  return !line.translatedLyric?.trim();
};

/**
 * 生成歌词快照标识
 * @param lines - 歌词行
 * @param target - 目标语言
 * @returns 用于去重的快照字符串
 */
const snapshotKey = (lines: LyricLine[], target: LyricTranslationLanguage): string =>
  `${target}\u0000${lines.map((line) => `${line.startTime}:${lineText(line)}`).join("\n")}`;

/**
 * 翻译当前歌词中缺失的译文
 * @param notify - 是否通过 toast 提示结果，自动翻译时传 false
 */
export const translateCurrentLyric = async (notify = true): Promise<void> => {
  if (translating.value) {
    if (!notify) pendingAuto = true;
    return;
  }
  const media = useMediaStore();
  const track = media.track;

  const targetLanguage = resolveTargetLanguage();
  // 目标语言变了，先移除上一语言的 LLM 译文再重新收集
  if (lastTranslatedTarget && lastTranslatedTarget !== targetLanguage) {
    media.clearLyricTranslation();
  }

  const indices: number[] = [];
  const texts: string[] = [];
  media.parsedLyric.forEach((line, index) => {
    if (!needsTranslation(line)) return;
    indices.push(index);
    texts.push(lineText(line));
  });

  if (!track || indices.length === 0) {
    if (notify) toast.info(i18n.global.t("player.lyricTranslate.empty"));
    return;
  }

  const snapshot = media.parsedLyric;
  translating.value = true;
  try {
    const response = await window.api.lyrics.translate({
      lines: texts,
      targetLanguage,
      track: {
        title: track.title,
        artists: track.artists.map((artist) => artist.name),
        album: track.album?.name,
      },
    });
    if (!response.ok) throw new Error(response.error);
    if (useMediaStore().track !== track) return;
    const applied = useMediaStore().applyLyricTranslation(snapshot, indices, response.data);
    if (applied) lastTranslatedTarget = targetLanguage;
    if (notify) {
      if (applied) toast.success(i18n.global.t("player.lyricTranslate.success"));
      else toast.info(i18n.global.t("player.lyricTranslate.stale"));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (notify) {
      toast.error(i18n.global.t("player.lyricTranslate.failed", { error: message }));
    } else {
      lastAutoSnapshot = "";
      console.warn("[lyricTranslate] auto translation failed:", err);
    }
  } finally {
    translating.value = false;
    if (pendingAuto) {
      pendingAuto = false;
      lastAutoSnapshot = "";
      scheduleAutoLyricTranslation();
    }
  }
};

/**
 * 歌词加载完成后按设置触发自动翻译
 */
export const scheduleAutoLyricTranslation = (): void => {
  const settings = useSettingsStore();
  if (!settings.lyric.llmTranslation || !settings.lyric.llmTranslationAuto) {
    lastAutoSnapshot = "";
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
    return;
  }

  const lines = useMediaStore().parsedLyric;
  if (lines.length === 0 || !lines.some(needsTranslation)) return;

  const key = snapshotKey(lines, resolveTargetLanguage());
  if (key === lastAutoSnapshot) {
    if (translating.value) pendingAuto = true;
    return;
  }
  lastAutoSnapshot = key;

  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    autoTimer = null;
    const current = useSettingsStore();
    if (!current.lyric.llmTranslation || !current.lyric.llmTranslationAuto) return;
    if (translating.value) pendingAuto = true;
    else void translateCurrentLyric(false);
  }, AUTO_TRANSLATE_DELAY_MS);
};

/** 歌词翻译状态与手动入口 */
export const useLyricTranslation = () => ({
  translating,
  translateCurrentLyric,
});
