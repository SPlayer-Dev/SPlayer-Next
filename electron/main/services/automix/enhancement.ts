import path from "node:path";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { getEngine } from "@main/services/engine";
import { automixCacheDir } from "@main/utils/paths";
import type { AutoMixPlan, AutoMixProfile } from "@shared/types/automix";
import type { AnalysisTrack } from "./analysisHost";
import { runAutoMixModel, runAutoMixTask } from "./inference";
import { measureVocalActivity, refineAutoMixVocals } from "./vocals";
import { measureMixWindow } from "./features";
import { playerLog } from "@main/utils/logger";
import type { AutoMixCandidate } from "./planner";

/** 只保留最近四对交接的磁盘窗口，不缓存 PCM 或模型张量 */
const completed = new Map<string, { plan: AutoMixPlan; directory: string }>();
let workspace: Promise<void> | undefined;
/** 声部分离窗口上限，对应 worker 与引擎的 1_058_444 帧（44.1kHz 下 24 秒） */
const MAX_SEPARATION_MS = 24_000;

/** 一组分离窗口的磁盘结果 */
interface Separation {
  directory: string;
  windows: { input: string; output: string; startMs: number; endMs: number }[];
  frames: number[];
  vocals: number[][];
}

/**
 * 导出窗口并运行声部分离，失败时清理目录
 * @param tracks - 两路实际音源
 * @param ranges - 绝对毫秒窗口，第一项属于当前曲
 * @param signal - 当前预载的取消信号
 * @returns 分离结果，调用方负责保留或删除目录
 */
const separate = async (
  tracks: AnalysisTrack[],
  ranges: { startMs: number; endMs: number }[],
  signal: AbortSignal,
): Promise<Separation> => {
  workspace ??= rm(automixCacheDir, { recursive: true, force: true })
    .then(() => mkdir(automixCacheDir, { recursive: true }))
    .then(() => undefined);
  await workspace;
  const directory = await mkdtemp(path.join(automixCacheDir, "mix-"));
  const windows = ranges.map((window, index) => ({
    input: path.join(directory, index + ".pcm"),
    output: path.join(directory, index + ".stems"),
    ...window,
  }));
  try {
    for (const [index, window] of windows.entries()) {
      signal.throwIfAborted();
      await getEngine().exportAutoMixWindow(
        tracks[index === 0 ? 0 : 1].source,
        window.startMs / 1000,
        window.endMs / 1000,
        false,
        window.input,
      );
    }
    const results = await runAutoMixModel<{ structure: { vocals: number[] }; frames: number }>(
      "demucs",
      windows,
      signal,
    );
    return {
      directory,
      windows,
      frames: results.map((result) => result.frames),
      vocals: results.map((result) => result.structure.vocals),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};

/**
 * 分析实际声部，唱句完整时安排分层对拍
 * @param candidate - 对拍候选
 * @param tracks - 两路实际音源
 * @param profiles - 可复用的首尾分析证据
 * @param currentEndMs - 当前曲目或 CUE 的有效终点
 * @param signal - 当前预载的取消信号
 * @returns 依据实际声部活动编排的计划，唱句会被截断时为空
 */
export const enhanceAutoMixPlan = (
  candidate: AutoMixCandidate,
  tracks: AnalysisTrack[],
  profiles: AutoMixProfile[],
  currentEndMs: number,
  signal: AbortSignal,
): Promise<AutoMixPlan | undefined> =>
  runAutoMixTask(signal, async () => {
    const identities = await Promise.all(
      tracks.map(async (track) => {
        const info = await stat(track.source);
        return [track.source, info.size, info.mtimeMs, info.ctimeMs];
      }),
    );
    const key = JSON.stringify([identities, candidate, currentEndMs]);
    signal.throwIfAborted();
    const cached = completed.get(key);
    if (cached) return cached.plan;
    const ranges = profiles.map((profile, index) => {
      const start = index ? candidate.inStartMs : candidate.outStartMs;
      // 下一曲从原始入口起分离，入口后移跳过的唱句也要计入损失
      const entry = index ? Math.min(start, profile.firstAudibleMs - 100) : start;
      return {
        startMs: Math.max(profile.startMs, entry - 1500),
        endMs: Math.min(
          profile.endMs,
          start + candidate.durationMs * (index ? 1 : candidate.outgoingRate) + 1500,
        ),
      };
    });
    if (ranges.some((range) => range.endMs - range.startMs > MAX_SEPARATION_MS)) {
      playerLog.info("AutoMix 跳过区间超出声部分离窗口，不做混音");
      return undefined;
    }
    const separation = await separate(tracks, ranges, signal);
    const { directory, windows, frames, vocals } = separation;
    const voices = profiles.map((profile, index) =>
      measureVocalActivity(profile, vocals[index], windows[index].startMs),
    );
    const { plan, vocalLossMs } = refineAutoMixVocals(candidate, profiles, voices);
    if (!plan) {
      await rm(directory, { recursive: true, force: true });
      playerLog.info("AutoMix 交接会截断唱句，不做混音", {
        vocalLossMs: vocalLossMs.map(Math.round),
      });
      return undefined;
    }
    const stem = (index: number) => ({
      path: windows[index].output,
      startMs: windows[index].startMs,
      frames: frames[index],
    });
    const span = plan.durationMs;
    const outgoing = measureMixWindow(
      profiles[0],
      plan.outStartMs,
      plan.outStartMs + span * plan.outgoingRate,
    ).level;
    const incoming = measureMixWindow(profiles[1], plan.inStartMs, plan.inStartMs + span).level;
    const result: AutoMixPlan = {
      ...plan,
      levelRatio: Math.max(0.5, Math.min(2, incoming / outgoing)),
      stems: { outgoing: stem(0), incoming: stem(1) },
    };
    await Promise.all(windows.map((window) => rm(window.input, { force: true })));
    completed.set(key, { plan: result, directory });
    while (completed.size > 4) {
      const oldest = completed.keys().next().value!;
      const entry = completed.get(oldest)!;
      completed.delete(oldest);
      await rm(entry.directory, { recursive: true, force: true });
    }
    return result;
  });
