/**
 * Spring 物理动画
 * 参照 WinIsland src/utils/physics.rs：临界阻尼弹簧模型
 * force = (target - value) * stiffness * dt
 * velocity = (velocity + force) * damping^dt
 * value += velocity * dt
 * dt 归一化到 60fps 基准（dt≈1），stiffness 通常 0.10~0.12，damping 0~1（0.68 左右）
 */
import type { Ref } from "vue";

export interface SpringOptions {
  /** 刚度，越大越硬，到达目标越快（WinIsland 尺度：0.10~0.12） */
  stiffness?: number;
  /** 阻尼，0~1，越大衰减越慢（WinIsland 尺度：0.68） */
  damping?: number;
  /** 初始值 */
  initial?: number;
}

export interface SpringResult {
  /** 当前值（响应式） */
  value: Ref<number>;
  /** 当前速度（非响应式，用于调试） */
  velocity: Readonly<Ref<number>>;
  /** 设置目标值 */
  setTarget: (target: number) => void;
  /** 立即跳转到指定值，无动画 */
  jumpTo: (value: number) => void;
  /** 停止动画 */
  stop: () => void;
}

/**
 * 创建一个 Spring 动画实例
 * 通过 RAF 驱动，值平滑趋近目标
 */
export function useSpring(options: SpringOptions = {}): SpringResult {
  const { stiffness = 0.1, damping = 0.68, initial = 0 } = options;

  const value = ref(initial);
  const velocity = ref(0);
  let target = initial;
  let rafId: number | null = null;
  let lastTime = 0;

  const tick = (time: number): void => {
    // 首帧保护：setTarget 已用 performance.now() 预热 lastTime，
    // 正常路径下不会进入此分支；仅防御极端情况下 lastTime 未被初始化
    if (lastTime === 0) {
      lastTime = time;
    }
    // dt 归一化到 60fps 基准（dt≈1），clamp 避免长帧导致发散
    const elapsed = time - lastTime;
    lastTime = time;
    const dt = Math.min(3, Math.max(0.1, (elapsed * 60) / 1000));

    const force = (target - value.value) * stiffness * dt;
    velocity.value = (velocity.value + force) * Math.pow(damping, dt);
    value.value += velocity.value * dt;

    // 发散保护：value 或 velocity 非有限时直接锚定到 target
    if (!Number.isFinite(value.value)) {
      value.value = target;
      velocity.value = 0;
      rafId = null;
      return;
    }
    if (!Number.isFinite(velocity.value)) {
      velocity.value = 0;
    }

    // 收敛判定：速度和位移都足够小则停止
    if (Math.abs(velocity.value) < 0.0001 && Math.abs(target - value.value) < 0.0001) {
      value.value = target;
      velocity.value = 0;
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  const setTarget = (next: number): void => {
    target = next;
    if (rafId === null) {
      // 用当前时间预热 lastTime，避免首帧 tick 仅记录时间不更新 value
      lastTime = performance.now();
      rafId = requestAnimationFrame(tick);
    }
  };

  const jumpTo = (next: number): void => {
    target = next;
    value.value = next;
    velocity.value = 0;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const stop = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  onBeforeUnmount(stop);

  return { value, velocity, setTarget, jumpTo, stop };
}
