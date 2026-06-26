<script setup lang="ts">
/**
 * 任务栏频谱可视化组件
 * 24 个 DOM <span> 条，由 JS 驱动高度
 * 鼠标悬停时可压缩到指定条数（如 7 条），更紧凑
 */
interface Props {
  /** 频谱条高度数组 [0, 1] */
  bars: number[];
  /** 是否处于悬停状态 */
  hovered?: boolean;
  /** 悬停时显示的频谱条数，0 或 >= 24 时不压缩 */
  hoverBarCount?: number;
}

const props = withDefaults(defineProps<Props>(), {
  hovered: false,
  hoverBarCount: 7,
});

const BAR_COUNT = 24;

/** 悬停时压缩到 hoverBarCount 条，分段取平均 */
const displayBars = computed<number[]>(() => {
  if (!props.hovered || props.hoverBarCount <= 0 || props.hoverBarCount >= BAR_COUNT) {
    return props.bars;
  }
  const target = Math.min(BAR_COUNT, Math.max(1, Math.floor(props.hoverBarCount)));
  const result = new Array<number>(target);
  const segmentSize = BAR_COUNT / target;
  for (let i = 0; i < target; i++) {
    const start = Math.floor(i * segmentSize);
    const end = Math.max(start + 1, Math.floor((i + 1) * segmentSize));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < BAR_COUNT; j++) {
      sum += props.bars[j] ?? 0;
      count++;
    }
    result[i] = count > 0 ? sum / count : 0;
  }
  return result;
});
</script>

<template>
  <div class="spectrum-layer" :class="{ 'is-hovered': hovered }">
    <div class="spectrum">
      <span
        v-for="(bar, i) in displayBars"
        :key="i"
        :style="{ height: `${(5 + (bar ?? 0) * 17).toFixed(2)}px` }"
      />
    </div>
  </div>
</template>

<style scoped>
.spectrum-layer {
  position: absolute;
  inset: 0 4px 0 2px;
  display: flex;
  align-items: center;
  opacity: 0;
  transform: translateY(2px);
  transition:
    opacity 300ms cubic-bezier(0.2, 0.9, 0.1, 1),
    transform 300ms cubic-bezier(0.2, 0.9, 0.1, 1),
    top 300ms cubic-bezier(0.2, 0.9, 0.1, 1);
  pointer-events: none;
  will-change: opacity, transform;
}
.spectrum {
  width: min(210px, 100%);
  height: 22px;
  display: flex;
  align-items: center;
  gap: 3px;
  opacity: 0.92;
  transition: gap 0.25s ease;
}
.spectrum-layer.is-hovered .spectrum {
  gap: 4px;
}
.spectrum span {
  width: 3px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.78;
  transform-origin: center bottom;
  transition: height 30ms linear;
}
</style>
