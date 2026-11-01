import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { getEngine } from "@main/services/engine";
import { playerLog } from "@main/utils/logger";
import { automixCacheDir } from "@main/utils/paths";
import type { JsAutoMixFeatures } from "@splayer/audio-engine";
import type { AutoMixProfile } from "@shared/types/automix";
import { getAutoMixComponentStatus } from "./components";
import { runAutoMixModel, runAutoMixTask } from "./inference";
import { createAutoMixProfile } from "./features";

/** 节拍模型的固定输入帧数与梅尔维度 */
const MODEL_FRAMES = 1488;
const MEL_BINS = 128;

/** 只复用最近八个紧凑档案，不保留频谱、PCM 或模型张量 */
const cache = new Map<string, AutoMixProfile>();

export interface AnalysisTrack {
  source: string;
  startMs: number;
  endMs?: number;
  tail: boolean;
}

/**
 * 按需分析两曲的首尾窗口，模型完成或取消后立即归还进程内存
 * @param tracks - 当前曲尾和下一曲头的本地音源范围
 * @param signal - 本次预载的取消信号
 * @returns 可用档案，组件缺失或不足模型上下文时为空
 */
export const analyzeAutoMixTracks = (
  tracks: AnalysisTrack[],
  signal: AbortSignal,
): Promise<AutoMixProfile[] | null> =>
  runAutoMixTask(signal, async () => {
    const components = await getAutoMixComponentStatus();
    const missing = components.models.filter((model) => model.state !== "ready");
    if (missing.length) {
      playerLog.info(
        `AutoMix 组件未就绪：${missing.map((model) => model.id).join("、")}，请在设置中安装`,
      );
      return null;
    }
    if (tracks.some((track) => track.source.includes("://"))) return null;
    const keys = await Promise.all(
      tracks.map(async (track) => {
        const info = await stat(track.source);
        return JSON.stringify([track, info.size, info.mtimeMs, info.ctimeMs]);
      }),
    );
    signal.throwIfAborted();
    const profiles = keys.map((key) => cache.get(key) ?? null);
    const pending = profiles.flatMap((profile, index) => (profile ? [] : [index]));
    if (!pending.length) return profiles as AutoMixProfile[];
    await mkdir(automixCacheDir, { recursive: true });
    const directory = await mkdtemp(path.join(automixCacheDir, "beats-"));
    try {
      const features: Omit<JsAutoMixFeatures, "mel">[] = [];
      const windows: { input: string; output: string; frames: number }[] = [];
      for (const index of pending) {
        signal.throwIfAborted();
        const track = tracks[index];
        const feature = await getEngine().analyzeAutoMix(
          track.source,
          track.startMs / 1000,
          track.endMs == null ? undefined : track.endMs / 1000,
          track.tail,
        );
        const { mel, ...metadata } = feature;
        if (mel.length < MODEL_FRAMES * MEL_BINS) return null;
        const input = path.join(directory, `${index}.mel`);
        const output = path.join(directory, `${index}.beats`);
        await writeFile(input, Buffer.from(mel.buffer, mel.byteOffset, mel.byteLength));
        features.push(metadata);
        windows.push({ input, output, frames: mel.length / MEL_BINS });
      }
      await runAutoMixModel("beat", windows, signal);
      for (const [offset, index] of pending.entries()) {
        const data = await readFile(windows[offset].output);
        if (data.byteLength !== windows[offset].frames * 8) throw new Error("节拍预测帧数不匹配");
        const profile = createAutoMixProfile(
          features[offset],
          new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4),
          tracks[index].tail,
        );
        cache.set(keys[index], profile);
        profiles[index] = profile;
      }
      while (cache.size > 8) cache.delete(cache.keys().next().value!);
      return profiles as AutoMixProfile[];
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
