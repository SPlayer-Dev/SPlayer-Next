<script setup lang="ts">
import type { Track, TrackSource } from "@shared/types/player";
import { useMediaStore } from "@/stores/media";
import { consumeCommentPageSnapshot } from "@/services/commentPageSnapshot";
import { useMusicComments } from "@/composables/useMusicComments";
import * as player from "@/core/player";
import CommentList from "@/components/comments/CommentList.vue";
import IconLucideArrowLeft from "~icons/lucide/arrow-left";
import IconLucidePlay from "~icons/lucide/play";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";
import IconLucideMessageCircleOff from "~icons/lucide/message-circle-off";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const media = useMediaStore();

const source = route.params.source as TrackSource;
const id = decodeURIComponent(route.params.id as string);

/** 构建独立页使用的冻结曲目快照 */
const buildSnapshot = (): Track | null => {
  const cached = consumeCommentPageSnapshot();
  if (cached) return cached;
  if (media.track && media.track.source === source && media.track.id === id) {
    return media.track;
  }
  const name = typeof route.query.name === "string" ? route.query.name : id;
  const artistsStr = typeof route.query.artists === "string" ? route.query.artists : "";
  return {
    id,
    source,
    title: name,
    artists: artistsStr ? artistsStr.split(" / ").map((name) => ({ name })) : [],
    duration: 0,
  };
};

const trackSnapshot = shallowRef<Track | null>(buildSnapshot());
const listScrollRef = ref<HTMLElement | null>(null);
const loadMoreSentinelRef = ref<HTMLElement | null>(null);
const comments = useMusicComments(trackSnapshot, listScrollRef);

const {
  sources,
  sourceId,
  activeTab,
  creatorComments,
  creatorIds,
  loading,
  page,
  sourceOptions,
  tabs,
  dedupedList,
  error,
} = comments;

const collapsed = ref(false);
let loadMoreObserver: IntersectionObserver | undefined;

const handleListScroll = (event: Event): void => {
  const scrollTop = (event.target as HTMLElement).scrollTop;
  if (!collapsed.value && scrollTop > 16) {
    collapsed.value = true;
  } else if (collapsed.value && scrollTop < 4) {
    collapsed.value = false;
  }
};

const handleBack = (): void => {
  router.back();
};

const handlePlay = (): void => {
  if (trackSnapshot.value) player.playNow(trackSnapshot.value);
};

onMounted(() => {
  loadMoreObserver = new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting) void comments.loadMore();
    },
    { root: listScrollRef.value, rootMargin: "0px 0px 400px", threshold: 0 },
  );
  if (loadMoreSentinelRef.value) loadMoreObserver.observe(loadMoreSentinelRef.value);
});

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
    <div v-if="trackSnapshot" class="shrink-0 px-5 pb-2">
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
        <SButton
          type="primary"
          variant="secondary"
          round
          class="shrink-0 mt-1"
          @click="handlePlay"
        >
          <template #icon><IconLucidePlay /></template>
          {{ t("comments.playTrack") }}
        </SButton>
      </div>
    </div>

    <div class="shrink-0 flex items-center gap-3 px-5 pb-3">
      <div class="min-w-0 flex-1">
        <STabs v-model="activeTab" :tabs="tabs" type="bar" size="medium" />
      </div>
      <SButton variant="ghost" circle size="small" :loading="loading" @click="comments.refresh">
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
      <div v-if="creatorComments.length" class="mb-5">
        <h3 class="text-sm font-semibold mb-3 text-on-surface">{{ t("comments.creator") }}</h3>
        <CommentList
          :items="creatorComments"
          :creator-ids="creatorIds"
          :column-min-width="360"
        />
      </div>

      <div
        v-if="!sources.length"
        class="flex items-center justify-center py-16 text-on-surface-variant/60"
      >
        <div class="text-center">
          <IconLucideMessageCircleOff class="mx-auto mb-4 size-14 opacity-30" />
          <div class="text-sm">{{ t("comments.noSource") }}</div>
        </div>
      </div>
      <div
        v-else-if="error && page.list.length === 0"
        class="flex flex-col items-center justify-center gap-3 py-16"
      >
        <div class="text-sm text-on-surface-variant">{{ error }}</div>
        <SButton variant="outline" @click="comments.loadPage(activeTab, 1)">
          {{ t("common.retry") }}
        </SButton>
      </div>
      <div
        v-else-if="page.list.length === 0 && loading"
        class="flex items-center justify-center py-16 text-on-surface-variant/60"
      >
        <div class="text-center">
          <SLoading class="mx-auto mb-4 block text-4xl text-primary/70" />
          <div class="text-sm">{{ t("comments.loading") }}</div>
        </div>
      </div>
      <div
        v-else-if="page.list.length === 0"
        class="flex items-center justify-center py-16 text-on-surface-variant/60"
      >
        <div class="text-center">
          <IconLucideMessageCircleOff class="mx-auto mb-4 size-14 opacity-30" />
          <div class="text-sm">{{ t("comments.empty") }}</div>
        </div>
      </div>
      <CommentList v-else :items="dedupedList" :column-min-width="360" />

      <div ref="loadMoreSentinelRef" class="h-px" />
      <div
        v-if="page.loadingMore"
        class="flex justify-center py-5 text-on-surface-variant/60"
      >
        <SLoading class="text-2xl" />
      </div>
      <div v-else-if="page.appendError" class="flex justify-center py-5">
        <SButton size="small" variant="outline" @click="comments.loadMore">
          {{ t("common.retry") }}
        </SButton>
      </div>
    </div>
  </div>
</template>
