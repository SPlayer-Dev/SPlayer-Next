<script setup lang="ts">
import type { FollowedArtistNewWork } from "@/apis/recommend/netease";
import { fetchFollowedArtistNewWorks, fetchFollowedArtistPlayAll } from "@/apis/recommend/netease";
import { useUserStore } from "@/stores/user";
import { toast } from "@/composables/useToast";
import NewReleaseGroup from "@/components/list/NewReleaseGroup.vue";
import * as player from "@/core/player";

const { t } = useI18n();
const user = useUserStore();

const works = shallowRef<FollowedArtistNewWork[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const playingLatest = ref(false);
const hasMore = ref(false);
const nextTimestamp = ref<number>();
const newSongCount = ref(0);
const searchQuery = ref("");
let loadToken = 0;

const filteredWorks = computed(() => {
  const keyword = searchQuery.value.trim().toLocaleLowerCase();
  if (!keyword) return works.value;
  return works.value.filter(
    (work) =>
      work.artistName.toLocaleLowerCase().includes(keyword) ||
      work.resourceName.toLocaleLowerCase().includes(keyword) ||
      work.tracks.some(
        (track) =>
          track.title.toLocaleLowerCase().includes(keyword) ||
          track.artists.some((artist) => artist.name.toLocaleLowerCase().includes(keyword)),
      ),
  );
});

/** 拉取发布流，刷新时重置时间游标 */
const load = async (reset: boolean): Promise<void> => {
  if (!user.isLoggedIn || loading.value || loadingMore.value) return;
  const token = reset ? ++loadToken : loadToken;
  const timestamp = reset ? Date.now() : nextTimestamp.value;
  if (timestamp === undefined) return;
  if (reset) loading.value = true;
  else loadingMore.value = true;
  try {
    const page = await fetchFollowedArtistNewWorks({
      startTimestamp: timestamp,
      firstRequest: reset,
    });
    if (token !== loadToken) return;
    if (reset) {
      works.value = page.works;
      newSongCount.value = page.newSongCount;
    } else {
      const existing = new Set(works.value.map((work) => work.id));
      works.value = [...works.value, ...page.works.filter((work) => !existing.has(work.id))];
    }
    nextTimestamp.value = page.nextTimestamp;
    hasMore.value = page.hasMore && page.nextTimestamp !== undefined && page.works.length > 0;
  } catch (error) {
    console.warn("[new-releases] load failed:", error);
    if (token === loadToken) toast.error(t("newReleases.loadFailed"));
  } finally {
    if (token === loadToken) {
      loading.value = false;
      loadingMore.value = false;
    }
  }
};

/** 播放接口与发布流分离，仅点击按钮时获取最新 50 首 */
const playLatest = async (): Promise<void> => {
  if (playingLatest.value) return;
  playingLatest.value = true;
  try {
    const tracks = await fetchFollowedArtistPlayAll();
    if (tracks.length > 0) await player.playFrom(tracks, 0);
    else toast.warning(t("newReleases.empty"));
  } catch (error) {
    console.warn("[new-releases] play latest failed:", error);
    toast.error(t("newReleases.playFailed"));
  } finally {
    playingLatest.value = false;
  }
};

watch(
  () => user.isLoggedIn,
  (loggedIn) => {
    if (loggedIn) {
      void load(true);
      return;
    }
    loadToken++;
    loading.value = false;
    loadingMore.value = false;
    works.value = [];
    hasMore.value = false;
    nextTimestamp.value = undefined;
    newSongCount.value = 0;
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pb-3">
      <div class="mt-2 flex min-w-0 items-baseline gap-4">
        <h1 class="shrink-0 text-3xl font-bold text-on-surface text-balance">
          {{ t("newReleases.title") }}
        </h1>
        <span class="truncate text-sm text-on-surface-variant/60">
          {{ t("newReleases.tagline") }}
        </span>
        <span
          v-if="user.isLoggedIn && newSongCount > 0"
          class="ml-auto shrink-0 text-sm tabular-nums text-on-surface-variant/50"
        >
          {{ t("common.totalSongs", { count: newSongCount }) }}
        </span>
      </div>
      <div class="mt-4 flex items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <SButton
            type="primary"
            round
            :loading="playingLatest"
            :disabled="!user.isLoggedIn"
            @click="playLatest"
          >
            <template #icon>
              <IconLucidePlay />
            </template>
            {{ t("newReleases.playLatest") }}
          </SButton>
          <SButton
            variant="secondary"
            circle
            :loading="loading"
            :disabled="!user.isLoggedIn"
            :title="t('newReleases.refresh')"
            @click="load(true)"
          >
            <template #icon>
              <IconLucideRefreshCw />
            </template>
          </SButton>
        </div>
        <SInput
          v-model="searchQuery"
          :placeholder="t('common.search')"
          clearable
          round
          class="w-40 focus-within:w-56"
        >
          <template #prefix>
            <IconLucideSearch class="size-4 shrink-0 text-on-surface-variant/40" />
          </template>
        </SInput>
      </div>
    </div>

    <Transition name="fade" mode="out-in" :duration="150">
      <div v-if="!user.isLoggedIn" key="login" class="flex flex-1 items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideSparkles class="mx-auto mb-3 size-12 opacity-30" />
          <div class="text-sm">{{ t("newReleases.needLogin") }}</div>
        </div>
      </div>
      <div v-else-if="works.length > 0" key="list" class="min-h-0 flex-1 overflow-y-auto">
        <div class="flex w-full flex-col gap-3 px-5 pb-24">
          <NewReleaseGroup v-for="work in filteredWorks" :key="work.id" :work="work" />

          <div
            v-if="searchQuery && filteredWorks.length === 0"
            class="flex min-h-52 flex-col items-center justify-center text-on-surface-variant/45"
          >
            <IconLucideSearchX class="mb-3 size-10 opacity-40" />
            <span class="text-sm">{{ t("newReleases.noResults") }}</span>
          </div>

          <div v-if="hasMore && !searchQuery" class="flex justify-center py-5">
            <SButton variant="secondary" round :loading="loadingMore" @click="load(false)">
              {{ t("newReleases.loadMore") }}
            </SButton>
          </div>
        </div>
      </div>
      <div v-else-if="loading" key="loading" class="flex flex-1 items-center justify-center">
        <div class="text-center text-on-surface-variant/60">
          <SLoading class="mx-auto mb-4 block text-4xl text-primary/70" />
          <div class="text-sm">{{ t("common.loading") }}</div>
        </div>
      </div>
      <div v-else key="empty" class="flex flex-1 items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideSparkles class="mx-auto mb-3 size-12 opacity-30" />
          <div class="text-sm">{{ t("newReleases.empty") }}</div>
        </div>
      </div>
    </Transition>
  </div>
</template>
