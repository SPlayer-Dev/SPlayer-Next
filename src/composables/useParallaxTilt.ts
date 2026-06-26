/**
 * 3D 视差倾斜效果
 * 参照 BetterLyrics 的封面视差效果，鼠标移动时封面跟随倾斜
 */

interface ParallaxTiltOptions {
  /** 最大倾斜角度（度），默认 8 */
  maxTilt?: number;
  /** 透视距离（px），默认 800 */
  perspective?: number;
}

export function useParallaxTilt(options: ParallaxTiltOptions = {}) {
  const { maxTilt = 8, perspective = 800 } = options;

  const tiltX = ref(0);
  const tiltY = ref(0);
  const isHovering = ref(false);

  /** 计算倾斜 CSS transform */
  const tiltStyle = computed(() => {
    if (!isHovering.value) {
      return `perspective(${perspective}px) rotateX(0deg) rotateY(0deg)`;
    }
    return `perspective(${perspective}px) rotateX(${tiltX.value}deg) rotateY(${tiltY.value}deg)`;
  });

  /** 鼠标移动时计算倾斜角度 */
  const onMouseMove = (event: MouseEvent): void => {
    const target = event.currentTarget as HTMLElement;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    // 鼠标相对元素中心的归一化位置 [-1, 1]
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    // rotateX 绕 X 轴旋转（上下倾斜），rotateY 绕 Y 轴旋转（左右倾斜）
    tiltX.value = -y * maxTilt;
    tiltY.value = x * maxTilt;
    isHovering.value = true;
  };

  /** 鼠标离开时复位 */
  const onMouseLeave = (): void => {
    tiltX.value = 0;
    tiltY.value = 0;
    isHovering.value = false;
  };

  return { tiltStyle, onMouseMove, onMouseLeave };
}
