import type { Platform } from "./platform";
import type { Track } from "./player";
import type { LyricFormat, LyricInput } from "lyric-kit";

/** 默认格式优先级 */
export const DEFAULT_LYRIC_FORMAT_ORDER: readonly LyricFormat[] = [
  "ttml",
  "lys",
  "qrc",
  "krc",
  "yrc",
  "lrc",
  "ass",
  "srt",
];

/** 歌词来源 */
export type LyricSource = "external" | "embedded" | "online";

/** 歌词数据 */
export type LyricData = {
  source: LyricSource;
  format: LyricFormat;
  /** 本次解析结果是否具有真实或统一生成的逐字时间 */
  wordTimed?: boolean;
  /** 在线歌词所属平台，仅 source=online 时有值 */
  platform?: Platform;
  /** 与基准比较得出的时间校正量，解析后加到歌词时间上 */
  timeShiftMs?: number;
} | null;

/** 平台额外字段 */
export interface LyricMatchExtra {
  /** QM 的 mid */
  mid?: string;
}

/** 歌词匹配结果 */
export interface LyricMatchResult extends LyricInput {
  platform: Platform;
  /** 主歌词格式 */
  format: LyricFormat;
  /** 平台额外字段，netease/kugou 暂未使用 */
  extra?: LyricMatchExtra;
}

/** 歌词匹配 IPC 响应 */
export type LyricMatchResponse =
  { ok: true; data: LyricMatchResult | null } | { ok: false; error: string };

/** TTML 抓取 IPC 响应 */
export type LyricTTMLResponse = { ok: true; data: string | null } | { ok: false; error: string };

/** 渲染端歌词匹配入口 */
export interface LyricsApi {
  /** 按 id 直取某平台歌词，KG 依赖 track 的歌名和时长 */
  matchById: (platform: Platform, id: string, track?: Track) => Promise<LyricMatchResponse>;
  /** 按 Track 元数据在某平台模糊搜索歌词 */
  matchByQuery: (platform: Platform, track: Track) => Promise<LyricMatchResponse>;
  /** 清除验证不通过的模糊匹配映射 */
  forgetMatch: (track: Track, platform: Platform) => Promise<void>;
  /** 抓取 AMLL TTML DB 的 TTML 歌词，仅 NCM/QM 适用 */
  fetchTTMLOverlay: (track: Track, platform: "netease" | "qqmusic") => Promise<LyricTTMLResponse>;
  /** 按 Track 元数据搜索 AMLL TTML DB，用于没有可用平台 ID 或 ID 未命中的歌曲 */
  searchTTML: (track: Track) => Promise<LyricTTMLResponse>;
  /** 在本地 TTML 歌词库中按元信息匹配，命中返回 TTML 原文 */
  matchLocalTTML: (track: Track) => Promise<LyricTTMLResponse>;
  /** 弹出目录选择器，返回所选本地 TTML 歌词库目录 */
  pickLyricRepoDir: () => Promise<string | null>;
}
