<script setup lang="ts">
import type { DailyPlayStats, LibraryStats } from "@shared/types/stats";
import IconLucideHeadphones from "~icons/lucide/headphones";
import IconLucideMusic from "~icons/lucide/music";

const props = defineProps<{
  /** 每日播放统计（近 90 天） */
  daily: DailyPlayStats[];
  /** 曲库统计概览（取格式分布） */
  stats: LibraryStats | null;
}>();

const { t, locale } = useI18n();

/** 热力图覆盖天数（含今天） */
const HEATMAP_DAYS = 90;

interface HeatCell {
  day: string;
  playCount: number;
  date: Date;
}

/**
 * 日期格式化为 YYYY-MM-DD
 * @param value - 月或日数字
 * @returns 两位数补零字符串
 */
const pad2 = (value: number): string => String(value).padStart(2, "0");
const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * 按周排列的近 N 天网格，首周不足 7 天用 null 占位
 * @returns 外层周列，内层 7 行（周日至周六）
 */
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

/** 左侧星期标签（周一/周三/周五显示） */
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

const codecs = computed(() => props.stats?.codecs ?? []);
const maxCodecCount = computed(() => Math.max(0, ...codecs.value.map((item) => item.count)));
const totalCodecCount = computed(() => codecs.value.reduce((sum, item) => sum + item.count, 0));

/**
 * 按占比映射进度条背景色
 * @param count - 格式数量
 * @returns 背景色样式
 */
const codecBarStyle = (count: number): Record<string, string> => {
  const ratio = maxCodecCount.value ? count / maxCodecCount.value : 0;
  const alpha = 0.2 + ratio * 0.7;
  return { backgroundColor: `rgb(var(--s-primary) / ${alpha})` };
};

const codecPercent = (count: number): string => {
  if (!totalCodecCount.value) return "0%";
  return `${((count / totalCodecCount.value) * 100).toFixed(1)}%`;
};

const codecLabel = (codec: string): string => (codec ? codec.toUpperCase() : t("stats.unknown"));
</script>

<template>
  <div class="flex flex-col gap-5 overflow-hidden xl:flex-row xl:items-stretch">
    <SCard radius="xl" class="flex shrink-0 flex-col gap-4">
      <div class="relative flex gap-1">
        <!-- 星期标签 -->
        <div class="flex flex-col">
          <div class="h-5" />
          <div
            v-for="(label, dow) in rowLabels"
            :key="dow"
            class="flex h-3.5 items-center justify-end whitespace-nowrap pr-1 text-xs leading-none text-on-surface-variant/50"
          >
            {{ [1, 3, 5].includes(dow) ? label : "" }}
          </div>
        </div>
        <!-- 热力图网格 -->
        <div
          class="grid gap-0.5"
          :style="{
            gridTemplateColumns: `repeat(${heatWeeks.length}, minmax(0, 12px))`,
            gridTemplateRows: 'auto repeat(7, 12px)',
          }"
        >
          <!-- 月份标签 -->
          <div
            v-for="(label, weekIndex) in weekMonthLabels"
            :key="`m${weekIndex}`"
            class="mb-1.5 whitespace-nowrap text-center text-xs leading-none text-on-surface-variant/50"
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
                class="aspect-square w-full rounded-[2px]"
                :class="week[dow - 1] ? 'cursor-default' : 'opacity-0'"
                :style="cellStyle(cellPlayCount(week, dow))"
              />
            </STooltip>
          </template>
        </div>
        <!-- 无数据提示 -->
        <div
          v-if="daily.length === 0"
          class="absolute inset-0 flex items-center justify-center gap-2 text-on-surface-variant/40"
        >
          <IconLucideHeadphones class="size-7" />
          <span class="text-sm">{{ t("stats.noDataHint") }}</span>
        </div>
      </div>
      <!-- 图例 -->
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

    <!-- 格式分布（进度条） -->
    <SCard radius="xl" class="flex min-w-0 flex-1 flex-col justify-center gap-4">
      <div v-if="codecs.length > 0" class="flex flex-col gap-4">
        <div v-for="codec in codecs" :key="codec.codec" class="flex items-center gap-3">
          <span class="w-20 shrink-0 text-sm text-on-surface">
            {{ codecLabel(codec.codec) }}
          </span>
          <div class="h-2.5 flex-1 overflow-hidden rounded-full bg-on-surface/8">
            <div
              class="h-full rounded-full transition-[width] duration-500"
              :style="[
                codecBarStyle(codec.count),
                { width: `${(codec.count / maxCodecCount) * 100}%` },
              ]"
            />
          </div>
          <span
            class="w-12 shrink-0 text-right text-xs text-on-surface-variant/60 tabular-nums"
          >
            {{ codec.count }}
          </span>
          <span
            class="w-12 shrink-0 text-right text-xs text-on-surface-variant/45 tabular-nums"
          >
            {{ codecPercent(codec.count) }}
          </span>
        </div>
      </div>
      <div
        v-else
        class="flex min-h-[150px] flex-col items-center justify-center gap-2 text-on-surface-variant/40"
      >
        <IconLucideMusic class="size-7" />
        <span class="text-sm">{{ t("stats.noDataHint") }}</span>
      </div>
    </SCard>
  </div>
</template>
