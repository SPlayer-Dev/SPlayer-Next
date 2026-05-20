import type { AudioQuality } from "@shared/types/player";

/** 音质等级 */
export type QualityLevel = "hi-res" | "lossless" | "hq" | "sq" | "lq";

/** 无损编解码器 */
const LOSSLESS_CODECS = new Set(["flac", "alac", "ape", "wav", "aiff", "wavpack", "tta"]);

/** 等级短码文案 */
const QUALITY_LABELS: Record<QualityLevel, string> = {
  "hi-res": "Hi-Res",
  lossless: "Lossless",
  hq: "HQ",
  sq: "SQ",
  lq: "LQ",
};

/** 等级完整文案 */
const QUALITY_FULL_LABELS: Record<QualityLevel, string> = {
  "hi-res": "Hi-Res",
  lossless: "Lossless",
  hq: "High Quality",
  sq: "Standard Quality",
  lq: "Low Quality",
};

/**
 * 判断音质等级；信息不全时回落到 LQ
 * @param quality - AudioQuality；undefined / 无 codec 时按最低档处理
 * @returns 音质等级
 */
export const getQualityLevel = (quality: AudioQuality | undefined): QualityLevel => {
  if (!quality || !quality.codec || quality.codec === "unknown") return "lq";
  const isLossless = LOSSLESS_CODECS.has(quality.codec.toLowerCase());
  if (isLossless) {
    if (quality.sampleRate >= 96000 && quality.bitsPerSample >= 24) return "hi-res";
    return "lossless";
  }
  const kbps = quality.bitRate / 1000;
  if (kbps >= 320) return "hq";
  if (kbps >= 192) return "sq";
  return "lq";
};

/**
 * 取音质等级短码文案
 * @param quality - AudioQuality；未知时返回空串（避免加载中误显示 LQ）
 * @returns 短码文案（LQ / SQ / HQ / Lossless / Hi-Res）
 */
export const getQualityLabel = (quality: AudioQuality | undefined): string =>
  quality ? QUALITY_LABELS[getQualityLevel(quality)] : "";

/**
 * 取音质等级完整文案
 * @param quality - AudioQuality；未知时返回空串
 * @returns 完整文案（Low Quality / Standard Quality / High Quality / Lossless / Hi-Res）
 */
export const getQualityFullLabel = (quality: AudioQuality | undefined): string =>
  quality ? QUALITY_FULL_LABELS[getQualityLevel(quality)] : "";

/** 是否为无损级别（hi-res 或 lossless） */
export const isLosslessQuality = (quality: AudioQuality | undefined): boolean => {
  const level = getQualityLevel(quality);
  return level === "hi-res" || level === "lossless";
};
