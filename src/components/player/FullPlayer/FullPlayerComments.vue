<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useMusicComments } from "@/composables/useMusicComments";
import CommentList from "@/components/comments/CommentList.vue";

interface Props {
  /** 展示模式：half 占左半屏窄列，full 全屏多列 */
  mode: "half" | "full";
  /** 播放器当前是否处于沉浸状态 */
  immersive: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const media = useMediaStore();
const settings = useSettingsStore();

const trackRef = computed(() => media.track ?? null);
const listScrollRef = ref<HTMLElement | null>(null);
const loadMoreSentinelRef = ref<HTMLElement | null>(null);
const creatorEnabled = computed(() => settings.system.comments.creatorEnabled);
const comments = useMusicComments(trackRef, listScrollRef, creatorEnabled);

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

const columnMinWidth = computed(() => (props.mode === "half" ? 400 : 360));
const artistNames = computed(() => media.track?.artists.map((artist) => artist.name).join(" / "));
const scrolling = ref(false);
let loadMoreObserver: IntersectionObserver | undefined;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;

/** 通知父组件关闭评论区 */
const handleClose = (): void => emit("close");

/** 滚动时短暂显示滚动条，静止后再隐去 */
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

onBeforeUnmount(() => {
  loadMoreObserver?.disconnect();
  clearTimeout(scrollTimer);
});
</script>

<template>
  <div class="flex h-full flex-col text-cover">
    <div class="shrink-0 flex items-start justify-between gap-4 pl-1 pb-4">
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
            <span v-if="artistNames" class="shrink-0 text-cover/25">·</span>
            <span v-if="artistNames" class="truncate">{{ artistNames }}</span>
          </div>
        </div>
      </div>
      <div
        class="shrink-0 flex items-center gap-3 transition-opacity duration-400"
        :class="immersive ? 'opacity-0 pointer-events-none' : 'opacity-100'"
      >
        <SButton
          type="cover"
          variant="secondary"
          round
          :size="40"
          :loading="loading"
          @click="refresh"
        >
          <template #icon><IconLucideRefreshCw /></template>
        </SButton>
        <SButton type="cover" variant="secondary" round :size="40" @click="handleClose">
          <template #icon><IconLucideX /></template>
        </SButton>
      </div>
    </div>

    <div class="shrink-0 flex items-center gap-4 pl-3 pb-3">
      <div class="min-w-0 flex-1">
        <STabs v-model="activeTab" :tabs="tabs" type="bar" size="medium" cover />
      </div>
      <div
        class="w-32 shrink-0 transition-opacity duration-400"
        :class="immersive ? 'opacity-0 pointer-events-none' : 'opacity-100'"
      >
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
        class="h-full overflow-y-auto pl-3 pr-2 pt-6 pb-8 [scrollbar-gutter:stable] [&::-webkit-scrollbar-thumb]:bg-cover/25 [&::-webkit-scrollbar-thumb:hover]:bg-cover/45"
        :class="immersive && !scrolling ? '[&::-webkit-scrollbar-thumb]:bg-transparent' : ''"
        @scroll="handleScroll"
      >
        <div v-if="creatorLoading && !creatorComments.length" class="mb-6">
          <div class="mb-3 flex items-center gap-2">
            <span class="h-4 w-0.5 rounded-full bg-cover/70" />
            <h3 class="m-0 text-sm font-semibold text-cover/85">{{ t("comments.creator") }}</h3>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div v-for="n in 4" :key="n" class="h-20 rounded-xl bg-cover/8 animate-pulse" />
          </div>
        </div>
        <div v-else-if="creatorComments.length" class="mb-6">
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
        <div v-else-if="creatorError" class="mb-6">
          <div class="mb-3 flex items-center gap-2">
            <span class="h-4 w-0.5 rounded-full bg-cover/70" />
            <h3 class="m-0 text-sm font-semibold text-cover/85">{{ t("comments.creator") }}</h3>
          </div>
          <div class="flex flex-col items-start gap-2">
            <p class="m-0 text-sm text-cover/55">{{ creatorError }}</p>
            <SButton size="small" type="cover" variant="outline" @click="retryCreator">
              {{ t("common.retry") }}
            </SButton>
          </div>
        </div>

        <div
          v-if="!sources.length && !error"
          class="flex min-h-64 items-center justify-center text-cover/35"
        >
          <div class="text-center">
            <IconLucideMessageCircleOff class="mx-auto mb-4 size-14 opacity-30" />
            <div class="text-sm">{{ t("comments.noSource") }}</div>
          </div>
        </div>
        <div
          v-else-if="error && !dedupedList.length"
          class="flex min-h-64 flex-col items-center justify-center gap-3"
        >
          <div class="text-sm text-cover/55">{{ error }}</div>
          <SButton type="cover" variant="outline" @click="retry">
            {{ t("common.retry") }}
          </SButton>
        </div>
        <div
          v-else-if="!dedupedList.length && loading"
          class="flex min-h-64 items-center justify-center text-cover/35"
        >
          <div class="text-center">
            <SLoading class="mx-auto mb-4 block text-4xl text-cover/50" />
            <div class="text-sm">{{ t("comments.loading") }}</div>
          </div>
        </div>
        <div
          v-else-if="!dedupedList.length"
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
          <SButton size="small" type="cover" variant="outline" @click="loadMore">
            {{ t("common.retry") }}
          </SButton>
        </div>
      </div>
    </div>
  </div>
</template>
