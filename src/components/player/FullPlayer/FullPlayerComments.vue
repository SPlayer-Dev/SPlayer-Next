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
const totalComments = computed(() => Math.max(page.value.total, dedupedList.value.length));
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
  <div class="flex h-full flex-col text-cover">
    <div class="shrink-0 flex items-start justify-between gap-4 pl-1 pr-20 pb-4">
      <div class="flex min-w-0 items-center gap-3 pl-2.5">
        <SImg
          v-if="media.track?.cover"
          :src="media.track.cover"
          class="size-12 shrink-0 rounded-lg"
          alt=""
        />
        <div v-else class="size-12 shrink-0 rounded-lg bg-cover/14" />
        <div class="min-w-0">
          <h2 class="m-0 truncate text-2xl font-semibold leading-tight">
            {{ t("comments.name") }}
          </h2>
          <div class="mt-1 flex min-w-0 items-center gap-2 text-sm text-cover/55">
            <span class="truncate">{{ media.track?.title }}</span>
            <span class="shrink-0 text-cover/25">·</span>
            <span class="shrink-0">{{ t("comments.total", { count: totalComments }) }}</span>
          </div>
        </div>
      </div>
      <div class="shrink-0 flex items-center gap-3">
        <SButton
          type="cover"
          variant="secondary"
          round
          :size="40"
          :loading="loading"
          @click="comments.refresh"
        >
          <template #icon><IconLucideRefreshCw /></template>
        </SButton>
        <SButton type="cover" variant="secondary" round :size="40" @click="handleClose">
          <template #icon><IconLucideX /></template>
        </SButton>
      </div>
    </div>

    <div class="shrink-0 flex items-center gap-4 pl-3 pr-20 pb-3">
      <div class="min-w-0 flex-1">
        <STabs v-model="activeTab" :tabs="tabs" type="bar" size="medium" cover />
      </div>
      <div class="w-32 shrink-0">
        <SSelect
          v-model="sourceId"
          :options="sourceOptions"
          :disabled="sources.length === 0 || loading"
          cover
        />
      </div>
    </div>

    <div
      class="relative min-h-0 flex-1"
      :style="{
        maskImage:
          'linear-gradient(180deg, transparent 0px, #000 24px, #000 calc(100% - 32px), transparent 100%)',
      }"
    >
      <div
        ref="listScrollRef"
        class="h-full overflow-y-auto pl-3 pr-20 pt-6 pb-8 [scrollbar-gutter:stable] [&::-webkit-scrollbar-thumb]:bg-cover/25 [&::-webkit-scrollbar-thumb:hover]:bg-cover/45"
        :class="immersive && !scrolling ? '[&::-webkit-scrollbar-thumb]:bg-transparent' : ''"
        @scroll="handleScroll"
      >
        <div v-if="creatorComments.length" class="mb-6">
          <div class="mb-3 flex items-center gap-2">
            <span class="h-4 w-0.5 rounded-full bg-cover/70" />
            <h3 class="m-0 text-sm font-semibold text-cover/85">{{ t("comments.creator") }}</h3>
          </div>
          <CommentList
            :items="creatorComments"
            :creator-ids="creatorIds"
            :column-min-width="columnMinWidth"
            cover
          />
        </div>

        <div v-if="!sources.length" class="flex min-h-64 items-center justify-center text-cover/35">
          <div class="text-center">
            <IconLucideMessageCircleOff class="mx-auto mb-4 size-14 opacity-30" />
            <div class="text-sm">{{ t("comments.noSource") }}</div>
          </div>
        </div>
        <div
          v-else-if="error && page.list.length === 0"
          class="flex min-h-64 flex-col items-center justify-center gap-3"
        >
          <div class="text-sm text-cover/55">{{ error }}</div>
          <SButton type="cover" variant="outline" @click="comments.loadPage(activeTab, 1)">
            {{ t("common.retry") }}
          </SButton>
        </div>
        <div
          v-else-if="page.list.length === 0 && loading"
          class="flex min-h-64 items-center justify-center text-cover/35"
        >
          <div class="text-center">
            <SLoading class="mx-auto mb-4 block text-4xl text-cover/50" />
            <div class="text-sm">{{ t("comments.loading") }}</div>
          </div>
        </div>
        <div
          v-else-if="page.list.length === 0"
          class="flex min-h-64 items-center justify-center text-cover/35"
        >
          <div class="text-center">
            <IconLucideMessageCircleOff class="mx-auto mb-4 size-14 opacity-30" />
            <div class="text-sm">{{ t("comments.empty") }}</div>
          </div>
        </div>
        <CommentList v-else :items="dedupedList" :column-min-width="columnMinWidth" cover />

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
  </div>
</template>
