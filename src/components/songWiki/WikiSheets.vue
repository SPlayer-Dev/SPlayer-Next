<script setup lang="ts">
import type { SongWikiSheet } from "@/types/songWiki";
import { fetchSheetPreview } from "@/apis/song/wiki";
import { toast } from "@/composables/useToast";

defineProps<{
  /** 乐谱列表 */
  sheets: SongWikiSheet[];
}>();

const { t } = useI18n();

/** 当前展开的乐谱 ID，一次只展开一个 */
const expandedId = ref<string | null>(null);
/** 乐谱预览图缓存，仅存活于当前页面 */
const previews = shallowRef<Record<string, string[]>>({});
/** 正在加载预览的乐谱集合 */
const loadingIds = ref<Set<string>>(new Set());
/** 加载失败的乐谱集合，与「无预览内容」区分并允许重试 */
const failedIds = ref<Set<string>>(new Set());
/** 每个乐谱的在途请求令牌，收起再展开时丢弃过期响应 */
const sheetTokens = new Map<string, number>();
/** 全局递增的请求序号 */
let requestToken = 0;
/** 大图查看地址 */
const previewUrl = ref("");
const previewOpen = ref(false);

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

/**
 * 加载单个乐谱的预览图，成功后写回缓存，失败记录 failedIds
 * @param sheet - 目标乐谱
 * @param force - 是否强制重试（清除失败标记）
 */
const loadSheetPreview = async (sheet: SongWikiSheet, force: boolean): Promise<void> => {
  const token = ++requestToken;
  sheetTokens.set(sheet.id, token);
  loadingIds.value = new Set([...loadingIds.value, sheet.id]);
  if (force) failedIds.value = new Set([...failedIds.value].filter((id) => id !== sheet.id));
  try {
    const urls = await fetchSheetPreview(sheet.id);
    if (sheetTokens.get(sheet.id) !== token) return;
    previews.value = { ...previews.value, [sheet.id]: urls };
  } catch {
    if (sheetTokens.get(sheet.id) !== token) return;
    failedIds.value = new Set([...failedIds.value, sheet.id]);
    toast.error(t("songWiki.sheet.loadFailed"));
  } finally {
    if (sheetTokens.get(sheet.id) === token) {
      loadingIds.value = new Set([...loadingIds.value].filter((id) => id !== sheet.id));
    }
  }
};

/**
 * 展开 / 收起乐谱，首次展开时懒加载预览图
 * @param sheet - 目标乐谱
 */
const toggle = (sheet: SongWikiSheet): void => {
  if (expandedId.value === sheet.id) {
    expandedId.value = null;
    return;
  }
  expandedId.value = sheet.id;
  if (!previews.value[sheet.id] && !failedIds.value.has(sheet.id)) {
    void loadSheetPreview(sheet, false);
  }
};

/**
 * 重试加载失败乐谱的预览
 * @param sheet - 目标乐谱
 */
const retry = (sheet: SongWikiSheet): void => {
  void loadSheetPreview(sheet, true);
};

/**
 * 打开预览图大图
 * @param url - 图片地址
 */
const openPreview = (url: string): void => {
  previewUrl.value = url;
  previewOpen.value = true;
};
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      v-for="(sheet, index) in sheets"
      :key="sheet.id"
      class="rounded-lg border border-solid border-primary/20 bg-surface-panel"
    >
      <button
        type="button"
        class="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-2 text-left text-sm transition-colors hover:bg-on-surface/5"
        :aria-expanded="expandedId === sheet.id"
        @click="toggle(sheet)"
      >
        <IconLucideChevronDown
          class="size-4 shrink-0 transition-transform"
          :class="expandedId === sheet.id ? 'rotate-180' : ''"
        />
        <img
          v-if="sheet.coverImageUrl"
          :src="sheet.coverImageUrl"
          loading="lazy"
          decoding="async"
          class="size-10 shrink-0 rounded-md bg-surface-panel object-cover"
          alt=""
        />
        <span class="min-w-0 flex-1 truncate">{{ sheetTitle(sheet, index) }}</span>
        <span v-if="sheet.totalPageSize" class="shrink-0 text-xs text-on-surface-variant/60">
          {{ t("songWiki.sheet.pageCount", { count: sheet.totalPageSize }) }}
        </span>
      </button>
      <div v-if="expandedId === sheet.id" class="px-3 pb-3">
        <div v-if="loadingIds.has(sheet.id)" class="flex justify-center py-6">
          <SLoading class="text-2xl text-primary/70" />
        </div>
        <div
          v-else-if="failedIds.has(sheet.id)"
          class="flex flex-col items-center gap-2 py-6 text-sm text-on-surface-variant/60"
        >
          <span>{{ t("songWiki.sheet.loadFailed") }}</span>
          <SButton size="tiny" variant="text" @click="retry(sheet)">
            {{ t("common.retry") }}
          </SButton>
        </div>
        <div
          v-else-if="previews[sheet.id]?.length"
          class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
        >
          <button
            v-for="(url, imgIndex) in previews[sheet.id] ?? []"
            :key="url"
            type="button"
            class="block w-full cursor-zoom-in border-none bg-transparent p-0"
            :aria-label="t('songWiki.sheet.openPreview', { index: imgIndex + 1 })"
            @click="openPreview(url)"
          >
            <img
              :src="url"
              loading="lazy"
              decoding="async"
              class="w-full rounded-lg bg-surface-panel"
              alt=""
            />
          </button>
        </div>
        <div v-else class="py-6 text-center text-sm text-on-surface-variant/60">
          {{ t("songWiki.sheet.empty") }}
        </div>
      </div>
    </div>

    <SDialog
      v-model:open="previewOpen"
      :title="t('songWiki.sections.sheets')"
      width="min(92vw, 1100px)"
    >
      <img :src="previewUrl" class="h-auto w-full" :alt="t('songWiki.sections.sheets')" />
    </SDialog>
  </div>
</template>
