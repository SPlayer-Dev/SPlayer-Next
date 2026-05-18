<script setup lang="ts">
import { useDataStore } from "@/stores/data";
import { getHotSearches, type HotSearchItem } from "@/apis/search/hot";
import { getSearchSuggest, type SuggestData } from "@/apis/search/suggest";
import { songsByIds as getNeteaseSongsByIds } from "@/apis/song/netease";
import { formatCompact } from "@/utils/format";
import * as player from "@/core/player";

const { t, locale } = useI18n();
const router = useRouter();
const data = useDataStore();

const dialogOpen = ref(false);
const searchQuery = ref("");

const trimmedQuery = computed(() => searchQuery.value.trim());

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

/** 单曲建议点击 */
const onPickSong = async (id: number): Promise<void> => {
  if (trimmedQuery.value) data.addSearchHistory(trimmedQuery.value);
  dialogOpen.value = false;
  try {
    const [track] = await getNeteaseSongsByIds([id]);
    if (track) await player.playNow(track);
  } catch (err) {
    console.warn("[NavSearch] play suggest song failed:", err);
  }
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
  }
});

onMounted(() => {
  loadHot();
});
</script>

<template>
  <!-- 搜索框触发器 -->
  <div
    role="button"
    :aria-label="t('nav.searchPlaceholder')"
    class="app-no-drag w-60 h-10 px-4 cursor-pointer flex items-center gap-2 rounded-full border border-solid bg-on-surface/3 border-on-surface/15 hover:bg-on-surface/10 hover:border-on-surface/25 transition-colors duration-250 select-none"
    @click="dialogOpen = true"
    @mousedown.prevent
  >
    <IconLucideSearch class="size-4 text-on-surface-variant/50 shrink-0" />
    <span class="flex-1 min-w-0 truncate text-base text-on-surface-variant/40">
      {{ t("nav.searchPlaceholder") }}
    </span>
  </div>
  <!-- 搜索弹窗 -->
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
        <SInput
          v-model="searchQuery"
          :placeholder="t('nav.searchPlaceholder')"
          size="large"
          clearable
          @keydown.enter="onSubmit"
        >
          <template #prefix>
            <IconLucideSearch class="size-4 text-on-surface-variant/50 shrink-0" />
          </template>
        </SInput>
      </div>
      <div class="overflow-hidden transition-[height] duration-300 ease-out" :style="bodyStyle">
        <div ref="bodyRef" class="max-h-[65vh] overflow-y-auto px-4 pb-4 flex flex-col gap-4">
          <template v-if="trimmedQuery">
            <!-- 快捷跳转 -->
            <div class="flex flex-col gap-1.5">
              <div class="px-2 flex items-center gap-1.5 text-sm font-medium text-primary">
                <IconLucideZap class="size-4" />
                <span>{{ t("nav.searchSection.quick") }}</span>
              </div>
              <div
                class="min-w-0 flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-on-surface/5 transition-colors duration-200"
                @click="onSubmit"
              >
                <span class="flex-1 truncate text-sm text-on-surface">
                  {{ t("nav.searchGoto", { keyword: trimmedQuery }) }}
                </span>
                <IconLucideArrowRight class="size-4 shrink-0 text-on-surface-variant" />
              </div>
            </div>
            <div v-if="suggest.songs.length > 0" class="flex flex-col gap-1.5">
              <div class="px-2 flex items-center gap-1.5 text-sm font-medium text-primary">
                <IconLucideMusic class="size-4" />
                <span>{{ t("search.tabs.songs") }}</span>
              </div>
              <div
                v-for="song in suggest.songs"
                :key="song.id"
                class="min-w-0 flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-on-surface/5 transition-colors duration-200"
                @click="onPickSong(song.id)"
              >
                <div class="flex-1 min-w-0 flex flex-col leading-tight">
                  <span class="truncate text-sm text-on-surface">{{ song.name }}</span>
                  <span v-if="song.artist" class="truncate text-xs text-on-surface-variant">
                    {{ song.artist }}
                    <template v-if="song.album">· {{ song.album }}</template>
                  </span>
                </div>
              </div>
            </div>
            <div v-if="suggest.artists.length > 0" class="flex flex-col gap-1.5">
              <div class="px-2 flex items-center gap-1.5 text-sm font-medium text-primary">
                <IconLucideUser class="size-4" />
                <span>{{ t("search.tabs.artists") }}</span>
              </div>
              <div
                v-for="artist in suggest.artists"
                :key="artist.id"
                class="min-w-0 flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-on-surface/5 transition-colors duration-200"
                @click="onPickKeyword(artist.name)"
              >
                <span class="flex-1 truncate text-sm text-on-surface">{{ artist.name }}</span>
              </div>
            </div>
            <div v-if="suggest.albums.length > 0" class="flex flex-col gap-1.5">
              <div class="px-2 flex items-center gap-1.5 text-sm font-medium text-primary">
                <IconLucideDisc class="size-4" />
                <span>{{ t("search.tabs.albums") }}</span>
              </div>
              <div
                v-for="album in suggest.albums"
                :key="album.id"
                class="min-w-0 flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-on-surface/5 transition-colors duration-200"
                @click="onPickKeyword(album.name)"
              >
                <div class="flex-1 min-w-0 flex flex-col leading-tight">
                  <span class="truncate text-sm text-on-surface">{{ album.name }}</span>
                  <span v-if="album.subtitle" class="truncate text-xs text-on-surface-variant">
                    {{ album.subtitle }}
                  </span>
                </div>
              </div>
            </div>
            <div v-if="suggest.playlists.length > 0" class="flex flex-col gap-1.5">
              <div class="px-2 flex items-center gap-1.5 text-sm font-medium text-primary">
                <IconLucideListMusic class="size-4" />
                <span>{{ t("search.tabs.playlists") }}</span>
              </div>
              <div
                v-for="playlist in suggest.playlists"
                :key="playlist.id"
                class="min-w-0 flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-on-surface/5 transition-colors duration-200"
                @click="onPickKeyword(playlist.name)"
              >
                <span class="flex-1 truncate text-sm text-on-surface">{{ playlist.name }}</span>
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
