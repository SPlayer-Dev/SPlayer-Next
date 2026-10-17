import { LyricPlayer } from "../vendor/amll-core/amll-core.mjs";
import "@applemusic-like-lyrics/core/style.css";
import "./style.css";
import { PlaybackClock } from "./clock";

import type {
  RemoteDisplayPosition as Position,
  RemoteDisplaySnapshot as Snapshot,
} from "../../shared/types/remoteDisplay";

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const clock = new PlaybackClock();
const player = new LyricPlayer();
el("lyric-engine").appendChild(player.getElement());
player.setEnableBlur(false);
player.setEnableSpring(true);
player.setEnableScale(true);
player.setAlignPosition(0.35);
player.setWordFadeWidth(0.5);

let ws: WebSocket | null = null;
let connected = false;
let retry = 0;
let retryTimer = 0;
let heartbeat = 0;
let lastMessage = 0;
let raf = 0;
let previousFrame = 0;
let frames = 0;
let frameStart = 0;
let fps = 0;
let currentTrack: string | null = null;
let coverKey = "";
let coverToken = 0;
let offset = 0;
let duration = 0;
let lyricCount = 0;

const position = (): number => Math.min(duration || Infinity, clock.current(performance.now()));

type DisplayRequest =
  { op: "display-ping"; clientTime: number } | { op: "subscribe-display"; visible: boolean };

/** 显示端只允许订阅与校时，没有播放控制命令。 */
function send(message: DisplayRequest): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function setConnected(value: boolean): void {
  connected = value;
  el("disconnected").hidden = value;
  if (!value) {
    clock.freeze(performance.now());
    player.pause();
    stopFrames();
  }
}

/** 只加载可见封面，不生成背景或额外的离屏画布。 */
async function loadCover(key: string, trackId: string | null): Promise<void> {
  const token = ++coverToken;
  const image = new Image();
  image.decoding = "async";
  image.src = `/api/display/cover?trackId=${encodeURIComponent(trackId ?? "")}&v=${encodeURIComponent(key)}`;
  try {
    await image.decode();
    if (token !== coverToken) return;
    const cover = el<HTMLImageElement>("cover");
    cover.src = image.src;
    cover.style.display = "block";
    el("placeholder").style.display = "none";
  } catch {
    if (token !== coverToken) return;
    el("cover").style.display = "none";
    el("placeholder").style.display = "grid";
  }
}

function applyPosition(data: Position, force = false): void {
  if (data.trackId !== currentTrack) return;
  const changed = clock.playing !== data.playing;
  const jumped = clock.sync(data, performance.now(), force);
  duration = data.duration;
  if (jumped) player.setCurrentTime(position() + offset, true);
  if (changed || force) {
    if (data.playing && !document.hidden) player.resume();
    else player.pause();
  }
  if (!document.hidden) startFrames();
}

function snapshot(data: Snapshot): void {
  const track = data.track;
  const changed = currentTrack !== (track?.id ?? null);
  currentTrack = track?.id ?? null;
  offset = data.lyricOffsetMs;
  el("title").textContent = track?.title ?? "等待主机播放";
  el("artist").textContent = track?.artists.map((a) => a.name).join(" / ") ?? "";
  el("album").textContent = track?.album?.name ?? "";
  el("badges").replaceChildren();
  for (const label of [track?.source, track?.quality?.codec, data.source?.format]) {
    if (!label) continue;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = label.toUpperCase();
    el("badges").append(badge);
  }
  const nextCover = `${currentTrack}|${track?.coverOriginal ?? track?.cover ?? ""}`;
  if (coverKey !== nextCover) {
    coverKey = nextCover;
    void loadCover(coverKey, currentTrack);
  }
  applyPosition(data, changed);
  // 与原版 AMLL 包装器一致：已有逐词音译时不再重复显示逐行音译。
  const lines = data.lyric.map((line) => ({
    ...line,
    romanLyric: line.words.some((w) => w.romanWord?.trim()) ? "" : line.romanLyric,
  }));
  lyricCount = lines.length;
  player.setLyricLines(lines, position() + offset);
  if (clock.playing && !document.hidden) player.resume();
  else player.pause();
  player.update(0);
  el("empty").style.display = lyricCount ? "none" : "grid";
  el("empty").textContent = track ? "暂无歌词" : "主机开始播放后，歌词将在这里显示";
  setConnected(true);
  startFrames();
}

function frame(now: number): void {
  raf = 0;
  if (document.hidden || !connected) return;
  const delta = previousFrame ? Math.min(now - previousFrame, 100) : 0;
  previousFrame = now;
  if (lyricCount) {
    player.setCurrentTime(position() + offset);
    player.update(delta);
  }
  frames++;
  if (now - frameStart >= 1000) {
    fps = Math.round((frames * 1000) / (now - frameStart));
    frames = 0;
    frameStart = now;
  }
  if (clock.playing) raf = requestAnimationFrame(frame);
}
function startFrames(): void {
  if (!raf && connected && !document.hidden) raf = requestAnimationFrame(frame);
}
function stopFrames(): void {
  cancelAnimationFrame(raf);
  raf = 0;
  previousFrame = 0;
}

function connect(): void {
  clearTimeout(retryTimer);
  clock.resetNetwork();
  const socket = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
  );
  ws = socket;
  socket.onopen = () => {
    retry = 0;
    lastMessage = performance.now();
    send({ op: "display-ping", clientTime: performance.now() });
    send({ op: "subscribe-display", visible: !document.hidden });
    clearInterval(heartbeat);
    heartbeat = window.setInterval(() => {
      if (performance.now() - lastMessage > 25000) {
        socket.close();
        return;
      }
      send({ op: "display-ping", clientTime: performance.now() });
    }, 10000);
  };
  socket.onmessage = (event) => {
    lastMessage = performance.now();
    const message = JSON.parse(event.data);
    if (message.kind === "display-pong")
      clock.calibrate(message.clientTime, performance.now(), message.serverTime);
    else if (message.kind === "display-snapshot") snapshot(message.data);
    else if (message.kind === "display-position") applyPosition(message.data);
    else if (message.kind === "display-offset" && message.data.trackId === currentTrack) {
      offset = message.data.offsetMs;
      player.setCurrentTime(position() + offset, true);
    }
  };
  socket.onerror = () => socket.close();
  socket.onclose = () => {
    clearInterval(heartbeat);
    setConnected(false);
    retryTimer = window.setTimeout(connect, Math.min(10000, 500 * 2 ** Math.min(retry++, 5)));
  };
}

document.addEventListener("visibilitychange", () => {
  send({ op: "subscribe-display", visible: !document.hidden });
  if (document.hidden) {
    stopFrames();
    player.pause();
  }
});
// 仅暴露诊断计数，便于验证真实设备上的连接、歌词和逐帧更新。
Object.defineProperty(window, "surfacePlayerDiagnostics", {
  get: () => ({
    connected,
    trackId: currentTrack,
    lyricCount,
    playing: clock.playing,
    position: position(),
    fps,
    renderer: "AMLL",
    readOnly: true,
    fontFamily: getComputedStyle(el("lyric-engine")).fontFamily,
  }),
});
setConnected(false);
connect();
