<script setup lang="ts">
defineOptions({ name: "Ranking" });

import type { PlaybackContext, Track } from "@shared/types/player";
import type { PlayRankingEntry } from "@/types/user";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { useUserStore } from "@/stores/user";
import { useMediaStore } from "@/stores/media";
import { fetchPlayRanking } from "@/apis/user/netease";
import { toast } from "@/composables/useToast";
import SongList from "@/components/list/SongList.vue";
import * as player from "@/core/player";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";
import IconLucideListChecks from "~icons/lucide/list-checks";
import IconLucideListEnd from "~icons/lucide/list-end";

const { t } = useI18n();
const user = useUserStore();
const media = useMediaStore();

/** 排行范围 tab */
type RankingTab = "week" | "all";

const tab = ref<RankingTab>("week");
const searchQuery = ref("");
const weekEntries = shallowRef<PlayRankingEntry[]>([]);
const allEntries = shallowRef<PlayRankingEntry[]>([]);
const loading = ref(false);
/** 已加载排行归属的 userId，账号切换后需重新拉取 */
let loadedUserId: number | null = null;

const tabs = computed(() => [
  { key: "week", label: t("ranking.tabs.week") },
  { key: "all", label: t("ranking.tabs.all") },
]);

/** 当前 tab 的排行条目，保持接口返回的播放次数倒序 */
const currentEntries = computed<PlayRankingEntry[]>(() =>
  tab.value === "week" ? weekEntries.value : allEntries.value,
);

const currentTracks = computed<Track[]>(() => currentEntries.value.map((item) => item.track));

/** 曲目 id → 播放次数，供列表额外列读取 */
const playCounts = computed(
  () => new Map(currentEntries.value.map((item) => [item.track.id, item.playCount])),
);

const playingId = computed(() => media.track?.id);

/**
 * 拉取两个范围的排行
 * 一次拉齐，切换 tab 不再请求；接口 type：1 最近一周，0 所有时间
 * @param force - 忽略已加载状态强制刷新
 */
const load = async (force = false): Promise<void> => {
  const uid = user.profile?.userId;
  if (uid == null) {
    weekEntries.value = [];
    allEntries.value = [];
    loadedUserId = null;
    return;
  }
  if (!force && loadedUserId === uid) return;
  loading.value = true;
  try {
    const [week, all] = await Promise.allSettled([
      fetchPlayRanking(uid, 1),
      fetchPlayRanking(uid, 0),
    ]);
    // 请求期间可能已切换账号，丢弃过期结果
    if (user.profile?.userId !== uid) return;
    weekEntries.value = week.status === "fulfilled" ? week.value : [];
    allEntries.value = all.status === "fulfilled" ? all.value : [];
    // 全部失败时不记为已加载，下次进入页面重试
    if (week.status === "fulfilled" || all.status === "fulfilled") loadedUserId = uid;
  } finally {
    loading.value = false;
  }
};

watch(
  () => user.profile?.userId,
  () => void load(),
  { immediate: true },
);

const playbackContext = computed<PlaybackContext>(() => ({
  provider: "netease",
  originId: "ranking",
  originType: "page",
  originName: t("ranking.title"),
}));

/** 按排行顺序整体播放 */
const handlePlayAll = (): void => {
  if (currentTracks.value.length === 0) return;
  void player.playFrom(currentTracks.value, 0, playbackContext.value);
};

/** 把当前排行的全部曲目追加到播放列表末尾 */
const handleAddToQueue = (): void => {
  const added = player.insertManyToQueue(currentTracks.value, "end", playbackContext.value);
  if (added > 0) toast.success(t("ranking.toast.added"));
};

const songListRef = shallowRef<InstanceType<typeof SongList> | null>(null);

/** 更多菜单 */
const moreMenuItems = computed<DropdownMenuItem[]>(() => [
  { key: "queue", label: t("ranking.addToQueue"), icon: markRaw(IconLucideListEnd) },
  { key: "batch", label: t("songList.batch.manage"), icon: markRaw(IconLucideListChecks) },
  { key: "refresh", label: t("ranking.refresh"), icon: markRaw(IconLucideRefreshCw) },
]);

const handleMoreMenu = (key: string): void => {
  if (key === "refresh") void load(true);
  else if (key === "queue") handleAddToQueue();
  else if (key === "batch") songListRef.value?.enterBatch();
};
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pb-2">
      <div class="flex items-center justify-between mt-2 mb-4">
        <div class="flex items-baseline gap-4">
          <h1 class="text-3xl font-bold text-on-surface text-balance">{{ t("ranking.title") }}</h1>
          <span
            v-if="currentTracks.length > 0"
            class="text-sm text-on-surface-variant/50 flex items-center gap-1"
          >
            <IconLucideMusic class="size-3.5" />
            {{ t("common.totalSongs", { count: currentTracks.length }) }}
          </span>
        </div>
      </div>
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <SButton
            type="primary"
            variant="secondary"
            round
            :disabled="currentTracks.length === 0"
            @click="handlePlayAll"
          >
            <template #icon>
              <IconLucidePlay />
            </template>
            {{ t("common.playAll") }}
          </SButton>
          <SDropdownMenu :items="moreMenuItems" align="start" @select="handleMoreMenu">
            <template #trigger>
              <SButton variant="secondary" circle :disabled="!user.isLoggedIn">
                <template #icon>
                  <IconLucideEllipsis />
                </template>
              </SButton>
            </template>
          </SDropdownMenu>
        </div>
        <div class="flex items-center gap-3">
          <SInput
            v-model="searchQuery"
            :placeholder="t('common.search')"
            clearable
            round
            class="w-40 focus-within:w-56"
            data-search-input
          >
            <template #prefix>
              <IconLucideSearch class="size-4 text-on-surface-variant/40 shrink-0" />
            </template>
          </SInput>
          <div class="w-48">
            <STabs v-model="tab" :tabs="tabs" type="segment" round />
          </div>
        </div>
      </div>
    </div>
    <!-- 列表 -->
    <Transition name="fade" mode="out-in" :duration="150">
      <!-- 未登录 -->
      <div v-if="!user.isLoggedIn" key="login" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideTrendingUp class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm">{{ t("ranking.needLogin") }}</div>
        </div>
      </div>
      <!-- 列表 -->
      <div v-else-if="currentTracks.length > 0" :key="tab" class="flex-1 min-h-0">
        <SongList
          ref="songListRef"
          :items="currentTracks"
          :search-query="searchQuery"
          source="netease"
          :playback-context="playbackContext"
        >
          <template #extraHeader>
            <div class="w-24 shrink-0 text-right">{{ t("ranking.plays") }}</div>
          </template>
          <template #extra="{ item }">
            <div
              class="w-24 shrink-0 text-right text-sm tabular-nums"
              :class="playingId === item.id ? 'text-primary/60' : 'text-on-surface-variant'"
            >
              {{ playCounts.get(item.id) ?? 0 }}
            </div>
          </template>
        </SongList>
      </div>
      <!-- 加载中 -->
      <div v-else-if="loading" key="loading" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/60">
          <SLoading class="text-4xl text-primary/70 mb-4 mx-auto block" />
          <div class="text-sm">{{ t("common.loading") }}</div>
        </div>
      </div>
      <!-- 空 -->
      <div v-else key="empty" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideTrendingUp class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm">{{ t("ranking.empty") }}</div>
        </div>
      </div>
    </Transition>
  </div>
</template>
