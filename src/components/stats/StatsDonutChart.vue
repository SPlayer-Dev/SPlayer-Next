<script setup lang="ts">
interface DonutSegment {
  id: string;
  percent: number;
  opacity: number;
}

interface DonutVisual extends DonutSegment {
  path: string;
}

interface ChartPoint {
  x: number;
  y: number;
}

const props = defineProps<{
  /** 按真实数据计算的圆环分段 */
  segments: DonutSegment[];
}>();

const RING_RADIUS = 46;
const RING_WIDTH = 16;
const RING_GAP = 2;
const RING_MIN_SEGMENT_PERCENT = 2.5;
const RING_CORNER_RADIUS = 2.5;
const RING_CENTER = 64;

/**
 * 将极坐标转换为圆环坐标
 * @param radius - 到圆心的距离
 * @param angle - 弧度角
 * @returns SVG 坐标
 */
const ringPoint = (radius: number, angle: number): ChartPoint => ({
  x: RING_CENTER + radius * Math.cos(angle),
  y: RING_CENTER + radius * Math.sin(angle),
});

/**
 * 生成带轻微圆角的圆环扇区路径
 * @param offsetPercent - 分段起点占比
 * @param segmentPercent - 分段视觉占比
 * @returns SVG 路径
 */
const roundedSegmentPath = (offsetPercent: number, segmentPercent: number): string => {
  const outerRadius = RING_RADIUS + RING_WIDTH / 2;
  const innerRadius = RING_RADIUS - RING_WIDTH / 2;
  const gapAngle = RING_GAP / RING_RADIUS;
  const startAngle = (offsetPercent / 100) * Math.PI * 2 + gapAngle / 2;
  const endAngle = ((offsetPercent + segmentPercent) / 100) * Math.PI * 2 - gapAngle / 2;
  const segmentAngle = endAngle - startAngle;
  const cornerRadius = Math.min(
    RING_CORNER_RADIUS,
    segmentAngle * innerRadius * 0.45,
    RING_WIDTH / 2,
  );
  const outerCornerAngle = cornerRadius / outerRadius;
  const innerCornerAngle = cornerRadius / innerRadius;

  const outerStart = ringPoint(outerRadius, startAngle + outerCornerAngle);
  const outerEnd = ringPoint(outerRadius, endAngle - outerCornerAngle);
  const outerEndCorner = ringPoint(outerRadius, endAngle);
  const outerEndEdge = ringPoint(outerRadius - cornerRadius, endAngle);
  const innerEndEdge = ringPoint(innerRadius + cornerRadius, endAngle);
  const innerEndCorner = ringPoint(innerRadius, endAngle);
  const innerEnd = ringPoint(innerRadius, endAngle - innerCornerAngle);
  const innerStart = ringPoint(innerRadius, startAngle + innerCornerAngle);
  const innerStartCorner = ringPoint(innerRadius, startAngle);
  const innerStartEdge = ringPoint(innerRadius + cornerRadius, startAngle);
  const outerStartEdge = ringPoint(outerRadius - cornerRadius, startAngle);
  const outerStartCorner = ringPoint(outerRadius, startAngle);
  const outerLargeArc = segmentAngle - outerCornerAngle * 2 > Math.PI ? 1 : 0;
  const innerLargeArc = segmentAngle - innerCornerAngle * 2 > Math.PI ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${outerLargeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `Q ${outerEndCorner.x} ${outerEndCorner.y} ${outerEndEdge.x} ${outerEndEdge.y}`,
    `L ${innerEndEdge.x} ${innerEndEdge.y}`,
    `Q ${innerEndCorner.x} ${innerEndCorner.y} ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${innerLargeArc} 0 ${innerStart.x} ${innerStart.y}`,
    `Q ${innerStartCorner.x} ${innerStartCorner.y} ${innerStartEdge.x} ${innerStartEdge.y}`,
    `L ${outerStartEdge.x} ${outerStartEdge.y}`,
    `Q ${outerStartCorner.x} ${outerStartCorner.y} ${outerStart.x} ${outerStart.y}`,
    "Z",
  ].join(" ");
};

/** 为极小分段分配可见宽度，并等比例压缩其余分段 */
const visuals = computed<DonutVisual[]>(() => {
  const smallSegmentCount = props.segments.filter(
    (segment) => segment.percent < RING_MIN_SEGMENT_PERCENT,
  ).length;
  const flexibleTotal = props.segments.reduce(
    (sum, segment) => (segment.percent >= RING_MIN_SEGMENT_PERCENT ? sum + segment.percent : sum),
    0,
  );
  const flexibleScale = flexibleTotal
    ? (100 - smallSegmentCount * RING_MIN_SEGMENT_PERCENT) / flexibleTotal
    : 1;

  let offset = 0;
  return props.segments.map((segment) => {
    const visualPercent =
      segment.percent < RING_MIN_SEGMENT_PERCENT
        ? RING_MIN_SEGMENT_PERCENT
        : segment.percent * flexibleScale;
    const visual = {
      ...segment,
      path: roundedSegmentPath(offset, visualPercent),
    };
    offset += visualPercent;
    return visual;
  });
});
</script>

<template>
  <div class="relative size-32 shrink-0">
    <svg class="size-full -rotate-90" viewBox="0 0 128 128" aria-hidden="true">
      <path
        v-for="segment in visuals"
        :key="segment.id"
        :d="segment.path"
        fill="rgb(var(--s-primary))"
        :opacity="segment.opacity"
      />
    </svg>
    <div class="absolute inset-0 flex flex-col items-center justify-center text-center">
      <slot />
    </div>
  </div>
</template>
