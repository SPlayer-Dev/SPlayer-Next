import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

interface Diagnostics {
  callbackAllocationCount: number;
  callbackMaxDurationUs: number;
  underrunSamples: number;
  xrunCount: number;
  rebuildAttempts: number;
  rebuildFailures: number;
}

interface Player {
  onEvent(callback: (event: { type: string }) => void): void;
  load(source: string, autoPlay?: boolean): Promise<unknown>;
  seek(position: number): Promise<void>;
  reinitOutput(): Promise<void>;
  play(): Promise<void>;
  stop(): void;
  getDiagnostics(): Diagnostics;
}

interface AudioEngineModule {
  AudioPlayer: new () => Player;
}

const require = createRequire(import.meta.url);
const modulePath = resolve("native/audio-engine/audio-engine.node");
const audioEngine = require(modulePath) as AudioEngineModule;

const makeWav = (durationSeconds: number): Buffer => {
  const sampleRate = 48_000;
  const channels = 2;
  const bytesPerSample = 2;
  const frames = sampleRate * durationSeconds;
  const dataSize = frames * channels * bytesPerSample;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  wav.writeUInt16LE(channels * bytesPerSample, 32);
  wav.writeUInt16LE(bytesPerSample * 8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  return wav;
};

const assertRealtimeDiagnostics = (diagnostics: Diagnostics): void => {
  if (diagnostics.callbackAllocationCount !== 0) {
    throw new Error(`音频 callback 发生 ${diagnostics.callbackAllocationCount} 次 heap allocation`);
  }
  if (diagnostics.callbackMaxDurationUs === 0) {
    throw new Error("音频 callback 未运行，无法验收实时分配与耗时探针");
  }
};

const runStressMatrix = async (player: Player, source: string): Promise<void> => {
  for (let index = 0; index < 1_000; index += 1) {
    await player.load(source, false);
  }
  await player.load(source, false);
  for (let index = 0; index < 1_000; index += 1) {
    await player.seek((index % 900) / 100);
  }
  for (let index = 0; index < 100; index += 1) {
    await player.reinitOutput();
  }
  await player.load(source, true);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  assertRealtimeDiagnostics(player.getDiagnostics());
};

const runSoak = async (player: Player, source: string): Promise<void> => {
  const durationMs = 8 * 60 * 60 * 1_000;
  const deadline = Date.now() + durationMs;
  let fatalEvent: string | null = null;
  player.onEvent((event) => {
    if (event.type === "internalError" || event.type === "sourceError") fatalEvent = event.type;
    if (event.type === "ended" && Date.now() < deadline) void player.load(source, true);
  });
  await player.load(source, true);
  while (Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 60_000));
    if (fatalEvent) throw new Error(`soak 收到致命事件: ${fatalEvent}`);
    const diagnostics = player.getDiagnostics();
    assertRealtimeDiagnostics(diagnostics);
    process.stdout.write(`${new Date().toISOString()} ${JSON.stringify(diagnostics)}\n`);
  }
};

const main = async (): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), "splayer-native-stress-"));
  const source = join(directory, "stress.wav");
  await writeFile(source, makeWav(60));
  const player = new audioEngine.AudioPlayer();
  try {
    if (process.argv.includes("--soak")) await runSoak(player, source);
    else await runStressMatrix(player, source);
    process.stdout.write(`${JSON.stringify(player.getDiagnostics(), null, 2)}\n`);
  } finally {
    player.stop();
    await rm(directory, { recursive: true, force: true });
  }
};

await main();
