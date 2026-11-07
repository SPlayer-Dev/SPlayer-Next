<script setup lang="ts">
/**
 * 妙控条收起把手
 *
 * 交互移植自 @applemusic-like-lyrics/react-full 的 ControlThumb（AGPL-3.0）：
 * 静止为 50×8 药丸，光标进入把手区域后收拢为 25×25 关闭方块并跟随光标，
 * 光标离开区域后回弹为药丸。跟随由 RAF 弹簧积分驱动（对齐 framer-motion
 * spring duration 0.5），静态命中区包着按钮本体，光标压在方块上时事件
 * 不漏出命中区，避免反复重放形变动画。
 */
import { setPlayerExpanded } from "@/services/playerTransition";

const { t } = useI18n();

/** 静止偏移：把 50×8 药丸平移到原点中心（AMLL 同值） */
const REST_OFFSET = { x: -25, y: -4 };
/** 跟随边界：光标位置折半后与原点的距离上限（AMLL 同值） */
const FOLLOW_BOUND = 25;
/** 弹簧参数：换算自 framer-motion duration 0.5（AMLL 同配置） */
const SPRING_STIFFNESS = 400;
const SPRING_DAMPING = 28;

const originRef = ref<HTMLElement>();
const btnRef = ref<HTMLButtonElement>();
/** 区域悬停中：方块成型 */
const hovering = ref(false);
/** 按压缩放中（AMLL whileTap） */
const pressing = ref(false);

/** 弹簧状态：当前值、速度与目标值 */
let springX = REST_OFFSET.x;
let springY = REST_OFFSET.y;
let velX = 0;
let velY = 0;
let targetX = REST_OFFSET.x;
let targetY = REST_OFFSET.y;
let springRaf: number | null = null;
let lastFrame = 0;

/** 把方块位置与按压缩放写进按钮（transform 恒不走 CSS 过渡，由弹簧驱动） */
const writeTransform = (): void => {
  const btn = btnRef.value;
  if (!btn) return;
  btn.style.transform = `translate(${springX}px, ${springY}px) scale(${pressing.value ? 0.9 : 1})`;
};

/**
 * 弹簧积分：每帧朝目标值收敛。悬停中持续积分不中断，避免微移时反复重启
 * 导致抽帧；仅当静止且已离开区域才停
 * @param now - 帧时间戳
 */
const springTick = (now: number): void => {
  const dt = Math.min((now - lastFrame) / 1000, 1 / 30);
  lastFrame = now;
  const ax = -SPRING_STIFFNESS * (springX - targetX) - SPRING_DAMPING * velX;
  const ay = -SPRING_STIFFNESS * (springY - targetY) - SPRING_DAMPING * velY;
  velX += ax * dt;
  velY += ay * dt;
  springX += velX * dt;
  springY += velY * dt;
  writeTransform();
  const settled =
    Math.abs(velX) < 0.5 &&
    Math.abs(velY) < 0.5 &&
    Math.abs(springX - targetX) < 0.1 &&
    Math.abs(springY - targetY) < 0.1;
  if (settled && !hovering.value) {
    springX = targetX;
    springY = targetY;
    velX = 0;
    velY = 0;
    springRaf = null;
    return;
  }
  springRaf = requestAnimationFrame(springTick);
};

/** 启动弹簧积分（已运行中则不重启） */
const startSpring = (): void => {
  if (springRaf !== null) return;
  lastFrame = performance.now();
  springRaf = requestAnimationFrame(springTick);
};

/** 更新目标值并保活积分 */
const setSpringTarget = (x: number, y: number): void => {
  targetX = x;
  targetY = y;
  startSpring();
};

/**
 * 依据光标位置更新方块目标偏移（半速追踪，AMLL 同公式）
 * @param e - 光标移动事件
 */
const trackCursor = (e: MouseEvent): void => {
  const rect = originRef.value?.getBoundingClientRect();
  if (!rect) return;
  const left = (e.clientX - rect.left) / 2;
  const top = (e.clientY - rect.top) / 2;
  if (Math.abs(left) > FOLLOW_BOUND || Math.abs(top) > FOLLOW_BOUND) {
    setSpringTarget(REST_OFFSET.x, REST_OFFSET.y);
  } else {
    setSpringTarget(left - FOLLOW_BOUND / 2, top - FOLLOW_BOUND / 2);
  }
};

/**
 * 光标进入把手区域：方块成型并立即对齐到当前光标
 * @param e - 光标进入事件
 */
const onRegionEnter = (e: MouseEvent): void => {
  hovering.value = true;
  trackCursor(e);
};

/** 光标离开把手区域（含方块）：回弹为静制药丸 */
const onRegionLeave = (): void => {
  hovering.value = false;
  pressing.value = false;
  setSpringTarget(REST_OFFSET.x, REST_OFFSET.y);
};

/** 按下，方块缩放 0.9（AMLL whileTap） */
const onPointerDown = (): void => {
  pressing.value = true;
  writeTransform();
};

/** 松手，恢复缩放 */
const onPointerUp = (): void => {
  pressing.value = false;
  writeTransform();
};

onBeforeUnmount(() => {
  if (springRaf !== null) cancelAnimationFrame(springRaf);
});
</script>

<template>
  <div ref="originRef" class="app-no-drag relative z-10 h-0 w-0">
    <!-- 静态命中区：100×100 包着按钮本体，光标压在方块上时事件不漏出区域 -->
    <div
      class="apple-thumb-region"
      @mouseenter="onRegionEnter"
      @mousemove="trackCursor"
      @mouseleave="onRegionLeave"
    >
      <button
        ref="btnRef"
        type="button"
        class="apple-thumb-btn"
        :class="{ 'is-hover': hovering }"
        tabindex="0"
        :aria-label="t('player.collapse')"
        @click="setPlayerExpanded(false)"
        @pointerdown="onPointerDown"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <span class="apple-thumb-bar apple-thumb-bar-first" />
        <span class="apple-thumb-bar apple-thumb-bar-second" />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 静态命中区：上下 ±50，与 AMLL 原样一致，按钮本体位居其中心 */
.apple-thumb-region {
  position: absolute;
  left: -50px;
  top: -50px;
  width: 100px;
  height: 100px;
  cursor: none;
}

/* 按钮四周 25px 透明命中区：方块半速跟随时光标最远在方块前 25px，
   扩出命中区后光标恒落在按钮内，跟手移动中点击也能命中 */
.apple-thumb-btn::after {
  content: "";
  position: absolute;
  inset: -25px;
}

/* 静置药丸：底色与方块态一致（AMLL 单一背景色）；transform 走脚本，此处仅静置基值 */
.apple-thumb-btn {
  position: absolute;
  left: 50px;
  top: 50px;
  width: 50px;
  height: 8px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: rgb(var(--s-cover) / 0.18);
  cursor: none;
  transform: translate(-25px, -4px);
  transition:
    width 0.5s cubic-bezier(0.34, 1.3, 0.64, 1),
    height 0.5s cubic-bezier(0.34, 1.3, 0.64, 1);
}

/* 悬停或键盘聚焦收拢为关闭方块，位置由弹簧驱动的内联 transform 跟随光标 */
.apple-thumb-btn.is-hover,
.apple-thumb-btn:focus-visible {
  width: 25px;
  height: 25px;
}

.apple-thumb-bar {
  position: absolute;
  left: 50%;
  top: 50%;
  display: block;
  width: 0;
  height: 0;
  border-radius: 10px;
  background: rgb(var(--s-cover));
  transform: translate(-50%, -50%) rotate(0deg);
  transition:
    width 0.5s cubic-bezier(0.34, 1.3, 0.64, 1),
    height 0.5s cubic-bezier(0.34, 1.3, 0.64, 1),
    transform 0.5s cubic-bezier(0.34, 1.3, 0.64, 1);
}

.apple-thumb-btn.is-hover .apple-thumb-bar,
.apple-thumb-btn:focus-visible .apple-thumb-bar {
  width: 15px;
  height: 2px;
}

.apple-thumb-btn.is-hover .apple-thumb-bar-first,
.apple-thumb-btn:focus-visible .apple-thumb-bar-first {
  transform: translate(-50%, -50%) rotate(45deg);
}

.apple-thumb-btn.is-hover .apple-thumb-bar-second,
.apple-thumb-btn:focus-visible .apple-thumb-bar-second {
  transform: translate(-50%, -50%) rotate(-45deg);
}

@media (prefers-reduced-motion: reduce) {
  .apple-thumb-btn,
  .apple-thumb-bar {
    transition-duration: 0.01s;
  }
}
</style>
