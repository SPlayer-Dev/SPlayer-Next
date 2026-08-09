<script setup lang="ts">
import type { Component } from "vue";
import type { LibraryStats } from "@shared/types/stats";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideDisc3 from "~icons/lucide/disc-3";
import IconLucideUser from "~icons/lucide/user";
import IconLucideClock from "~icons/lucide/clock";
import IconLucideHardDrive from "~icons/lucide/hard-drive";

const props = defineProps<{
  /** 曲库统计概览 */
  stats: LibraryStats | null;
}>();

const { t } = useI18n();
const router = useRouter();

/** 概览卡片 */
interface OverviewCard {
  key: string;
  icon: Component;
  /** 主数字 */
  value: string;
  /** 主数字单位（h / m / GB） */
  unit?: string;
  /** 第二段数字 */
  value2?: string;
  /** 第二段数字单位 */
  unit2?: string;
  /** 点击跳转路由 */
  to?: string;
}

/**
 * 点击卡片跳转对应页面
 * @param card - 卡片数据
 */
const navigateCard = (card: OverviewCard): void => {
  if (card.to) router.push(card.to);
};

/**
 * 总时长拆分为小时和分钟
 * @param ms - 总时长（毫秒）
 * @returns 小时与分钟
 */
const formatDurationParts = (ms: number): { hours: number; minutes: number } => {
  const totalMin = Math.floor(ms / 60000);
  return { hours: Math.floor(totalMin / 60), minutes: totalMin % 60 };
};

/**
 * 字节数拆分为数值与单位（MB / GB）
 * @param bytes - 字节数
 * @returns 数值与单位
 */
const formatSizeParts = (bytes: number): { value: string; unit: string } => {
  if (bytes < 1024 * 1024 * 1024) return { value: (bytes / (1024 * 1024)).toFixed(1), unit: "MB" };
  return { value: (bytes / (1024 * 1024 * 1024)).toFixed(1), unit: "GB" };
};

/** 顶部概览卡片 */
const overviewCards = computed<OverviewCard[]>(() => {
  const stats = props.stats;
  const duration = stats ? formatDurationParts(stats.totalDurationMs) : null;
  const size = stats ? formatSizeParts(stats.totalFileSize) : null;
  return [
    {
      key: "songs",
      icon: IconLucideMusic,
      value: stats ? String(stats.trackCount) : "--",
      to: "/library",
    },
    {
      key: "albums",
      icon: IconLucideDisc3,
      value: stats ? String(stats.albumCount) : "--",
      to: "/albums/local",
    },
    {
      key: "artists",
      icon: IconLucideUser,
      value: stats ? String(stats.artistCount) : "--",
      to: "/artists/local",
    },
    duration
      ? {
          key: "totalDuration",
          icon: IconLucideClock,
          value: String(duration.hours),
          unit: "h",
          value2: String(duration.minutes),
          unit2: "m",
        }
      : { key: "totalDuration", icon: IconLucideClock, value: "--" },
    size
      ? { key: "totalSize", icon: IconLucideHardDrive, value: size.value, unit: size.unit }
      : { key: "totalSize", icon: IconLucideHardDrive, value: "--" },
  ];
});
</script>

<template>
  <div class="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-5">
    <SCard
      v-for="card in overviewCards"
      :key="card.key"
      radius="xl"
      :hoverable="!!card.to"
      class="relative overflow-hidden"
      @click="navigateCard(card)"
    >
      <!-- 衬底图标 -->
      <component
        :is="card.icon"
        class="pointer-events-none absolute -right-2 -bottom-3 size-18 -rotate-14 text-primary/20"
      />
      <div class="relative flex h-full flex-col justify-between">
        <div class="flex items-baseline gap-0.5">
          <span class="text-3xl font-bold leading-none text-on-surface tabular-nums">
            {{ card.value }}
          </span>
          <span v-if="card.unit" class="text-sm font-medium text-on-surface-variant/70">
            {{ card.unit }}
          </span>
          <template v-if="card.value2 !== undefined">
            <span class="text-3xl font-bold leading-none text-on-surface tabular-nums">
              {{ card.value2 }}
            </span>
            <span v-if="card.unit2" class="text-sm font-medium text-on-surface-variant/70">
              {{ card.unit2 }}
            </span>
          </template>
        </div>
        <div class="truncate text-xs mt-1 text-on-surface-variant/50">
          {{ t(`stats.${card.key}`) }}
        </div>
      </div>
    </SCard>
  </div>
</template>
