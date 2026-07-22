<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { useMusicComments } from "@/composables/useMusicComments";
import CommentList from "@/components/comments/CommentList.vue";
import IconLucideX from "~icons/lucide/x";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";
import IconLucideMessageCircleOff from "~icons/lucide/message-circle-off";

interface Props {
  /** 展示模式：half 左半屏窄列，full 全屏多列 */
  mode: "half" | "full";
  /** 播放器当前是否处于沉浸状态 */
  immersive: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const media = useMediaStore();

const trackRef = computed(() => media.track ?? null);
const listScrollRef = ref<HTMLElement | null>(null);
const loadMoreSentinelRef = ref<HTMLElement | null>(null);
const comments = useMusicComments(trackRef, listScrollRef);

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

const columnMinWidth = computed(() => (props.mode === "half" ? 400 : 360));
const scrolling = ref(false);
let loadMoreObserver: IntersectionObserver | undefined;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;

const handleClose = (): void => emit("close");

const handleScroll = (): void => {
  scrolling.value = true;
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    scrolling.value = false;
  }, 700);
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

onBeforeUnmount(() => {
  loadMoreObserver?.disconnect();
  clearTimeout(scrollTimer);
});
</script>

<template>
  <div class="flex flex-col h-full text-cover">
    <div class="shrink-0 flex items-center gap-3 pb-3">
      <SImg
        v-if="media.track?.cover"
        :src="media.track.cover"
        class="size-12 rounded-lg shrink-0"
        alt=""
      />
      <div v-else class="size-12 rounded-lg shrink-0 bg-cover/14" />
      <div class="flex-1 min-w-0">
        <div class="text-base truncate font-medium leading-snug">{{ media.track?.title }}</div>
        <div class="text-sm truncate leading-snug mt-0.5 text-cover/55">
          {{ media.track?.artists.map((artist) => artist.name).join(" / ") }}
        </div>
      </div>
      <SButton type="cover" variant="ghost" circle @click="handleClose">
        <template #icon><IconLucideX /></template>
      </SButton>
    </div>

    <div class="shrink-0 flex items-center gap-3 pb-3">
      <div class="min-w-0 flex-1">
        <STabs v-model="activeTab" :tabs="tabs" type="bar" size="medium" />
      </div>
      <SButton
        type="cover"
        variant="ghost"
        circle
        size="small"
        :loading="loading"
        @click="comments.refresh"
      >
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
      class="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-gutter:stable] [&::-webkit-scrollbar-thumb]:bg-cover/25 [&::-webkit-scrollbar-thumb:hover]:bg-cover/45"
      :class="immersive && !scrolling ? '[&::-webkit-scrollbar-thumb]:bg-transparent' : ''"
      @scroll="handleScroll"
    >
      <div v-if="creatorComments.length" class="mb-5">
        <h3 class="text-sm font-semibold mb-3">{{ t("comments.creator") }}</h3>
        <CommentList
          :items="creatorComments"
          :creator-ids="creatorIds"
          :column-min-width="columnMinWidth"
        />
      </div>

      <div
        v-if="!sources.length"
        class="flex items-center justify-center py-16 text-cover/35"
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
        <div class="text-sm text-cover/55">{{ error }}</div>
        <SButton variant="outline" @click="comments.loadPage(activeTab, 1)">
          {{ t("common.retry") }}
        </SButton>
      </div>
      <div
        v-else-if="page.list.length === 0 && loading"
        class="flex items-center justify-center py-16 text-cover/35"
      >
        <div class="text-center">
          <SLoading class="mx-auto mb-4 block text-4xl text-cover/50" />
          <div class="text-sm">{{ t("comments.loading") }}</div>
        </div>
      </div>
      <div
        v-else-if="page.list.length === 0"
        class="flex items-center justify-center py-16 text-cover/35"
      >
        <div class="text-center">
          <IconLucideMessageCircleOff class="mx-auto mb-4 size-14 opacity-30" />
          <div class="text-sm">{{ t("comments.empty") }}</div>
        </div>
      </div>
      <CommentList v-else :items="dedupedList" :column-min-width="columnMinWidth" />

      <div ref="loadMoreSentinelRef" class="h-px" />
      <div v-if="page.loadingMore" class="flex justify-center py-5 text-cover/55">
        <SLoading class="text-2xl" />
      </div>
      <div v-else-if="page.appendError" class="flex justify-center py-5">
        <SButton size="small" type="cover" variant="outline" @click="comments.loadMore">
          {{ t("common.retry") }}
        </SButton>
      </div>
    </div>
  </div>
</template>
