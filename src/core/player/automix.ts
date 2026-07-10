import type { AudioAnalysis, AutomixPlan, Track, TransitionProposal } from "@shared/types/player";
import type { ResolvedTrackSource } from "@/services/audioSource";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { getPreloadedTrack, preloadNextTrack } from "./preload";

const PRELOAD_AHEAD_MS = 45_000;
const FALLBACK_DURATION_SEC = 8;
const MIN_CROSSFADE_SEC = 0.5;
const MAX_CROSSFADE_SEC = 12;
const MIN_BEAT_CONFIDENCE = 0.65;
const MAX_TEMPO_ADJUSTMENT = 0.04;
/** 距触发时间低于此值时强制计划生成，不再等待分析完成 */
const PLAN_DEADLINE_MS = 8_000;
const TRIGGER_TOLERANCE_MS = 250;

export type AutomixResult = "idle" | "transitioned" | "fallback-next";
export type AutomixPlay = (plan: AutomixPlan, resolved: ResolvedTrackSource) => Promise<boolean>;

/** 双曲分析状态机：单次 analyzePair 替代原来的4个并发请求 */
let pairKey: string | null = null;
let currentAnalysis: AudioAnalysis | null = null;
let nextAnalysis: AudioAnalysis | null = null;
let transitionProposal: TransitionProposal | null = null;
let pairAnalysisInFlight: Promise<void> | null = null;
let scheduledPlan: AutomixPlan | null = null;
let transitioning = false;
let cancelToken = 0;

const isLocalLikeSource = (source: string): boolean => !/^https?:\/\//i.test(source);

const clampAnalyzeTime = (): number => {
  const raw = useSettingsStore().system.player.automixMaxAnalyzeTimeSec || 60;
  return Math.max(10, Math.min(300, raw));
};

const snapToBeat = (
  time: number,
  bpm: number | undefined,
  firstBeat: number | undefined,
  snapToBar = true,
): number => {
  if (!bpm || bpm <= 0 || firstBeat === undefined) return time;
  const spb = 60 / bpm;
  const interval = snapToBar ? spb * 4 : spb;
  const units = Math.round((time - firstBeat) / interval);
  return firstBeat + units * interval;
};

/**
 * 后台异步分析当前曲/下一首对。
 * 不 await — 调用后立即返回；tickAutomix 每次 tick 读取模块级状态快照。
 */
const kickPairAnalysis = (currentSource: string, nextSource: string): void => {
  if (!isLocalLikeSource(currentSource) || !isLocalLikeSource(nextSource)) return;
  const key = `${currentSource}>>${nextSource}`;
  if (pairKey === key) return; // 同一对，已在飞行中或已完成，跳过
  pairKey = key;
  currentAnalysis = null;
  nextAnalysis = null;
  transitionProposal = null;
  const token = cancelToken;
  const analyzeTime = clampAnalyzeTime();
  pairAnalysisInFlight = window.api.player
    .analyzePair(currentSource, nextSource, analyzeTime)
    .then((result) => {
      if (token !== cancelToken || pairKey !== key) return;
      const data = result.success ? (result.data ?? null) : null;
      if (data) {
        currentAnalysis = data.current;
        nextAnalysis = data.next;
        transitionProposal = data.transition;
      }
    })
    .catch((error: unknown) => {
      console.warn("[automix] pair analysis failed", error);
    })
    .finally(() => {
      if (pairKey === key) pairAnalysisInFlight = null;
    });
};

const applyAggressiveOutro = (
  analysis: AudioAnalysis,
  triggerTime: number,
  crossfadeDuration: number,
  exitPoint: number,
): { triggerTime: number; crossfadeDuration: number } | null => {
  if (!analysis.vocal_out_pos) return null;
  const vocalOut = analysis.vocal_out_pos;
  const tailLength = exitPoint - vocalOut;
  if (tailLength <= 8) return null;
  const outroEnergy = analysis.outro_energy_level ?? -70;
  const isHighEnergy = outroEnergy > -12;
  const beatsToWait = isHighEnergy ? 8 : 1;
  let nextTrigger = triggerTime;
  if (analysis.bpm && analysis.first_beat_pos !== undefined) {
    const spb = 60 / analysis.bpm;
    const relVocal = vocalOut - analysis.first_beat_pos;
    let beatIndex = Math.floor(relVocal / spb);
    if (relVocal % spb > spb * 0.9) beatIndex++;
    let targetBeat = beatIndex + beatsToWait;
    if (isHighEnergy) targetBeat = Math.ceil(targetBeat / 4) * 4;
    nextTrigger = analysis.first_beat_pos + targetBeat * spb;
  } else {
    nextTrigger = vocalOut + (isHighEnergy ? 4 : 0.5);
  }
  if (nextTrigger >= triggerTime || nextTrigger >= exitPoint - 1) return null;
  const maxFade = isHighEnergy ? 8 : 5;
  return {
    triggerTime: nextTrigger,
    crossfadeDuration: Math.min(crossfadeDuration, maxFade, exitPoint - nextTrigger),
  };
};

const MAX_LOUDNESS_CORRECTION_DB = 6;

const computeLoudnessGainDb = (
  current: AudioAnalysis | null,
  next: AudioAnalysis | null,
): number => {
  const outgoingLufs = current?.loudness ?? null;
  const incomingLufs = next?.loudness ?? null;
  if (outgoingLufs === null || incomingLufs === null) return 0;
  if (!Number.isFinite(outgoingLufs) || !Number.isFinite(incomingLufs)) return 0;
  // 旧曲比新曲响时，新曲需要升响（正值）；新曲比旧曲响时，需要降响（负值）
  const delta = outgoingLufs - incomingLufs;
  return Math.max(-MAX_LOUDNESS_CORRECTION_DB, Math.min(MAX_LOUDNESS_CORRECTION_DB, delta));
};

const normalizePlan = (plan: AutomixPlan, durationSec: number): AutomixPlan => {
  const crossfadeDuration = Math.max(
    MIN_CROSSFADE_SEC,
    Math.min(plan.crossfadeDuration, MAX_CROSSFADE_SEC, durationSec),
  );
  const triggerTime = Math.max(0, Math.min(plan.triggerTime, durationSec - crossfadeDuration));
  return {
    ...plan,
    triggerTime,
    crossfadeDuration,
    startSeek: Math.max(0, plan.startSeek),
    initialRate: Math.max(
      1 - MAX_TEMPO_ADJUSTMENT,
      Math.min(1 + MAX_TEMPO_ADJUSTMENT, plan.initialRate),
    ),
    uiSwitchDelay: crossfadeDuration * 0.5,
  };
};

const hasReliableBeatGrid = (analysis: AudioAnalysis | null): analysis is AudioAnalysis =>
  !!analysis?.bpm &&
  analysis.first_beat_pos !== undefined &&
  (analysis.bpm_confidence ?? 0) >= MIN_BEAT_CONFIDENCE;

const createFallbackPlan = (track: Track, index: number, durationSec: number): AutomixPlan =>
  normalizePlan(
    {
      track,
      index,
      triggerTime: Math.max(0, durationSec - FALLBACK_DURATION_SEC),
      crossfadeDuration: Math.min(FALLBACK_DURATION_SEC, durationSec),
      startSeek: 0,
      initialRate: 1,
      uiSwitchDelay: FALLBACK_DURATION_SEC * 0.5,
      mixType: "default",
    },
    durationSec,
  );

const computePlan = (
  track: Track,
  index: number,
  currentSource: string,
  nextSource: string,
  durationSec: number,
): AutomixPlan => {
  const expectedKey = `${currentSource}>>${nextSource}`;
  const current = pairKey === expectedKey ? currentAnalysis : null;
  const next = pairKey === expectedKey ? nextAnalysis : null;
  const transition = pairKey === expectedKey ? transitionProposal : null;
  const canTrustExitPoint = !!current;
  const vocalOut = current?.vocal_out_pos;
  let rawFadeOut = current ? current.fade_out_pos || durationSec : durationSec;
  rawFadeOut = Math.min(rawFadeOut, durationSec);
  if (vocalOut !== undefined && rawFadeOut < vocalOut - 0.1) {
    rawFadeOut = durationSec;
  }
  let exitPoint = rawFadeOut;
  if (current?.cut_out_pos !== undefined) {
    const cutOut = current.cut_out_pos;
    const cutIn = current.cut_in_pos ?? current.fade_in_pos ?? 0;
    if (Number.isFinite(cutOut) && cutOut > 0 && cutOut <= durationSec && cutOut - cutIn > 30) {
      exitPoint = cutOut;
      if (vocalOut !== undefined && exitPoint < vocalOut - 0.1) {
        exitPoint = rawFadeOut;
      }
    }
  }

  let triggerTime = exitPoint - FALLBACK_DURATION_SEC;
  let crossfadeDuration = FALLBACK_DURATION_SEC;
  let startSeek = 0;
  let initialRate = 1;
  let mixType: "default" | "bassSwap" = "default";
  let usedTransition = false;

  if (transition && transition.duration > MIN_CROSSFADE_SEC) {
    const strategyNeedsBeatGrid =
      transition.bpm_compatible || transition.filter_strategy.includes("Bass Swap");
    const canUseTransition =
      !strategyNeedsBeatGrid || (hasReliableBeatGrid(current) && hasReliableBeatGrid(next));
    if (canUseTransition) {
      const safeTrigger = Math.min(transition.current_track_mix_out, durationSec - 1);
      triggerTime = safeTrigger;
      crossfadeDuration = Math.min(transition.duration, durationSec - safeTrigger);
      startSeek = transition.next_track_mix_in * 1000;
      mixType = transition.filter_strategy.includes("Bass Swap") ? "bassSwap" : "default";
      usedTransition = true;
    }
  }
  if (!usedTransition && current && next) {
    let rawTrigger = exitPoint - crossfadeDuration;
    if (hasReliableBeatGrid(current)) {
      rawTrigger = snapToBeat(rawTrigger, current.bpm, current.first_beat_pos, false);
    }
    triggerTime = durationSec - rawTrigger < 4 ? exitPoint - crossfadeDuration : rawTrigger;
    startSeek = (next.fade_in_pos || 0) * 1000;
    if (hasReliableBeatGrid(current) && hasReliableBeatGrid(next)) {
      const ratio = current.bpm / next.bpm;
      if (ratio >= 1 - MAX_TEMPO_ADJUSTMENT && ratio <= 1 + MAX_TEMPO_ADJUSTMENT) {
        initialRate = ratio;
      }
    }
  }

  if (!usedTransition && canTrustExitPoint && current) {
    const outro = applyAggressiveOutro(current, triggerTime, crossfadeDuration, exitPoint);
    if (outro) {
      triggerTime = outro.triggerTime;
      crossfadeDuration = outro.crossfadeDuration;
    }
  }
  if (triggerTime + crossfadeDuration > durationSec) {
    crossfadeDuration = Math.max(MIN_CROSSFADE_SEC, durationSec - triggerTime);
  }
  if (triggerTime < 0) triggerTime = 0;

  return normalizePlan(
    {
      track,
      index,
      triggerTime,
      crossfadeDuration,
      startSeek,
      initialRate,
      uiSwitchDelay: crossfadeDuration * 0.5,
      mixType,
      loudnessGainDb: computeLoudnessGainDb(current, next),
    },
    durationSec,
  );
};

/** 取消当前自动混音调度 */
export const cancelAutomix = (): void => {
  cancelToken++;
  pairKey = null;
  currentAnalysis = null;
  nextAnalysis = null;
  transitionProposal = null;
  pairAnalysisInFlight = null;
  scheduledPlan = null;
  transitioning = false;
};

/**
 * 由 position 事件驱动自动混音，不新增高频 IPC。
 * @param positionMs - 当前播放位置（毫秒）
 * @param playMixed - 执行 crossfade 的播放器函数
 */
export const tickAutomix = async (
  positionMs: number,
  playMixed: AutomixPlay,
): Promise<AutomixResult> => {
  const settings = useSettingsStore();
  const status = useStatusStore();
  if (!settings.system.player.automixEnabled || status.fmMode || status.trackLoading) {
    return "idle";
  }
  if (status.currentTrack?.cuePath) return "idle";
  if (
    !status.currentSource ||
    !status.isPlaying ||
    status.duration <= FALLBACK_DURATION_SEC * 1000
  ) {
    return "idle";
  }
  const remaining = status.duration - positionMs;
  if (remaining > PRELOAD_AHEAD_MS) return "idle";

  void preloadNextTrack();
  const prepared =
    getPreloadedTrack() ??
    (remaining <= FALLBACK_DURATION_SEC * 1000 ? await preloadNextTrack() : null);
  if (!prepared || prepared.track.cuePath) return "idle";

  // 预载完成后立即后台启动分析，不 await，让分析在后台运行
  kickPairAnalysis(status.currentSource, prepared.source);

  const durationSec = status.duration / 1000;
  const planKey = `${status.currentSource}|${prepared.source}|${prepared.track.id}|${prepared.index}`;
  const planStale =
    !scheduledPlan ||
    planKey !==
      `${status.currentSource}|${prepared.source}|${scheduledPlan.track.id}|${scheduledPlan.index}`;

  if (planStale) {
    // 分析仍在飞行中且距曲末还有充足时间：推迟计划生成，等分析完成后会更准确
    const analysisRunning = !!pairAnalysisInFlight;
    const mustDecideNow = remaining <= PLAN_DEADLINE_MS + FALLBACK_DURATION_SEC * 1000;
    if (analysisRunning && !mustDecideNow) {
      return "idle";
    }
    scheduledPlan = computePlan(
      prepared.track,
      prepared.index,
      status.currentSource,
      prepared.source,
      durationSec,
    );
  }

  const plan = scheduledPlan ?? createFallbackPlan(prepared.track, prepared.index, durationSec);
  if (positionMs + TRIGGER_TOLERANCE_MS < plan.triggerTime * 1000) {
    return "idle";
  }
  if (transitioning) return "idle";

  transitioning = true;
  try {
    const ok = await playMixed(plan, prepared.resolved);
    cancelAutomix();
    return ok ? "transitioned" : "fallback-next";
  } catch (error) {
    console.error("[automix] crossfade failed", error);
    cancelAutomix();
    return "fallback-next";
  } finally {
    transitioning = false;
  }
};
