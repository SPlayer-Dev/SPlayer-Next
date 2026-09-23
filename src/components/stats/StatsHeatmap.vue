<script setup lang="ts">
import type { DailyPlayStats, HourlyPlayStats, LibraryStats } from "@shared/types/stats";
import { isLosslessCodec } from "@/utils/quality";
import StatsDonutChart from "./StatsDonutChart.vue";
import IconLucideMusic from "~icons/lucide/music";

const props = defineProps<{
  /** 每日播放统计（近 90 天） */
  daily: DailyPlayStats[];
  /** 各小时累计播放统计 */
  hourly: HourlyPlayStats[];
  /** 曲库统计概览（取格式分布） */
  stats: LibraryStats | null;
  /** 数据是否仍在加载 */
  loading: boolean;
}>();

const { t, locale } = useI18n();

/** 热力图覆盖天数（含今天） */
const HEATMAP_DAYS = 90;

interface HeatCell {
  day: string;
  playCount: number;
  date: Date;
}

interface ChartPoint {
  x: number;
  y: number;
}

interface CodecVisual {
  id: string;
  codec: string;
  count: number;
  percent: number;
  opacity: number;
}

/**
 * 日期格式化为 YYYY-MM-DD
 * @param value - 月或日数字
 * @returns 两位数补零字符串
 */
const pad2 = (value: number): string => String(value).padStart(2, "0");
const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** 按周排列的近 90 天网格 */
const heatWeeks = computed<(HeatCell | null)[][]>(() => {
  const map = new Map(props.daily.map((item) => [item.day, item.playCount]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - (HEATMAP_DAYS - 1));
  const lead = start.getDay();
  const weeks: (HeatCell | null)[][] = [];
  let week: (HeatCell | null)[] = [];
  const total = lead + HEATMAP_DAYS;
  for (let i = 0; i < total; i++) {
    if (i < lead) {
      week.push(null);
    } else {
      const date = new Date(start);
      date.setDate(start.getDate() + (i - lead));
      const key = dayKey(date);
      week.push({ day: key, playCount: map.get(key) ?? 0, date });
    }
    if (week.length === 7 || i === total - 1) {
      weeks.push(week);
      week = [];
    }
  }
  return weeks;
});

const maxDayPlays = computed(() => Math.max(0, ...props.daily.map((item) => item.playCount)));

/**
 * 按播放次数占峰值比例映射格子背景色
 * @param playCount - 播放次数
 * @returns 背景色样式
 */
const cellStyle = (playCount: number): Record<string, string> => {
  if (playCount === 0) return { backgroundColor: "rgb(var(--s-primary) / 0.06)" };
  const ratio = playCount / maxDayPlays.value;
  const alpha = 0.14 + ratio * 0.72;
  return { backgroundColor: `rgb(var(--s-primary) / ${alpha})` };
};

/** 每列顶部月份标签，月份变化处显示 */
const weekMonthLabels = computed<(string | null)[]>(() => {
  const fmt = new Intl.DateTimeFormat(locale.value, { month: "short" });
  let previous: string | null = null;
  return heatWeeks.value.map((week) => {
    const cell = week.find((item) => item !== null);
    const label = cell ? fmt.format(cell.date) : null;
    const show = label && label !== previous ? label : null;
    if (label) previous = label;
    return show;
  });
});

/** 左侧星期标签 */
const rowLabels = computed<string[]>(() => {
  const sunday = new Date(2024, 0, 7); // 2024-01-07 是周日
  const fmt = new Intl.DateTimeFormat(locale.value, { weekday: "short" });
  return Array.from({ length: 7 }, (_, dow) => {
    const date = new Date(sunday);
    date.setDate(sunday.getDate() + dow);
    return fmt.format(date);
  });
});

/**
 * 生成格子提示文本
 * @param cell - 格子数据，空占位为 null
 * @returns 日期 + 播放次数
 */
const dayTooltip = (cell: HeatCell | null): string =>
  `${cell?.day ?? ""} · ${t("stats.plays", { count: cell?.playCount ?? 0 }, cell?.playCount ?? 0)}`;

/**
 * 取某列某行的播放次数
 * @param week - 周列数据
 * @param dow - 行号（1-7）
 * @returns 播放次数，空格子为 0
 */
const cellPlayCount = (week: (HeatCell | null)[], dow: number): number =>
  week[dow - 1]?.playCount ?? 0;

const hourlyMax = computed(() => Math.max(0, ...props.hourly.map((item) => item.playCount)));
const hourlyTotal = computed(() => props.hourly.reduce((sum, item) => sum + item.playCount, 0));
const peakHour = computed(() =>
  props.hourly.reduce<HourlyPlayStats | null>(
    (peak, item) => (!peak || item.playCount > peak.playCount ? item : peak),
    null,
  ),
);
/** 播放时段折线坐标 */
const hourlyPoints = computed<ChartPoint[]>(() =>
  Array.from({ length: 24 }, (_, hour) => {
    const count = props.hourly.find((item) => item.hour === hour)?.playCount ?? 0;
    const ratio = hourlyMax.value ? count / hourlyMax.value : 0;
    return {
      x: (hour / 23) * 240,
      y: 120 - ratio * 104,
    };
  }),
);
const peakPoint = computed(() => (peakHour.value ? hourlyPoints.value[peakHour.value.hour] : null));
const peakLabelX = computed(() => Math.min(212, Math.max(28, peakPoint.value?.x ?? 0)));
const peakLabelY = computed(() => Math.max(20, (peakPoint.value?.y ?? 0) - 20));

/** 使用 Catmull-Rom 转贝塞尔曲线平滑连接相邻时段 */
const hourlyLinePath = computed(() => {
  const points = hourlyPoints.value;
  if (points.length === 0) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    const control1Y = Math.min(120, Math.max(8, p1.y + (p2.y - p0.y) / 6));
    const control2Y = Math.min(120, Math.max(8, p2.y - (p3.y - p1.y) / 6));
    path += ` C ${p1.x + (p2.x - p0.x) / 6} ${control1Y}, ${p2.x - (p3.x - p1.x) / 6} ${control2Y}, ${p2.x} ${p2.y}`;
  }
  return path;
});

const hourlyAreaPath = computed(() => `${hourlyLinePath.value} L 240 124 L 0 124 Z`);

const codecs = computed(() => (props.stats?.codecs ?? []).filter((item) => item.codec.trim()));
const chartCodecs = computed(() => codecs.value.slice(0, 4));
const totalCodecCount = computed(() =>
  chartCodecs.value.reduce((sum, item) => sum + item.count, 0),
);

/** 圆环分段数据 */
const codecVisuals = computed<CodecVisual[]>(() => {
  return chartCodecs.value.map((item, index) => ({
    ...item,
    id: item.codec,
    percent: totalCodecCount.value ? (item.count / totalCodecCount.value) * 100 : 0,
    opacity: Math.max(0.24, 0.92 - index * 0.14),
  }));
});

const losslessCount = computed(() =>
  chartCodecs.value.reduce((sum, item) => sum + (isLosslessCodec(item.codec) ? item.count : 0), 0),
);

const losslessPercent = computed(() =>
  totalCodecCount.value ? (losslessCount.value / totalCodecCount.value) * 100 : 0,
);

const codecPercent = (count: number): string => {
  if (!totalCodecCount.value) return "0%";
  return `${((count / totalCodecCount.value) * 100).toFixed(1)}%`;
};

const codecLabel = (codec: string): string => {
  return codec ? codec.toUpperCase() : t("stats.unknown");
};
</script>

<template>
  <div class="grid grid-cols-[300px_minmax(0,1fr)] gap-5 xl:grid-cols-[300px_minmax(0,1fr)_400px]">
    <!-- 近 90 天热力图 -->
    <SCard radius="xl" class="flex h-52 min-w-0 flex-col gap-3">
      <div class="flex items-baseline justify-between gap-3">
        <h3 class="text-base font-semibold text-on-surface">
          {{ t("stats.listeningActivity") }}
        </h3>
        <span class="text-xs text-on-surface-variant/45">
          {{ t("stats.last90Days") }}
        </span>
      </div>

      <div class="mx-auto flex min-h-0 w-fit flex-1 items-center gap-2">
        <div class="grid shrink-0 grid-rows-[1.25rem_repeat(7,13px)] gap-y-0.5">
          <div />
          <div
            v-for="(label, dow) in rowLabels"
            :key="dow"
            class="flex items-center justify-end whitespace-nowrap text-xs leading-none text-on-surface-variant/50"
          >
            {{ [1, 3, 5].includes(dow) ? label : "" }}
          </div>
        </div>

        <div
          class="grid shrink-0 gap-0.5"
          :style="{
            gridTemplateColumns: `repeat(${heatWeeks.length}, 13px)`,
            gridTemplateRows: '1.25rem repeat(7, 13px)',
          }"
        >
          <div
            v-for="(label, weekIndex) in weekMonthLabels"
            :key="`m${weekIndex}`"
            class="whitespace-nowrap text-center text-xs leading-none text-on-surface-variant/50"
          >
            {{ label }}
          </div>
          <template v-for="dow in 7" :key="`r${dow}`">
            <STooltip
              v-for="(week, weekIndex) in heatWeeks"
              :key="weekIndex"
              :content="dayTooltip(week[dow - 1])"
              :disabled="!week[dow - 1]"
              side="top"
              align="center"
            >
              <div
                class="h-full min-h-0 w-full rounded-[3px]"
                :class="week[dow - 1] ? 'cursor-default' : 'opacity-0'"
                :style="cellStyle(cellPlayCount(week, dow))"
              />
            </STooltip>
          </template>
        </div>
      </div>

      <div class="flex items-center justify-center gap-2 text-xs text-on-surface-variant/50">
        <span>{{ t("stats.less") }}</span>
        <div
          v-for="level in 5"
          :key="level"
          class="size-3 rounded-[3px]"
          :style="cellStyle(Math.round((level / 5) * maxDayPlays))"
        />
        <span>{{ t("stats.more") }}</span>
      </div>
    </SCard>

    <!-- 播放时段分布 -->
    <SCard radius="xl" class="flex h-52 min-w-0 flex-col gap-2">
      <div class="flex items-baseline justify-between gap-3">
        <h3 class="text-base font-semibold text-on-surface">
          {{ t("stats.listeningHours") }}
        </h3>
      </div>

      <div class="relative min-h-0 flex-1">
        <svg class="absolute inset-0 size-full" viewBox="0 0 240 128" preserveAspectRatio="none">
          <template v-if="!loading && hourlyTotal > 0">
            <path :d="hourlyAreaPath" fill="rgb(var(--s-primary) / 0.08)" />
            <path
              :d="hourlyLinePath"
              fill="none"
              stroke="rgb(var(--s-primary))"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
          </template>
        </svg>
        <!-- 最高点指示点 -->
        <div
          v-if="!loading && hourlyTotal > 0 && peakHour"
          class="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-surface-panel shadow-sm"
          :style="{
            left: `${(hourlyPoints[peakHour.hour].x / 240) * 100}%`,
            top: `${(hourlyPoints[peakHour.hour].y / 128) * 100}%`,
          }"
        />
        <!-- 最高峰时段提示气泡 -->
        <div
          v-if="!loading && hourlyTotal > 0 && peakHour"
          class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-primary px-2 py-1 text-center text-[10px] font-semibold text-on-primary tabular-nums shadow-md"
          :style="{
            left: `${(peakLabelX / 240) * 100}%`,
            top: `${(peakLabelY / 128) * 100}%`,
          }"
        >
          <span
            class="block whitespace-nowrap text-[9px] font-medium leading-none text-on-primary/80"
          >
            {{ t("stats.peakListening") }}
          </span>
          <span class="mt-1 block whitespace-nowrap text-xs font-bold leading-none">
            {{ String(peakHour.hour).padStart(2, "0") }}:00
          </span>
        </div>
        <div
          v-if="!loading && hourlyTotal === 0"
          class="absolute inset-0 flex items-center justify-center text-sm text-on-surface-variant/40"
        >
          {{ t("stats.noPlayHistory") }}
        </div>
      </div>

      <div class="flex justify-between text-[10px] text-on-surface-variant/40 tabular-nums">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
      <p v-if="hourlyTotal > 0 && peakHour" class="text-center text-xs text-on-surface-variant/55">
        {{
          t("stats.favoriteHour", {
            hour: String(peakHour.hour).padStart(2, "0"),
            count: peakHour.playCount,
          })
        }}
      </p>
    </SCard>

    <!-- 音质构成 -->
    <SCard radius="xl" class="col-span-2 flex h-52 min-w-0 flex-col gap-3 xl:col-span-1">
      <div class="flex items-baseline justify-between gap-3">
        <h3 class="text-base font-semibold text-on-surface">
          {{ t("stats.audioQuality") }}
        </h3>
        <span class="text-xs text-on-surface-variant/45 tabular-nums">
          {{ loading ? "--" : t("stats.formatCount", { count: chartCodecs.length }) }}
        </span>
      </div>

      <div
        v-if="!loading && chartCodecs.length > 0"
        class="mx-auto flex min-h-0 w-full max-w-[520px] flex-1 items-center gap-4"
      >
        <StatsDonutChart :segments="codecVisuals">
          <span class="text-[10px] text-on-surface-variant/55">
            {{ t("stats.losslessRatio") }}
          </span>
          <span class="mt-1 text-xl font-bold leading-none text-on-surface tabular-nums">
            {{ losslessPercent.toFixed(1) }}%
          </span>
        </StatsDonutChart>

        <div class="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-3">
          <div
            v-for="codec in codecVisuals"
            :key="codec.codec"
            class="grid min-w-0 grid-cols-[0.5rem_minmax(0,1fr)] items-center gap-2"
          >
            <span class="size-2 rounded-full bg-primary" :style="{ opacity: codec.opacity }" />
            <div class="min-w-0">
              <div class="truncate text-xs font-medium text-on-surface">
                {{ codecLabel(codec.codec) }}
              </div>
              <div class="truncate text-[10px] text-on-surface-variant/50 tabular-nums">
                {{ codec.count }} {{ t("stats.trackUnit") }} · {{ codecPercent(codec.count) }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loading" class="flex min-h-0 flex-1 items-center justify-center">
        <SLoading class="size-6 text-primary/60" />
      </div>

      <div
        v-else
        class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-on-surface-variant/40"
      >
        <IconLucideMusic class="size-7" />
        <span class="text-sm">{{ t("stats.noDataHint") }}</span>
      </div>
    </SCard>
  </div>
</template>
