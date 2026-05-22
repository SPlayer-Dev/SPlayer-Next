<script setup lang="ts">
import type { Track } from "@shared/types/player";
import type { SSelectOption } from "@/components/ui/SSelect.vue";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { useDataStore } from "@/stores/data";
import { useUserStore } from "@/stores/user";
import SongList from "@/components/list/SongList.vue";
import * as player from "@/core/player";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";
import IconLucideListChecks from "~icons/lucide/list-checks";

const { t, locale } = useI18n();
const data = useDataStore();
const user = useUserStore();

/** 一天的视图模型 */
interface DayView {
  /** 唯一键："today" 或归档日期 */
  key: string;
  /** 该天日期 */
  date: Date;
  /** 当天推荐曲目 */
  tracks: Track[];
  /** 是否今天 */
  isToday: boolean;
}

/** 今日 + 历史的可选天列表（今日在前） */
const days = computed<DayView[]>(() => {
  if (!user.isLoggedIn) return [];
  const result: DayView[] = [];
  if (data.dailyRecommend.length > 0) {
    result.push({ key: "today", date: new Date(), tracks: data.dailyRecommend, isToday: true });
  }
  for (const entry of data.dailyHistory) {
    result.push({
      key: entry.date,
      date: new Date(entry.date),
      tracks: entry.tracks,
      isToday: false,
    });
  }
  return result;
});

/** 当前选中的天键 */
const selectedKey = ref("today");

/** 当前选中的天，选不中时回落到首项 */
const selectedDay = computed<DayView | null>(
  () => days.value.find((day) => day.key === selectedKey.value) ?? days.value[0] ?? null,
);

/** 首次进入且无缓存时显示加载态 */
const loading = ref(data.dailyRecommend.length === 0);

/** 播放选中天的全部曲目 */
const handlePlayAll = (): void => {
  const tracks = selectedDay.value?.tracks ?? [];
  if (tracks.length > 0) player.playFrom(tracks, 0);
};

/** 按当前语言格式化日期的某个部分 */
const formatDate = (date: Date, options: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat(locale.value, options).format(date);

/** 日期下拉选项 */
const dayOptions = computed<SSelectOption[]>(() =>
  days.value.map((day) => ({
    value: day.key,
    label: day.isToday ? t("daily.today") : formatDate(day.date, { month: "long", day: "numeric" }),
  })),
);

const songListRef = shallowRef<InstanceType<typeof SongList> | null>(null);

/** 更多操作菜单 */
const moreMenuItems = computed<DropdownMenuItem[]>(() => [
  { key: "refresh", label: t("daily.refresh"), icon: markRaw(IconLucideRefreshCw) },
  { key: "batch", label: t("songList.batch.manage"), icon: markRaw(IconLucideListChecks) },
]);

/** 处理更多操作 */
const handleMore = (key: string): void => {
  if (key === "refresh") {
    selectedKey.value = "today";
    data.ensureDailyRecommend(true);
  } else if (key === "batch") {
    songListRef.value?.enterBatch();
  }
};

watch(
  () => user.isLoggedIn,
  (loggedIn) => {
    if (!loggedIn) {
      loading.value = false;
      return;
    }
    if (data.dailyRecommend.length === 0) loading.value = true;
    data.ensureDailyRecommend().finally(() => {
      loading.value = false;
    });
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pt-2 pb-3">
      <div class="flex items-center gap-5">
        <!-- 日历磁贴 -->
        <div
          class="flex size-28 shrink-0 flex-col items-center justify-center rounded-2xl border border-solid border-primary/15 bg-primary/8"
        >
          <template v-if="selectedDay">
            <span class="text-xs text-on-surface-variant/60">
              {{ formatDate(selectedDay.date, { month: "short" }) }}
            </span>
            <span class="text-4xl font-bold leading-tight text-primary tabular-nums">
              {{ selectedDay.date.getDate() }}
            </span>
            <span class="text-xs text-on-surface-variant/60">
              {{ formatDate(selectedDay.date, { weekday: "short" }) }}
            </span>
          </template>
          <IconLucideCalendarDays v-else class="size-8 text-primary/40" />
        </div>
        <!-- 信息 -->
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <!-- 标题 -->
          <div class="flex items-baseline gap-3">
            <h1 class="text-3xl font-bold text-on-surface">{{ t("daily.title") }}</h1>
            <span
              v-if="selectedDay && selectedDay.tracks.length > 0"
              class="flex items-center gap-1 text-sm text-on-surface-variant/50"
            >
              <IconLucideMusic class="size-3.5" />
              {{ t("common.totalSongs", { count: selectedDay.tracks.length }) }}
            </span>
          </div>
          <!-- 副标语 -->
          <p class="text-sm text-on-surface-variant/70">
            {{
              selectedDay && !selectedDay.isToday
                ? formatDate(selectedDay.date, { year: "numeric", month: "long", day: "numeric" })
                : t("daily.tagline")
            }}
          </p>
          <!-- 操作行 -->
          <div class="mt-1 flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <SButton
                type="primary"
                variant="secondary"
                round
                :disabled="!selectedDay || selectedDay.tracks.length === 0"
                @click="handlePlayAll"
              >
                <template #icon>
                  <IconLucidePlay />
                </template>
                {{ t("common.playAll") }}
              </SButton>
              <SDropdownMenu :items="moreMenuItems" align="start" @select="handleMore">
                <template #trigger>
                  <SButton variant="secondary" circle :disabled="!user.isLoggedIn">
                    <template #icon>
                      <IconLucideEllipsis />
                    </template>
                  </SButton>
                </template>
              </SDropdownMenu>
            </div>
            <!-- 历史日推：选今日 / 任一历史日 -->
            <SPopselect
              :model-value="selectedKey"
              :options="dayOptions"
              align="end"
              @update:model-value="selectedKey = String($event)"
            >
              <template #trigger="{ selected }">
                <SButton variant="secondary" round>
                  <IconLucideCalendarDays class="size-4 shrink-0 opacity-60" />
                  {{ selected?.label ?? t("daily.today") }}
                  <IconLucideChevronDown class="size-3.5 shrink-0 opacity-50" />
                </SButton>
              </template>
            </SPopselect>
          </div>
        </div>
      </div>
    </div>
    <!-- 列表 -->
    <Transition name="fade" mode="out-in" :duration="150">
      <!-- 未登录 -->
      <div v-if="!user.isLoggedIn" key="login" class="flex flex-1 items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideCalendarDays class="mx-auto mb-3 size-12 opacity-30" />
          <div class="text-sm">{{ t("daily.needLogin") }}</div>
        </div>
      </div>
      <!-- 列表 -->
      <div
        v-else-if="selectedDay && selectedDay.tracks.length > 0"
        :key="selectedDay.key"
        class="min-h-0 flex-1"
      >
        <SongList ref="songListRef" :items="selectedDay.tracks" source="netease" />
      </div>
      <!-- 加载中 -->
      <div v-else-if="loading" key="loading" class="flex flex-1 items-center justify-center">
        <div class="text-center text-on-surface-variant/60">
          <SLoading class="mx-auto mb-4 block text-4xl text-primary/70" />
          <div class="text-sm">{{ t("common.loading") }}</div>
        </div>
      </div>
      <!-- 空 -->
      <div v-else key="empty" class="flex flex-1 items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideCalendarDays class="mx-auto mb-3 size-12 opacity-30" />
          <div class="text-sm">{{ t("daily.empty") }}</div>
        </div>
      </div>
    </Transition>
  </div>
</template>
