<script setup lang="ts">
type MetricKind = "fps" | "ms" | "mem";

interface Metric {
  label: string;
  format: (v: number) => string;
  current: number;
  min: number;
  max: number;
  history: number[];
}

const HISTORY_SIZE = 74;
const SAMPLE_INTERVAL_MS = 1000;

const metrics: Record<MetricKind, Metric> = {
  fps: {
    label: "FPS",
    format: (v) => String(Math.round(v)),
    current: 0,
    min: Infinity,
    max: 0,
    history: [],
  },
  ms: {
    label: "MS",
    format: (v) => v.toFixed(1),
    current: 0,
    min: Infinity,
    max: 0,
    history: [],
  },
  mem: {
    label: "MB",
    format: (v) => v.toFixed(0),
    current: 0,
    min: Infinity,
    max: 0,
    history: [],
  },
};

const kind = ref<MetricKind>("fps");
const label = ref(metrics.fps.label);
const display = ref("0");
const rangeText = ref("0–0");

const hasMemory =
  typeof (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    ?.usedJSHeapSize === "number";

const availableKinds = computed<MetricKind[]>(() =>
  hasMemory ? ["fps", "ms", "mem"] : ["fps", "ms"],
);

const canvas = ref<HTMLCanvasElement>();
let ctx: CanvasRenderingContext2D | null = null;

const refreshDisplay = (): void => {
  const m = metrics[kind.value];
  label.value = m.label;
  display.value = m.format(m.current);
  const min = m.min === Infinity ? 0 : m.min;
  rangeText.value = `${m.format(min)}–${m.format(m.max)}`;
  draw();
};

const cycle = (): void => {
  const list = availableKinds.value;
  const idx = list.indexOf(kind.value);
  kind.value = list[(idx + 1) % list.length];
  refreshDisplay();
};

const draw = (): void => {
  if (!ctx || !canvas.value) return;
  const w = canvas.value.width;
  const h = canvas.value.height;
  ctx.clearRect(0, 0, w, h);
  const m = metrics[kind.value];
  if (m.history.length === 0) return;
  const min = m.min === Infinity ? 0 : m.min;
  const max = m.max || 1;
  const range = max - min || 1;
  ctx.fillStyle = getComputedStyle(canvas.value).color;
  const step = w / HISTORY_SIZE;
  for (let index = 0; index < m.history.length; index++) {
    const value = m.history[index];
    const ratio = Math.max(0, Math.min(1, (value - min) / range));
    const barH = Math.max(1, ratio * (h - 1));
    ctx.fillRect(index * step, h - barH, Math.max(1, step - 0.5), barH);
  }
};

let rafId = 0;
let lastFrame = 0;
let frames = 0;
let sampleStart = 0;
let lastMs = 0;

const tick = (now: number): void => {
  if (lastFrame) lastMs = now - lastFrame;
  lastFrame = now;
  frames++;
  if (now - sampleStart >= SAMPLE_INTERVAL_MS) {
    const elapsed = now - sampleStart;
    pushSample("fps", (frames * 1000) / elapsed);
    pushSample("ms", lastMs);
    if (hasMemory) {
      const mem =
        (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize /
        1048576;
      pushSample("mem", mem);
    }
    frames = 0;
    sampleStart = now;
    refreshDisplay();
  }
  rafId = requestAnimationFrame(tick);
};

const pushSample = (k: MetricKind, value: number): void => {
  const m = metrics[k];
  m.current = value;
  if (value < m.min) m.min = value;
  if (value > m.max) m.max = value;
  m.history.push(value);
  if (m.history.length > HISTORY_SIZE) m.history.shift();
};

/** 拖拽位置 */
const pos = ref<{ x: number; y: number } | null>(null);
const dragging = ref(false);

let dragStart: { px: number; py: number; ox: number; oy: number } | null = null;
let activePointerId = -1;
let moved = false;

const DRAG_THRESHOLD = 3;

const onPointerDown = (event: PointerEvent): void => {
  const el = event.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  dragStart = { px: event.clientX, py: event.clientY, ox: rect.left, oy: rect.top };
  activePointerId = event.pointerId;
  moved = false;
  el.setPointerCapture(activePointerId);
};

const onPointerMove = (event: PointerEvent): void => {
  if (!dragStart) return;
  const dx = event.clientX - dragStart.px;
  const dy = event.clientY - dragStart.py;
  if (!moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
  moved = true;
  dragging.value = true;
  pos.value = { x: dragStart.ox + dx, y: dragStart.oy + dy };
};

const onPointerUp = (event: PointerEvent): void => {
  const el = event.currentTarget as HTMLElement;
  if (activePointerId >= 0) el.releasePointerCapture(activePointerId);
  activePointerId = -1;
  dragStart = null;
  dragging.value = false;
  if (!moved) cycle();
};

onMounted(() => {
  if (canvas.value) ctx = canvas.value.getContext("2d");
  sampleStart = performance.now();
  rafId = requestAnimationFrame(tick);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId);
});
</script>

<template>
  <div
    class="fixed z-9999 px-2 py-1.5 rounded-lg select-none bg-surface-bright text-on-surface border border-solid border-outline-variant/30 shadow-lg flex flex-col gap-1 app-no-drag"
    :class="dragging ? 'cursor-grabbing' : 'cursor-grab'"
    :style="
      pos
        ? { top: `${pos.y}px`, left: `${pos.x}px`, right: 'auto' }
        : { top: '5rem', right: '1rem' }
    "
    :title="`click to switch · ${rangeText}`"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
  >
    <div class="flex items-baseline gap-1.5 leading-none">
      <span class="text-sm font-semibold tabular-nums">{{ display }}</span>
      <span class="text-[10px] tracking-wider opacity-50">{{ label }}</span>
    </div>
    <canvas ref="canvas" :width="74" :height="22" class="block text-on-surface/85" />
  </div>
</template>
