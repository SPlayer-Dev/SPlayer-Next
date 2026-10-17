<script setup lang="ts">
import type { Track, TrackSource } from "@shared/types/player";
import { useMediaStore } from "@/stores/media";
import { consumeCommentPageSnapshot } from "@/services/commentPageSnapshot";
import { useMusicComments } from "@/composables/useMusicComments";
import * as player from "@/core/player";
import CommentList from "@/components/comments/CommentList.vue";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const media = useMediaStore();

const source = route.params.source as TrackSource;
const rawId = route.params.id as string;
/** 非法 URL 编码时回退原始字符串，避免 URIError 崩溃页面 */
let id: string;
try {
  id = decodeURIComponent(rawId);
} catch {
  id = rawId;
}

/**
 * 构建独立页使用的冻结曲目快照，依次回落到快照、当前曲目与路由参数
 * @returns 评论页曲目，脱离 store 的响应式追踪
 */
const buildSnapshot = (): Track => {
  const cached = consumeCommentPageSnapshot();
  if (cached) return cached;
  if (media.track && media.track.source === source && media.track.id === id) {
    return { ...toRaw(media.track) };
  }
  const name = typeof route.query.name === "string" ? route.query.name : id;
  const artistsStr = typeof route.query.artists === "string" ? route.query.artists : "";
  return {
    id,
    source,
    title: name,
    artists: artistsStr ? artistsStr.split(" / ").map((artistName) => ({ name: artistName })) : [],
    duration: 0,
  };
};

const trackSnapshot = shallowRef<Track>(buildSnapshot());
const listScrollRef = ref<HTMLElement | null>(null);
const loadMoreSentinelRef = ref<HTMLElement | null>(null);
const comments = useMusicComments(trackSnapshot, listScrollRef);

const {
  sources,
  sourceId,
  activeTab,
  creatorComments,
  creatorIds,
  creatorLoading,
  creatorError,
  loading,
  page,
  sourceOptions,
  tabs,
  dedupedList,
  error,
  loadMore,
  refresh,
  retry,
  retryCreator,
} = comments;

const collapsed = ref(false);
let loadMoreObserver: IntersectionObserver | undefined;

/**
 * 滚动时折叠头部，回到顶部再展开
 * @param event - 滚动事件
 */
const handleListScroll = (event: Event): void => {
  const scrollTop = (event.target as HTMLElement).scrollTop;
  if (!collapsed.value && scrollTop > 16) collapsed.value = true;
  else if (collapsed.value && scrollTop < 4) collapsed.value = false;
};

/** 返回上一页 */
const handleBack = (): void => {
  router.back();
};

/** 播放评论页对应的曲目 */
const handlePlay = (): void => {
  void player.playNow(trackSnapshot.value);
};

onMounted(() => {
  loadMoreObserver = new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting) void loadMore();
    },
    { root: listScrollRef.value, rootMargin: "0px 0px 400px", threshold: 0 },
  );
  if (loadMoreSentinelRef.value) loadMoreObserver.observe(loadMoreSentinelRef.value);
});

// 列表高度变化后哨兵可能仍在视口内，重新观察以触发下一次加载
watch(
  () => [activeTab.value, loading.value, page.value.list.length] as const,
  async () => {
    await nextTick();
    const sentinel = loadMoreSentinelRef.value;
    if (!sentinel || !loadMoreObserver) return;
    loadMoreObserver.unobserve(sentinel);
    loadMoreObserver.observe(sentinel);
  },
);

onBeforeUnmount(() => loadMoreObserver?.disconnect());
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="shrink-0 px-5 pb-2">
      <div
        class="flex mt-2 transition-[gap,margin] duration-250"
        :class="collapsed ? 'gap-3 mb-3' : 'gap-5 mb-4'"
      >
        <SButton variant="ghost" circle class="shrink-0 mt-1" @click="handleBack">
          <template #icon><IconLucideArrowLeft /></template>
        </SButton>
        <SImg
          v-if="trackSnapshot.cover"
          :src="trackSnapshot.cover"
          :alt="trackSnapshot.title"
          class="shrink-0 rounded-lg transition-[width,height] duration-250"
          :class="collapsed ? 'size-14' : 'size-20'"
        />
        <div
          v-else
          class="shrink-0 rounded-lg bg-on-surface/8 transition-[width,height] duration-250"
          :class="collapsed ? 'size-14' : 'size-20'"
        />
        <div class="flex-1 flex flex-col min-w-0 py-1">
          <h1
            class="font-bold text-on-surface truncate lh-normal transition-[font-size,line-height] duration-250"
            :class="collapsed ? 'text-lg' : 'text-2xl'"
          >
            {{ trackSnapshot.title }}
          </h1>
          <div
            class="truncate transition-[font-size,color] duration-250"
            :class="
              collapsed
                ? 'text-xs text-on-surface-variant/50'
                : 'text-sm text-on-surface-variant/60'
            "
          >
            {{ trackSnapshot.artists.map((artist) => artist.name).join(" / ") }}
          </div>
        </div>
        <SButton type="primary" variant="secondary" round class="shrink-0 mt-1" @click="handlePlay">
          <template #icon><IconLucidePlay /></template>
          {{ t("comments.playTrack") }}
        </SButton>
      </div>
    </div>

    <div class="shrink-0 flex items-center gap-3 px-5 pb-3">
      <div class="min-w-0 flex-1">
        <STabs v-model="activeTab" :tabs="tabs" type="bar" size="medium" />
      </div>
      <SButton variant="ghost" circle size="small" :loading="loading" @click="refresh">
        <template #icon><IconLucideRefreshCw /></template>
      </SButton>
      <div class="w-28 shrink-0">
        <SSelect
          v-model="sourceId"
          :options="sourceOptions"
          :disabled="sources.length === 0 || loading"
        />
      </div>
    </div>

    <div
      ref="listScrollRef"
      class="min-h-0 flex-1 overflow-y-auto px-5 pb-4 [scrollbar-gutter:stable]"
      @scroll="handleListScroll"
    >
      <div v-if="creatorLoading && !creatorComments.length" class="mb-5">
        <h3 class="text-sm font-semibold mb-3 text-on-surface">{{ t("comments.creator") }}</h3>
        <div class="grid grid-cols-2 gap-3">
          <div v-for="n in 4" :key="n" class="h-20 rounded-xl bg-on-surface/5 animate-pulse" />
        </div>
      </div>
      <div v-else-if="creatorComments.length" class="mb-5">
        <h3 class="text-sm font-semibold mb-3 text-on-surface">{{ t("comments.creator") }}</h3>
        <CommentList :items="creatorComments" :creator-ids="creatorIds" :column-min-width="360" />
      </div>
      <div v-else-if="creatorError" class="mb-5">
        <h3 class="text-sm font-semibold mb-3 text-on-surface">{{ t("comments.creator") }}</h3>
        <div class="flex flex-col items-start gap-2">
          <p class="m-0 text-sm text-on-surface-variant">{{ creatorError }}</p>
          <SButton size="small" variant="outline" @click="retryCreator">
            {{ t("common.retry") }}
          </SButton>
        </div>
      </div>

      <div
        v-if="!sources.length && !error"
        class="flex items-center justify-center py-16 text-on-surface-variant/60"
      >
        <div class="text-center">
          <IconLucideMessageCircleOff class="mx-auto mb-4 size-14 opacity-30" />
          <div class="text-sm">{{ t("comments.noSource") }}</div>
        </div>
      </div>
      <div
        v-else-if="error && !dedupedList.length"
        class="flex flex-col items-center justify-center gap-3 py-16"
      >
        <div class="text-sm text-on-surface-variant">{{ error }}</div>
        <SButton variant="outline" @click="retry">
          {{ t("common.retry") }}
        </SButton>
      </div>
      <div
        v-else-if="!dedupedList.length && loading"
        class="flex items-center justify-center py-16 text-on-surface-variant/60"
      >
        <div class="text-center">
          <SLoading class="mx-auto mb-4 block text-4xl text-primary/70" />
          <div class="text-sm">{{ t("comments.loading") }}</div>
        </div>
      </div>
      <div
        v-else-if="!dedupedList.length"
        class="flex items-center justify-center py-16 text-on-surface-variant/60"
      >
        <div class="text-center">
          <IconLucideMessageCircleOff class="mx-auto mb-4 size-14 opacity-30" />
          <div class="text-sm">{{ t("comments.empty") }}</div>
        </div>
      </div>
      <CommentList v-else :items="dedupedList" :column-min-width="360" />

      <div ref="loadMoreSentinelRef" class="h-px" />
      <div v-if="page.loadingMore" class="flex justify-center py-5 text-on-surface-variant/60">
        <SLoading class="text-2xl" />
      </div>
      <div v-else-if="page.appendError" class="flex justify-center py-5">
        <SButton size="small" variant="outline" @click="loadMore">
          {{ t("common.retry") }}
        </SButton>
      </div>
    </div>
  </div>
</template>
