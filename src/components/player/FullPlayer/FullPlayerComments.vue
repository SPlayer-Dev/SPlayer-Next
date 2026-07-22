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
}

const props = defineProps<Props>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const media = useMediaStore();

/** 全屏内嵌跟随当前播放曲目切换（与独立页冻结快照形成对比） */
const trackRef = computed(() => media.track ?? null);
const listScrollRef = ref<HTMLElement | null>(null);
const comments = useMusicComments(trackRef, listScrollRef);

const {
  sources,
  sourceId,
  activeTab,
  creatorComments,
  creatorIds,
  loading,
  page,
  maxPage,
  sourceOptions,
  tabs,
  dedupedList,
  error,
} = comments;

/** half 模式窄列（半屏宽度有限），full 模式标准列宽 */
const columnMinWidth = computed(() => (props.mode === "half" ? 400 : 280));

const handleClose = (): void => emit("close");
</script>

<template>
  <div class="flex flex-col h-full text-cover">
    <!-- 顶部精简歌曲信息头 -->
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
          {{ media.track?.artists.map((a) => a.name).join(" / ") }}
        </div>
      </div>
      <SButton type="cover" variant="ghost" circle @click="handleClose">
        <template #icon><IconLucideX /></template>
      </SButton>
    </div>

    <!-- 工具栏 -->
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

    <!-- 滚动内容区 -->
    <div ref="listScrollRef" class="min-h-0 flex-1 overflow-y-auto pr-1">
      <!-- 主创说分区 -->
      <div v-if="creatorComments.length" class="mb-5">
        <h3 class="text-sm font-semibold mb-3">{{ t("comments.creator") }}</h3>
        <CommentList
          :items="creatorComments"
          :creator-ids="creatorIds"
          :column-min-width="columnMinWidth"
        />
      </div>

      <!-- 四态分支 -->
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
        <SButton variant="outline" @click="comments.loadPage(activeTab, page.page)">
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
      <div v-else>
        <CommentList :items="dedupedList" :column-min-width="columnMinWidth" />
      </div>
    </div>

    <!-- 分页栏 -->
    <div
      v-if="sources.length"
      class="shrink-0 flex items-center justify-between py-3 text-xs text-cover/55"
    >
      <span>{{ t("comments.page", { page: page.page, total: maxPage }) }}</span>
      <div class="flex gap-2">
        <SButton
          size="small"
          variant="secondary"
          :disabled="page.page <= 1 || loading"
          @click="comments.changePage(-1)"
        >
          {{ t("common.prev") }}
        </SButton>
        <SButton
          size="small"
          variant="secondary"
          :disabled="page.page >= maxPage || loading"
          @click="comments.changePage(1)"
        >
          {{ t("common.next") }}
        </SButton>
      </div>
    </div>
  </div>
</template>
