<script setup lang="ts">
import { useDataStore } from "@/stores/data";
import { useStatusStore } from "@/stores/status";
import { getHotSearches, type HotSearchItem } from "@/apis/search/hot";
import { getSearchSuggest, type SuggestData, type SuggestSimpleItem } from "@/apis/search/suggest";
import { songsByIds as getNeteaseSongsByIds } from "@/apis/song/netease";
import { formatCompact } from "@/utils/format";
import { navigateToAlbum, navigateToArtist, navigateToPlaylist } from "@/utils/navigate";
import { parseMusicLink, type LinkType } from "@/utils/link";
import type { TrackSource } from "@shared/types/player";
import * as player from "@/core/player";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideUser from "~icons/lucide/user";
import IconLucideDisc from "~icons/lucide/disc";
import IconLucideListMusic from "~icons/lucide/list-music";
import IconLucideAudioWaveform from "~icons/lucide/audio-waveform";

const { t, locale } = useI18n();
const router = useRouter();
const data = useDataStore();
const status = useStatusStore();

/** 弹窗开关挂在 status store，便于快捷键打开 */
const dialogOpen = computed({
  get: () => status.searchOpen,
  set: (value: boolean) => (status.searchOpen = value),
});
const searchQuery = ref("");
const recognitionOpen = ref(false);

const trimmedQuery = computed(() => searchQuery.value.trim());

/** 音乐链接检测 */
const parsedLink = computed(() => parseMusicLink(trimmedQuery.value));

/** 热搜结果 */
const hotItems = ref<HotSearchItem[]>([]);

const loadHot = async (): Promise<void> => {
  try {
    hotItems.value = await getHotSearches();
  } catch (err) {
    console.warn("[NavSearch] hot search failed:", err);
    hotItems.value = [];
  }
};

/** 搜索建议 */
const EMPTY_SUGGEST: SuggestData = { songs: [], albums: [], artists: [], playlists: [] };
const suggest = ref<SuggestData>({ ...EMPTY_SUGGEST });

const loadSuggest = useDebounceFn(async (keyword: string) => {
  try {
    suggest.value = await getSearchSuggest(keyword);
  } catch (err) {
    console.warn("[NavSearch] suggest failed:", err);
  }
}, 300);

type SuggestKind = "song" | "artist" | "album" | "playlist";

/**
 * 建议分类配置
 */
const suggestSections = computed(() => {
  const data = suggest.value;
  return [
    {
      kind: "song" as SuggestKind,
      icon: IconLucideMusic,
      label: t("search.tabs.songs"),
      items: data.songs.map<SuggestSimpleItem>((song) => ({
        id: song.id,
        name: song.name,
        subtitle: [song.artist, song.album].filter(Boolean).join(" · ") || undefined,
      })),
    },
    {
      kind: "artist" as SuggestKind,
      icon: IconLucideUser,
      label: t("search.tabs.artists"),
      items: data.artists,
    },
    {
      kind: "album" as SuggestKind,
      icon: IconLucideDisc,
      label: t("search.tabs.albums"),
      items: data.albums,
    },
    {
      kind: "playlist" as SuggestKind,
      icon: IconLucideListMusic,
      label: t("search.tabs.playlists"),
      items: data.playlists,
    },
  ].filter((sec) => sec.items.length > 0);
});

/** 跳转到搜索页 */
const submit = (raw: string): void => {
  const word = raw.trim();
  if (!word) return;
  data.addSearchHistory(word);
  router.push({ name: "search", query: { q: word } });
  dialogOpen.value = false;
};

const onSubmit = (): void => submit(trimmedQuery.value);
const onPickKeyword = (keyword: string): void => submit(keyword);
const onRemoveHistory = (keyword: string): void => data.removeSearchHistory(keyword);
const onClearHistory = (): void => data.clearSearchHistory();

/**
 * 建议点击
 * @param kind - 建议类型
 * @param id - 歌曲 id
 * @param name - 名称
 */
const navigateToResource = async (
  kind: SuggestKind | LinkType,
  id: string,
  source: TrackSource,
  name?: string,
): Promise<void> => {
  dialogOpen.value = false;
  switch (kind) {
    case "song":
      try {
        const [track] = await getNeteaseSongsByIds([Number(id)]);
        if (track) await player.playNow(track);
      } catch (err) {
        console.warn("[NavSearch] play song failed:", err);
      }
      break;
    case "artist":
      navigateToArtist(name, { source, artistId: id });
      break;
    case "album":
      navigateToAlbum(name, { source, albumId: id });
      break;
    case "playlist":
      navigateToPlaylist(id, { source, name });
      break;
  }
};

const onPickSuggest = (kind: SuggestKind, id: number, name: string): void => {
  if (trimmedQuery.value) data.addSearchHistory(trimmedQuery.value);
  navigateToResource(kind, String(id), "netease", name);
};

/** 音乐链接点击 */
const onPickLink = (): void => {
  const link = parsedLink.value;
  if (!link) return;
  navigateToResource(link.type, link.id, link.source);
};

const bodyRef = ref<HTMLElement | null>(null);
const bodyHeight = ref<number | null>(null);

useResizeObserver(bodyRef, (entries) => {
  if (bodyHeight.value === null) return;
  const next = entries[0]?.borderBoxSize?.[0]?.blockSize;
  if (next != null) bodyHeight.value = next;
});

const bodyStyle = computed(() =>
  bodyHeight.value !== null ? { height: `${bodyHeight.value}px` } : undefined,
);

const activeIndex = ref(-1);

/** 键盘上下导航 */
const keyboardItems = computed(() => {
  const items: Array<{ id: string; action: () => void }> = [];
  if (trimmedQuery.value) {
    if (parsedLink.value) {
      items.push({ id: "parsed-link", action: onPickLink });
    }
    items.push({ id: "quick", action: onSubmit });
    for (const sec of suggestSections.value) {
      for (const entry of sec.items) {
        items.push({
          id: `${sec.kind}-${entry.id}`,
          action: () => onPickSuggest(sec.kind, entry.id, entry.name),
        });
      }
    }
  } else {
    for (const word of data.searchHistory) {
      items.push({ id: `history-${word}`, action: () => onPickKeyword(word) });
    }
    hotItems.value
      .slice(0, 20)
      .forEach((item, idx) =>
        items.push({ id: `hot-${item.keyword}-${idx}`, action: () => onPickKeyword(item.keyword) }),
      );
  }
  return items;
});

watch(keyboardItems, () => {
  activeIndex.value = -1;
});

const isActive = (id: string) => {
  return activeIndex.value >= 0 && keyboardItems.value[activeIndex.value]?.id === id;
};

const scrollToActive = async () => {
  await nextTick();
  const id = keyboardItems.value[activeIndex.value]?.id;
  if (!id || !bodyRef.value) return;
  const safeId = id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const el = bodyRef.value.querySelector(`[data-search-id="${safeId}"]`) as HTMLElement;
  if (el) {
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
};

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (keyboardItems.value.length === 0) return;
    activeIndex.value = (activeIndex.value + 1) % keyboardItems.value.length;
    scrollToActive();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (keyboardItems.value.length === 0) return;
    activeIndex.value =
      (activeIndex.value - 1 + keyboardItems.value.length) % keyboardItems.value.length;
    scrollToActive();
  } else if (e.key === "Enter") {
    if (e.isComposing) return;
    e.preventDefault();
    if (activeIndex.value >= 0 && activeIndex.value < keyboardItems.value.length) {
      keyboardItems.value[activeIndex.value].action();
    } else {
      onSubmit();
    }
  }
};

const onMouseMove = () => {
  if (activeIndex.value !== -1) {
    activeIndex.value = -1;
  }
};

watch(trimmedQuery, (kw, prev) => {
  // 输入变化即清空建议
  suggest.value = { ...EMPTY_SUGGEST };
  if (kw) {
    // 进入搜索建议
    if (!prev) bodyHeight.value = 0;
    loadSuggest(kw);
  }
});

watch(dialogOpen, (open) => {
  if (open) {
    searchQuery.value = "";
    loadHot();
  } else {
    // 关闭复位：下次开弹仍是 auto 起手
    bodyHeight.value = null;
    activeIndex.value = -1;
  }
});

onMounted(() => {
  loadHot();
});
</script>

<template>
  <!-- 搜索框触发器与听歌识曲 -->
  <div class="flex items-center gap-2 shrink-0">
    <div
      role="button"
      :aria-label="t('nav.searchPlaceholder')"
      class="app-no-drag w-60 h-10 px-4 cursor-pointer flex items-center gap-2 rounded-full border border-solid bg-on-surface/3 border-on-surface/15 hover:bg-on-surface/10 hover:border-on-surface/25 transition-colors duration-250 select-none"
      @click="dialogOpen = true"
      @contextmenu.prevent="dialogOpen = true"
      @mousedown.prevent
    >
      <IconLucideSearch class="size-4 text-on-surface-variant/50 shrink-0" />
      <span class="flex-1 min-w-0 truncate text-base text-on-surface-variant/40">
        {{ t("nav.searchPlaceholder") }}
      </span>
    </div>
    <SButton
      class="app-no-drag shrink-0"
      variant="tertiary"
      circle
      :size="40"
      :icon-size="20"
      @click="recognitionOpen = true"
    >
      <template #icon><IconLucideAudioWaveform /></template>
    </SButton>
  </div>
  <!-- 听歌识曲 -->
  <RecognitionDialog v-model:open="recognitionOpen" />
  <!-- 搜索 -->
  <SDialog
    v-model:open="dialogOpen"
    :closable="false"
    :content-style="{ padding: 0 }"
    width="560px"
    top="12vh"
  >
    <div class="flex flex-col">
      <!-- 顶栏：输入框 -->
      <div class="px-4 pt-4 pb-3">
        <NavSearchInput
          v-model="searchQuery"
          :placeholder="t('nav.searchPlaceholder')"
          @keydown="onKeydown"
          @search="submit"
        />
      </div>
      <div class="overflow-hidden transition-[height] duration-300 ease-out" :style="bodyStyle">
        <div
          ref="bodyRef"
          class="max-h-[65vh] overflow-y-auto px-4 pb-4 flex flex-col gap-4"
          @mousemove="onMouseMove"
        >
          <template v-if="trimmedQuery">
            <!-- 快捷跳转 -->
            <div class="flex flex-col gap-1.5">
              <div class="px-2 flex items-center gap-1.5 text-sm font-medium text-primary">
                <IconLucideZap class="size-4" />
                <span>{{ t("nav.searchSection.quick") }}</span>
              </div>
              <!-- 链接跳转 -->
              <div
                v-if="parsedLink"
                class="min-w-0 flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-on-surface/5 transition-colors duration-200"
                :class="{ 'bg-on-surface/5': isActive('parsed-link') }"
                data-search-id="parsed-link"
                @click="onPickLink"
              >
                <span class="flex-1 truncate text-sm text-on-surface">
                  {{ t(`nav.link.${parsedLink.type}`, { id: parsedLink.id }) }}
                </span>
                <IconLucideArrowRight class="size-4 shrink-0 text-on-surface-variant" />
              </div>
              <!-- 搜索关键词 -->
              <div
                class="min-w-0 flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-on-surface/5 transition-colors duration-200"
                :class="{ 'bg-on-surface/5': isActive('quick') }"
                data-search-id="quick"
                @click="onSubmit"
              >
                <span class="flex-1 truncate text-sm text-on-surface">
                  {{ t("nav.searchGoto", { keyword: trimmedQuery }) }}
                </span>
                <IconLucideArrowRight class="size-4 shrink-0 text-on-surface-variant" />
              </div>
            </div>
            <!-- 建议分类 -->
            <div v-for="sec in suggestSections" :key="sec.kind" class="flex flex-col gap-1.5">
              <div class="px-2 flex items-center gap-1.5 text-sm font-medium text-primary">
                <component :is="sec.icon" class="size-4" />
                <span>{{ sec.label }}</span>
              </div>
              <div
                v-for="entry in sec.items"
                :key="entry.id"
                class="min-w-0 flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-on-surface/5 transition-colors duration-200"
                :class="{ 'bg-on-surface/5': isActive(`${sec.kind}-${entry.id}`) }"
                :data-search-id="`${sec.kind}-${entry.id}`"
                @click="onPickSuggest(sec.kind, entry.id, entry.name)"
              >
                <div class="flex-1 min-w-0 flex flex-col leading-tight">
                  <span class="truncate text-sm text-on-surface">{{ entry.name }}</span>
                  <span v-if="entry.subtitle" class="truncate text-xs text-on-surface-variant">
                    {{ entry.subtitle }}
                  </span>
                </div>
              </div>
            </div>
          </template>
          <template v-else>
            <!-- 历史 -->
            <div v-if="data.searchHistory.length > 0" class="flex flex-col gap-2">
              <div class="px-2 flex items-center justify-between">
                <div class="flex items-center gap-1.5 text-sm font-medium text-primary">
                  <IconLucideHistory class="size-4" />
                  <span>{{ t("nav.searchSection.history") }}</span>
                </div>
                <SButton variant="ghost" size="tiny" circle @click="onClearHistory">
                  <template #icon><IconLucideTrash2 /></template>
                </SButton>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <STag
                  v-for="word in data.searchHistory"
                  :key="word"
                  type="default"
                  round
                  closable
                  class="max-w-50 cursor-pointer hover:bg-on-surface/20 transition-colors duration-200"
                  :class="{ 'bg-on-surface/20': isActive(`history-${word}`) }"
                  :data-search-id="`history-${word}`"
                  @click="onPickKeyword(word)"
                  @close="onRemoveHistory(word)"
                >
                  <span class="truncate">{{ word }}</span>
                </STag>
              </div>
            </div>
            <!-- 空内容提示 -->
            <div
              v-if="data.searchHistory.length === 0 && hotItems.length === 0"
              class="py-10 flex flex-col items-center justify-center gap-2 text-on-surface-variant/40"
            >
              <IconLucideSearch class="size-8" />
              <span class="text-xs">{{ t("nav.searchEmpty") }}</span>
            </div>
            <!-- 热搜 -->
            <div v-if="hotItems.length > 0" class="flex flex-col gap-2">
              <div class="px-2 flex items-center gap-1.5 text-sm font-medium text-primary">
                <IconLucideFlame class="size-4" />
                <span>{{ t("nav.searchSection.hot") }}</span>
              </div>
              <div class="grid grid-cols-2 gap-x-2 gap-y-0.5">
                <div
                  v-for="(item, idx) in hotItems.slice(0, 20)"
                  :key="`${item.keyword}-${idx}`"
                  class="min-h-11 min-w-0 flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-on-surface/5 transition-colors duration-200"
                  :class="{ 'bg-on-surface/5': isActive(`hot-${item.keyword}-${idx}`) }"
                  :data-search-id="`hot-${item.keyword}-${idx}`"
                  @click="onPickKeyword(item.keyword)"
                >
                  <span
                    class="shrink-0 w-5 text-center text-sm font-semibold tabular-nums text-on-surface-variant/50"
                  >
                    {{ idx + 1 }}
                  </span>
                  <div class="flex-1 min-w-0 flex flex-col leading-tight">
                    <span class="truncate text-sm text-on-surface">{{ item.keyword }}</span>
                    <span v-if="item.content" class="truncate text-xs text-on-surface-variant">
                      {{ item.content }}
                    </span>
                  </div>
                  <span
                    v-if="item.score"
                    class="shrink-0 text-xs tabular-nums text-on-surface-variant/50"
                  >
                    {{ formatCompact(item.score, locale) }}
                  </span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </SDialog>
</template>
