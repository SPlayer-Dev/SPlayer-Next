import type {
  AdvancedTransition,
  AudioAnalysis,
  AutomixPlan,
  Track,
  TransitionProposal,
} from "@shared/types/player";
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
const ANALYSIS_DEADLINE_MS = 12_000;
const TRIGGER_TOLERANCE_MS = 250;

export type AutomixResult = "idle" | "transitioned" | "fallback-next";
export type AutomixPlay = (plan: AutomixPlan, resolved: ResolvedTrackSource) => Promise<boolean>;

let currentAnalysisKey: string | null = null;
let currentAnalysis: AudioAnalysis | null = null;
let currentAnalysisInFlight: Promise<void> | null = null;
let nextAnalysisKey: string | null = null;
let nextAnalysis: AudioAnalysis | null = null;
let nextAnalysisInFlight: Promise<void> | null = null;
let transitionKey: string | null = null;
let transitionProposal: TransitionProposal | null = null;
let advancedTransition: AdvancedTransition | null = null;
let transitionInFlight: Promise<void> | null = null;
let scheduledPlan: AutomixPlan | null = null;
let transitioning = false;
let cancelToken = 0;

const isLocalLikeSource = (source: string): boolean => !/^https?:\/\//i.test(source);

const settleBeforeDeadline = async (promises: Promise<void>[]): Promise<void> => {
  await Promise.race([
    Promise.allSettled(promises).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, ANALYSIS_DEADLINE_MS)),
  ]);
};

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

const resetTransitionCache = (currentSource: string, nextSource: string): void => {
  const key = `${currentSource}>>${nextSource}`;
  if (transitionKey === key) return;
  transitionKey = key;
  transitionProposal = null;
  advancedTransition = null;
  transitionInFlight = null;
};

const ensureAnalysisReady = async (currentSource: string, nextSource: string): Promise<void> => {
  if (!isLocalLikeSource(currentSource) || !isLocalLikeSource(nextSource)) return;
  const analyzeTime = clampAnalyzeTime();
  const token = cancelToken;

  if (currentAnalysisKey !== currentSource) {
    currentAnalysisKey = currentSource;
    currentAnalysis = null;
    currentAnalysisInFlight = null;
  }
  if (!currentAnalysis && !currentAnalysisInFlight) {
    currentAnalysisInFlight = window.api.player
      .analyzeAudioFile(currentSource, analyzeTime)
      .then((result) => {
        if (token !== cancelToken || currentAnalysisKey !== currentSource) return;
        currentAnalysis = result.success ? (result.data ?? null) : null;
      })
      .catch((error) => {
        console.warn("[automix] current track analysis failed", error);
      })
      .finally(() => {
        if (currentAnalysisKey === currentSource) currentAnalysisInFlight = null;
      });
  }

  if (nextAnalysisKey !== nextSource) {
    nextAnalysisKey = nextSource;
    nextAnalysis = null;
    nextAnalysisInFlight = null;
  }
  if (!nextAnalysis && !nextAnalysisInFlight) {
    nextAnalysisInFlight = window.api.player
      .analyzeAudioFileHead(nextSource, analyzeTime)
      .then((result) => {
        if (token !== cancelToken || nextAnalysisKey !== nextSource) return;
        nextAnalysis = result.success ? (result.data ?? null) : null;
      })
      .catch((error) => {
        console.warn("[automix] next track analysis failed", error);
      })
      .finally(() => {
        if (nextAnalysisKey === nextSource) nextAnalysisInFlight = null;
      });
  }

  resetTransitionCache(currentSource, nextSource);
  if (!transitionProposal && !advancedTransition && !transitionInFlight) {
    transitionInFlight = Promise.all([
      window.api.player.suggestTransition(currentSource, nextSource),
      window.api.player.suggestLongMix(currentSource, nextSource),
    ])
      .then(([transition, longMix]) => {
        if (token !== cancelToken || transitionKey !== `${currentSource}>>${nextSource}`) return;
        transitionProposal = transition.success ? (transition.data ?? null) : null;
        advancedTransition = longMix.success ? (longMix.data ?? null) : null;
      })
      .catch((error) => {
        console.warn("[automix] transition analysis failed", error);
      })
      .finally(() => {
        if (transitionKey === `${currentSource}>>${nextSource}`) transitionInFlight = null;
      });
  }

  await settleBeforeDeadline(
    [currentAnalysisInFlight, nextAnalysisInFlight, transitionInFlight].filter(
      (promise): promise is Promise<void> => promise !== null,
    ),
  );
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
  const current = currentAnalysisKey === currentSource ? currentAnalysis : null;
  const next = nextAnalysisKey === nextSource ? nextAnalysis : null;
  const transition =
    transitionKey === `${currentSource}>>${nextSource}` ? transitionProposal : null;
  const advanced = transitionKey === `${currentSource}>>${nextSource}` ? advancedTransition : null;

  const canUseAdvanced =
    advanced &&
    current &&
    next &&
    hasReliableBeatGrid(current) &&
    hasReliableBeatGrid(next) &&
    advanced.playback_rate >= 1 - MAX_TEMPO_ADJUSTMENT &&
    advanced.playback_rate <= 1 + MAX_TEMPO_ADJUSTMENT &&
    advanced.duration >= MIN_CROSSFADE_SEC &&
    advanced.duration <= MAX_CROSSFADE_SEC;
  if (canUseAdvanced) {
    const mixType = advanced.strategy.includes("Bass Swap") ? "bassSwap" : "default";
    return normalizePlan(
      {
        track,
        index,
        triggerTime: advanced.start_time_current,
        crossfadeDuration: advanced.duration,
        startSeek: advanced.start_time_next * 1000,
        initialRate: advanced.playback_rate,
        uiSwitchDelay: advanced.duration * 0.5,
        mixType,
      },
      durationSec,
    );
  }

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

  if (!canUseAdvanced && canTrustExitPoint && current) {
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
    },
    durationSec,
  );
};

/** 取消当前自动混音调度 */
export const cancelAutomix = (): void => {
  cancelToken++;
  currentAnalysisKey = null;
  currentAnalysis = null;
  currentAnalysisInFlight = null;
  nextAnalysisKey = null;
  nextAnalysis = null;
  nextAnalysisInFlight = null;
  transitionKey = null;
  transitionProposal = null;
  advancedTransition = null;
  transitionInFlight = null;
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

  const durationSec = status.duration / 1000;
  const planKey = `${status.currentSource}|${prepared.source}|${prepared.track.id}|${prepared.index}`;
  if (
    !scheduledPlan ||
    planKey !==
      `${status.currentSource}|${prepared.source}|${scheduledPlan.track.id}|${scheduledPlan.index}`
  ) {
    await ensureAnalysisReady(status.currentSource, prepared.source);
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
