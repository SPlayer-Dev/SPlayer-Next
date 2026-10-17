import { LyricPlayer as Original } from "@applemusic-like-lyrics/core";
import { LyricPlayer as Optimized } from "../vendor/amll-core/amll-core.mjs";
import "@applemusic-like-lyrics/core/style.css";
import "../src/style.css";
import fixture from "./fixture.json";
import realTTML from "./real-fixture.ttml?raw";
import { parseTTML } from "lyric-kit";
import cover from "./cover.jpg";
import buildInfo from "../vendor/amll-core/build.json";

const params = new URLSearchParams(location.search);
const variant = params.get("variant") || "original";
const scenario = params.get("case") || "qrc";
let lines = structuredClone(fixture.lyric);
if (
  scenario === "ttmlcompact" ||
  scenario === "ttml" ||
  scenario === "long" ||
  scenario === "lifecycle"
) {
  lines = [];
  for (let i = 0; i < (scenario === "long" ? 1000 : 100); i++) {
    const start = i * 6400;
    const words = ["星光", " glowing ", " night ", "照亮", " every ", " heart"].map((word, j) => ({
      word,
      startTime: start + j * 1100,
      endTime: start + (j + 1) * 1100,
      romanWord: j === 0 ? "xing guang" : "",
      obscene: false,
      ruby:
        j === 3
          ? [{ word: "てらす", startTime: start + j * 1100, endTime: start + (j + 1) * 1100 }]
          : [],
    }));
    lines.push({
      words,
      startTime: start,
      endTime: start + 6600,
      isBG: false,
      isDuet: i % 3 === 0,
      translatedLyric: "星光照亮每一个心愿",
      romanLyric: "",
    });
    if (i % 2 === 0)
      lines.push({
        words: [
          {
            word: "Harmony 和声",
            startTime: start + 2200,
            endTime: start + 6500,
            romanWord: "",
            obscene: false,
            ruby: [],
          },
        ],
        startTime: start + 2200,
        endTime: start + 6500,
        isBG: true,
        isDuet: i % 3 === 0,
        translatedLyric: "",
        romanLyric: "",
      });
  }
} else if (scenario === "lrc") {
  lines = lines.map((line) => ({
    ...line,
    words: [
      {
        word: line.words.map((w) => w.word).join(""),
        startTime: line.startTime,
        endTime: line.endTime,
      },
    ],
  }));
}
const calls = { animate: 0, styles: 0, timing: 0 };
const animate = Element.prototype.animate;
Element.prototype.animate = function (...args) {
  calls.animate++;
  return animate.apply(this, args);
};
const computed = window.getComputedStyle;
window.getComputedStyle = function (...args) {
  calls.styles++;
  return computed.apply(this, args);
};
const timing = KeyframeEffect.prototype.getComputedTiming;
KeyframeEffect.prototype.getComputedTiming = function (...args) {
  calls.timing++;
  return timing.apply(this, args);
};
const player = new (variant === "original" ? Original : Optimized)();
document.getElementById("lyric-engine")!.append(player.getElement());
player.setEnableBlur(false);
player.setEnableSpring(true);
player.setEnableScale(true);
player.setAlignPosition(0.35);
player.setWordFadeWidth(0.5);
if (scenario.endsWith("compact")) {
  const style = document.createElement("style");
  style.textContent = `.FmKaba_lyricMainLine > span, .FmKaba_lyricMainLine span.FmKaba_emphasizeWrapper,
    .FmKaba_lyricMainLine > span > span, .FmKaba_lyricMainLine span.FmKaba_emphasizeWrapper > span,
    .FmKaba_lyricMainLine .FmKaba_emphasize > span {
      padding-top: .35em !important; padding-bottom: .35em !important;
      margin-top: -.35em !important; margin-bottom: -.35em !important;
    }`;
  document.head.append(style);
}
await document.fonts.ready;
if (scenario.startsWith("real")) {
  const parsed = parseTTML(realTTML);
  lines = Array.isArray(parsed) ? parsed : parsed.lines;
  if (scenario !== "realblank") {
    const art = document.getElementById("art")!;
    const img = new Image();
    img.src = cover;
    img.style.cssText = "width:100%;height:100%;object-fit:cover";
    await img.decode();
    art.append(img);
  }
  if (scenario === "reallayer")
    document.getElementById("record")!.style.transform = "translateZ(0)";
}
const startTime = scenario.startsWith("real") ? 160000 : 30000;
player.setLyricLines(lines, startTime);
player.resume();
const durations: number[] = [];
const gaps: number[] = [];
let started = 0,
  last = 0,
  done = false,
  peakAnimations = 0,
  lastProbe = 0,
  lastLabel = -1;
let result: unknown = { variant, scenario, done: false };
Object.defineProperty(window, "surfacePlayerDiagnostics", { get: () => result });
window.addEventListener("error", (event) => {
  if (event.error)
    result = { variant, scenario, done: true, error: event.message, stack: event.error.stack };
});
function tick(now: number) {
  if (!started) started = now;
  const elapsed = now - started;
  const delta = last ? now - last : 0;
  last = now;
  const before = performance.now();
  player.setCurrentTime(startTime + elapsed);
  player.update(Math.min(delta, 100));
  if (elapsed > 2000) {
    durations.push(performance.now() - before);
    gaps.push(delta);
  }
  if (now - lastProbe > 500) {
    peakAnimations = Math.max(peakAnimations, document.getAnimations().length);
    lastProbe = now;
  }
  if (elapsed >= 22000) {
    const sorted = [...gaps].sort((a, b) => a - b);
    const js = [...durations].sort((a, b) => a - b);
    result = {
      variant,
      scenario,
      build: variant === "original" ? "upstream-0.6.0" : buildInfo,
      done: true,
      frames: gaps.length,
      fps: (1000 * gaps.length) / gaps.reduce((a, b) => a + b, 0),
      p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
      p99FrameMs: sorted[Math.floor(sorted.length * 0.99)],
      jsMeanMs: js.reduce((a, b) => a + b, 0) / js.length,
      jsP95Ms: js[Math.floor(js.length * 0.95)],
      over33ms: gaps.filter((x) => x > 33.4).length,
      peakAnimations,
      calls,
      viewport: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
    };
    document.getElementById("bench-status")!.textContent = JSON.stringify(result);
    player.pause();
    done = true;
    return;
  }
  if (Math.floor(elapsed / 1000) !== lastLabel) {
    lastLabel = Math.floor(elapsed / 1000);
    document.getElementById("bench-status")!.textContent = `${variant} / ${scenario} ${lastLabel}s`;
  }
  requestAnimationFrame(tick);
}
async function lifecycle() {
  const checks = [];
  for (const time of [
    6400, 64000, 128000, 192000, 256000, 320000, 384000, 448000, 512000, 576000, 6400,
  ]) {
    player.setCurrentTime(time, true);
    for (let step = 0; step < 20; step++) {
      player.update(16);
      await new Promise((r) => setTimeout(r, 16));
    }
    const groups = player.currentLyricGroups;
    const mounted = groups.filter((g) => g.element.parentElement).length;
    const built = groups.filter((g) => g.mainLine.built).length;
    checks.push({
      time,
      current: player.getCurrentTime(),
      mounted,
      built,
      cached: player.detachedGroups?.length,
    });
  }
  player.pause();
  const before = player.getCurrentTime();
  await new Promise((r) => setTimeout(r, 300));
  const paused = player.getCurrentTime() === before;
  player.resume();
  player.setCurrentTime(10000, true);
  player.update(16);
  player.dispose();
  const remaining = document.getAnimations().length;
  result = {
    variant,
    scenario,
    done: true,
    checks,
    paused,
    remaining,
    passed:
      checks.every((c) => c.time === c.current && c.built <= c.mounted + 12) &&
      paused &&
      remaining === 0,
  };
}
if (scenario === "lifecycle")
  setTimeout(() => {
    void lifecycle().catch((error) => {
      result = { variant, scenario, done: true, error: String(error), stack: error?.stack };
    });
  }, 1000);
else requestAnimationFrame(tick);
