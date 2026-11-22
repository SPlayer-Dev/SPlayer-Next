<script setup lang="ts">
import type { SongWikiSheet } from "@/types/songWiki";
import { fetchSheetPreview } from "@/apis/song/wiki";

const props = defineProps<{
  /** 乐谱列表 */
  sheets: SongWikiSheet[];
}>();

const { t } = useI18n();

/** 缩放上下限与步进 */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

/** 乐谱预览图缓存，仅存活于当前页面 */
const previews = shallowRef<Record<string, string[]>>({});
/** 每个乐谱的在途请求令牌，切换乐谱时丢弃过期响应 */
const sheetTokens = new Map<string, number>();
/** 全局递增的请求序号 */
let requestToken = 0;

/** 当前查看的乐谱序号，-1 表示查看器关闭 */
const activeIndex = ref(-1);
const viewerOpen = ref(false);
const loading = ref(false);
const failed = ref(false);
/** 缩放比例，1 表示适应宽度 */
const zoom = ref(1);

const activeSheet = computed(() =>
  activeIndex.value >= 0 ? (props.sheets[activeIndex.value] ?? null) : null,
);

/** 当前乐谱的全部预览页地址 */
const pages = computed(() =>
  activeSheet.value ? (previews.value[activeSheet.value.id] ?? []) : [],
);

/**
 * 乐谱显示名称
 * @param sheet - 乐谱信息
 * @param index - 列表序号，从 0 开始
 * @returns 乐谱标题
 */
const sheetTitle = (sheet: SongWikiSheet, index: number): string => {
  const name = sheet.name || t("songWiki.sheet.fallbackName", { index: index + 1 });
  return sheet.playVersion ? `${name} · ${sheet.playVersion}` : name;
};

/** 查看器标题 */
const viewerTitle = computed(() =>
  activeSheet.value
    ? sheetTitle(activeSheet.value, activeIndex.value)
    : t("songWiki.sections.sheets"),
);

/**
 * 加载单个乐谱的预览图，成功后写回缓存
 * @param sheet - 目标乐谱
 * @param force - 是否强制重试（清除失败标记）
 */
const loadPreview = async (sheet: SongWikiSheet, force: boolean): Promise<void> => {
  const token = ++requestToken;
  sheetTokens.set(sheet.id, token);
  loading.value = true;
  if (force) failed.value = false;
  try {
    const urls = await fetchSheetPreview(sheet.id);
    if (sheetTokens.get(sheet.id) !== token) return;
    previews.value = { ...previews.value, [sheet.id]: urls };
    failed.value = false;
  } catch {
    if (sheetTokens.get(sheet.id) !== token) return;
    failed.value = true;
  } finally {
    if (sheetTokens.get(sheet.id) === token) loading.value = false;
  }
};

/**
 * 打开乐谱查看器，首次打开时懒加载预览图
 * @param index - 乐谱在列表中的序号
 */
const openViewer = (index: number): void => {
  const sheet = props.sheets[index];
  if (!sheet) return;
  activeIndex.value = index;
  viewerOpen.value = true;
  zoom.value = 1;
  failed.value = false;
  loading.value = false;
  if (!previews.value[sheet.id]) void loadPreview(sheet, false);
};

/** 重试加载当前乐谱的预览 */
const retry = (): void => {
  if (activeSheet.value) void loadPreview(activeSheet.value, true);
};

/** 放大一档 */
const zoomIn = (): void => {
  zoom.value = Math.min(ZOOM_MAX, zoom.value + ZOOM_STEP);
};

/** 缩小一档 */
const zoomOut = (): void => {
  zoom.value = Math.max(ZOOM_MIN, zoom.value - ZOOM_STEP);
};

/** 恢复适应宽度 */
const resetZoom = (): void => {
  zoom.value = 1;
};

/**
 * 查看器键盘操作：加减号缩放，0 恢复
 * @param event - 键盘事件
 */
const onKeydown = (event: KeyboardEvent): void => {
  if (!viewerOpen.value || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === "+" || event.key === "=") {
    zoomIn();
  } else if (event.key === "-") {
    zoomOut();
  } else if (event.key === "0") {
    resetZoom();
  }
};

/**
 * Ctrl/Cmd + 滚轮缩放预览图
 * @param event - 滚轮事件
 */
const onWheel = (event: WheelEvent): void => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  if (event.deltaY < 0) zoomIn();
  else zoomOut();
};

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="flex flex-col gap-2">
    <button
      v-for="(sheet, index) in sheets"
      :key="sheet.id"
      type="button"
      class="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-solid border-primary/20 bg-surface-panel px-3 py-2 text-left text-sm transition-colors hover:bg-on-surface/5"
      @click="openViewer(index)"
    >
      <img
        v-if="sheet.typeIcon"
        :src="sheet.typeIcon"
        loading="lazy"
        decoding="async"
        class="size-9 shrink-0 rounded-md object-contain"
        alt=""
      />
      <span
        v-else
        class="flex size-9 shrink-0 items-center justify-center rounded-md bg-on-surface/5 text-on-surface-variant/60"
      >
        <IconLucideMusic class="size-5" aria-hidden="true" />
      </span>
      <span class="min-w-0 flex-1 truncate font-medium">{{ sheetTitle(sheet, index) }}</span>
      <span v-if="sheet.totalPageSize" class="shrink-0 text-xs text-on-surface-variant/60">
        {{ t("songWiki.sheet.pageCount", { count: sheet.totalPageSize }) }}
      </span>
      <IconLucideChevronRight
        class="size-4 shrink-0 text-on-surface-variant/40 transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </button>

    <SDialog
      v-model:open="viewerOpen"
      :title="viewerTitle"
      width="min(94vw, 1200px)"
      height="88vh"
      content-style="padding: 0; overflow: hidden;"
    >
      <div class="flex h-full flex-col">
        <!-- 缩放工具栏 -->
        <div
          class="flex shrink-0 items-center justify-end gap-1 border-b border-solid border-outline-variant/20 px-4 py-2"
        >
          <SButton
            variant="text"
            size="small"
            circle
            :aria-label="t('songWiki.sheet.zoomOut')"
            @click="zoomOut"
          >
            <template #icon><IconLucideZoomOut /></template>
          </SButton>
          <button
            type="button"
            class="min-w-12 cursor-pointer rounded-md border-none bg-transparent px-1.5 py-0.5 text-xs tabular-nums text-on-surface-variant transition-colors hover:bg-on-surface/5"
            :title="t('songWiki.sheet.zoomReset')"
            @click="resetZoom"
          >
            {{ Math.round(zoom * 100) }}%
          </button>
          <SButton
            variant="text"
            size="small"
            circle
            :aria-label="t('songWiki.sheet.zoomIn')"
            @click="zoomIn"
          >
            <template #icon><IconLucideZoomIn /></template>
          </SButton>
        </div>

        <!-- 预览图：所有页依次纵向排列 -->
        <div class="min-h-0 flex-1 overflow-auto" @wheel="onWheel">
          <div v-if="loading" class="flex h-full items-center justify-center">
            <SLoading class="text-2xl text-primary/70" />
          </div>
          <div
            v-else-if="failed"
            class="flex h-full flex-col items-center justify-center gap-2 text-sm text-on-surface-variant/60"
          >
            <span>{{ t("songWiki.sheet.loadFailed") }}</span>
            <SButton size="tiny" variant="text" @click="retry">
              {{ t("common.retry") }}
            </SButton>
          </div>
          <div v-else-if="pages.length" class="space-y-4 p-4">
            <img
              v-for="(url, index) in pages"
              :key="index"
              :src="url"
              loading="lazy"
              decoding="async"
              class="mx-auto block h-auto max-w-none rounded-md bg-white"
              :style="{ width: `${zoom * 100}%` }"
              :alt="t('songWiki.sheet.pageAlt', { index: index + 1 })"
            />
          </div>
          <div
            v-else
            class="flex h-full items-center justify-center text-sm text-on-surface-variant/60"
          >
            {{ t("songWiki.sheet.empty") }}
          </div>
        </div>
      </div>
    </SDialog>
  </div>
</template>
