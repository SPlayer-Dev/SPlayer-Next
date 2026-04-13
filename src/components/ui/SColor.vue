<script setup lang="ts">
export interface SColorProps {
  /** 当前颜色，hex 格式：#RRGGBB 或 #RRGGBBAA */
  modelValue?: string;
  /** 禁用 */
  disabled?: boolean;
  /** 是否支持透明度 */
  showAlpha?: boolean;
  /** 预设色板 */
  swatches?: string[];
}

const props = withDefaults(defineProps<SColorProps>(), {
  modelValue: "#000000",
  disabled: false,
  showAlpha: true,
  swatches: () => [],
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}
interface HSV {
  h: number;
  s: number;
  v: number;
}

/** 把值限制在 [min, max] 区间 */
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/** 0-255 整数转两位 hex */
const toHex2 = (n: number): string => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");

/** 解析 hex，支持 #RGB / #RGBA / #RRGGBB / #RRGGBBAA，非法返回黑色 */
const parseHex = (input: string): RGBA => {
  let hex = input.trim().replace(/^#/, "");
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (hex.length === 6 || hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
};

/** RGBA 转 hex，alpha 为 1 或 withAlpha=false 时省略 alpha 段 */
const rgbaToHex = ({ r, g, b, a }: RGBA, withAlpha: boolean): string => {
  const base = `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
  if (!withAlpha || a >= 1) return base;
  return `${base}${toHex2(a * 255)}`;
};

/** RGB(0-255) 转 HSV(h:0-360, s/v:0-100) */
const rgbToHsv = ({ r, g, b }: Pick<RGBA, "r" | "g" | "b">): HSV => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const mx = Math.max(rn, gn, bn);
  const mn = Math.min(rn, gn, bn);
  const d = mx - mn;
  let hue = 0;
  if (d !== 0) {
    if (mx === rn) hue = 60 * (((gn - bn) / d) % 6);
    else if (mx === gn) hue = 60 * ((bn - rn) / d + 2);
    else hue = 60 * ((rn - gn) / d + 4);
  }
  if (hue < 0) hue += 360;
  const sat = mx === 0 ? 0 : d / mx;
  return { h: hue, s: sat * 100, v: mx * 100 };
};

/** HSV(h:0-360, s/v:0-100) 转 RGB(0-255) */
const hsvToRgb = ({ h, s, v }: HSV): Pick<RGBA, "r" | "g" | "b"> => {
  const sn = s / 100;
  const vn = v / 100;
  const c = vn * sn;
  const h6 = (h % 360) / 60;
  const x = c * (1 - Math.abs((h6 % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (h6 < 1) [r, g, b] = [c, x, 0];
  else if (h6 < 2) [r, g, b] = [x, c, 0];
  else if (h6 < 3) [r, g, b] = [0, c, x];
  else if (h6 < 4) [r, g, b] = [0, x, c];
  else if (h6 < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = vn - c;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
};

/** 棋盘格多层 gradient 定义，用于模拟透明背景 */
const CHECKER_IMAGE =
  "linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)";
const CHECKER_POSITION = "0 0, 0 4px, 4px -4px, -4px 0";

/** 纯棋盘格背景样式 */
const checkerStyle = {
  backgroundColor: "#fff",
  backgroundImage: CHECKER_IMAGE,
  backgroundSize: "8px 8px",
  backgroundPosition: CHECKER_POSITION,
};

/** 在棋盘格之上叠一层纯色，alpha<1 时棋盘透出 */
const buildChipStyle = (color: string): Record<string, string> => ({
  backgroundColor: "#fff",
  backgroundImage: `linear-gradient(${color}, ${color}), ${CHECKER_IMAGE}`,
  backgroundSize: "100% 100%, 8px 8px, 8px 8px, 8px 8px, 8px 8px",
  backgroundPosition: `0 0, ${CHECKER_POSITION}`,
});

/** 色相 0-360 */
const h = ref(0);
/** 饱和度 0-100 */
const s = ref(0);
/** 明度 0-100 */
const v = ref(0);
/** 不透明度 0-1 */
const a = ref(1);

/** 将外部 hex 解析为 HSV + alpha，s=0 时保持原 hue 避免漂移 */
const syncFromModel = (hex: string): void => {
  const rgba = parseHex(hex);
  const hsv = rgbToHsv(rgba);
  if (hsv.s > 0) h.value = hsv.h;
  s.value = hsv.s;
  v.value = hsv.v;
  a.value = rgba.a;
};

syncFromModel(props.modelValue);

watch(
  () => props.modelValue,
  (val) => {
    if (val.toLowerCase() === currentHex.value.toLowerCase()) return;
    syncFromModel(val);
  },
);

/** 当前色的 RGBA 数值表示 */
const currentRgba = computed<RGBA>(() => ({
  ...hsvToRgb({ h: h.value, s: s.value, v: v.value }),
  a: a.value,
}));

/** 当前 hex 字符串，showAlpha=false 时省略 alpha 段 */
const currentHex = computed(() => rgbaToHex(currentRgba.value, props.showAlpha));

/** 不带 alpha 的 rgb() 字符串，用作 alpha 滑条渐变终点色 */
const currentRgb = computed(() => {
  const { r, g, b } = currentRgba.value;
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
});

/** 带 alpha 的 rgba() 字符串，用作 chip / thumb 实际显示 */
const currentBg = computed(() => {
  const { r, g, b, a: al } = currentRgba.value;
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${al})`;
});

/** SV 面板背景：底层随 hue 变化的水平渐变 + 上层黑色纵向渐变 */
const svBackground = computed(
  () =>
    `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h.value}, 100%, 50%))`,
);

/** 触发器色块样式 */
const chipStyle = computed(() => buildChipStyle(currentBg.value));

/** 把当前状态转 hex 并通知父组件 */
const emitUpdate = (): void => {
  const next = currentHex.value;
  if (next === props.modelValue) return;
  emit("update:modelValue", next);
};

/** HEX 输入框本地值，允许输入过程中暂时非法 */
const hexInput = ref(currentHex.value);
watch(currentHex, (val) => {
  hexInput.value = val;
});

const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** 输入框 blur/enter 提交：合法则同步并上报，非法则回滚 */
const commitHex = (): void => {
  const raw = hexInput.value.trim();
  const norm = raw.startsWith("#") ? raw : `#${raw}`;
  if (HEX_RE.test(norm)) {
    syncFromModel(norm);
    emitUpdate();
  }
  hexInput.value = currentHex.value;
};

/**
 * 生成一组 pointer 事件处理器，把事件坐标换算为 track 内的 [0,1] 比例，交给 apply
 */
const useTrackPointer = (
  targetRef: Ref<HTMLElement | undefined>,
  apply: (ratioX: number, ratioY: number) => void,
): {
  onDown: (event: PointerEvent) => void;
  onMove: (event: PointerEvent) => void;
} => {
  const run = (event: PointerEvent): void => {
    const rect = targetRef.value?.getBoundingClientRect();
    if (!rect) return;
    const x = clamp(event.clientX - rect.left, 0, rect.width) / rect.width;
    const y = clamp(event.clientY - rect.top, 0, rect.height) / rect.height;
    apply(x, y);
    emitUpdate();
  };
  return {
    onDown: (event) => {
      if (props.disabled) return;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      run(event);
    },
    onMove: (event) => {
      if ((event.buttons & 1) === 0) return;
      run(event);
    },
  };
};

const svRef = ref<HTMLElement>();
const hueRef = ref<HTMLElement>();
const alphaRef = ref<HTMLElement>();

const sv = useTrackPointer(svRef, (x, y) => {
  s.value = x * 100;
  v.value = 100 - y * 100;
});
const hue = useTrackPointer(hueRef, (x) => {
  h.value = x * 360;
});
const alpha = useTrackPointer(alphaRef, (x) => {
  a.value = x;
});

/** 点击预设色块，同步到状态并上报 */
const selectSwatch = (swatch: string): void => {
  syncFromModel(swatch);
  emitUpdate();
};

/** 判断预设色是否等于当前值 */
const isSwatchActive = (swatch: string): boolean =>
  swatch.toLowerCase() === currentHex.value.toLowerCase();
</script>

<template>
  <div class="inline-flex items-center gap-2">
    <SPopover :side-offset="8" align="end">
      <template #trigger>
        <div
          class="inline-block p-1 rounded-lg border border-solid border-on-surface/20 shadow-sm transition-colors duration-200 hover:border-primary"
          :class="disabled ? 'opacity-40 pointer-events-none' : 'cursor-pointer'"
        >
          <div class="block w-6 h-6 rounded" :style="chipStyle" />
        </div>
      </template>

      <div class="flex flex-col gap-2.5 w-44">
        <div
          ref="svRef"
          class="relative w-full aspect-square rounded-lg overflow-hidden cursor-crosshair select-none touch-none"
          :style="{ background: svBackground }"
          @pointerdown="sv.onDown"
          @pointermove="sv.onMove"
        >
          <div
            class="absolute w-3.5 h-3.5 rounded-full border-2 border-solid border-white shadow-[0_1px_3px_rgba(0,0,0,0.5)] pointer-events-none"
            :style="{
              left: `clamp(7px, ${s}%, calc(100% - 7px))`,
              top: `clamp(7px, ${100 - v}%, calc(100% - 7px))`,
              translate: '-50% -50%',
            }"
          />
        </div>

        <div
          ref="hueRef"
          class="relative w-full h-3 rounded-full cursor-pointer select-none touch-none"
          :style="{
            background:
              'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
          }"
          @pointerdown="hue.onDown"
          @pointermove="hue.onMove"
        >
          <div
            class="absolute top-1/2 w-4 h-4 rounded-full border-2 border-solid border-white shadow-[0_1px_3px_rgba(0,0,0,0.5)] pointer-events-none"
            :style="{
              left: `clamp(8px, ${(h / 360) * 100}%, calc(100% - 8px))`,
              translate: '-50% -50%',
              background: `hsl(${h}, 100%, 50%)`,
            }"
          />
        </div>

        <div
          v-if="showAlpha"
          ref="alphaRef"
          class="relative w-full h-3 rounded-full cursor-pointer select-none touch-none"
          :style="checkerStyle"
          @pointerdown="alpha.onDown"
          @pointermove="alpha.onMove"
        >
          <div
            class="absolute inset-0 rounded-full"
            :style="{ background: `linear-gradient(to right, transparent, ${currentRgb})` }"
          />
          <div
            class="absolute top-1/2 w-4 h-4 rounded-full border-2 border-solid border-white shadow-[0_1px_3px_rgba(0,0,0,0.5)] pointer-events-none"
            :style="{
              left: `clamp(8px, ${a * 100}%, calc(100% - 8px))`,
              translate: '-50% -50%',
              background: currentBg,
            }"
          />
        </div>

        <div v-if="swatches.length" class="flex flex-wrap gap-1.5">
          <span
            v-for="sw in swatches"
            :key="sw"
            class="block w-5 h-5 rounded-md border border-solid border-on-surface/20 cursor-pointer transition-transform hover:scale-110"
            :class="isSwatchActive(sw) ? 'ring-2 ring-primary' : ''"
            :style="buildChipStyle(sw)"
            @click="selectSwatch(sw)"
          />
        </div>
      </div>
    </SPopover>

    <div class="w-32">
      <SInput
        v-model="hexInput"
        :disabled="disabled"
        @blur="commitHex"
        @keydown.enter="commitHex"
      />
    </div>
  </div>
</template>
