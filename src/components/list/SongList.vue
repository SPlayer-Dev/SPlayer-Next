<script setup lang="ts">
import type { Track, TrackSource } from "@shared/types/player";
import type { CollectionType } from "@/types/collection";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useTrackMenu } from "@/composables/useTrackMenu";
import { useMultiSelect } from "@/composables/useMultiSelect";
import { formatTime } from "@/utils/time";
import { formatFileSize } from "@/utils/format";
import { isLosslessQuality, getQualityLevel } from "@/utils/quality";
import { navigateToAlbum, navigateToArtist } from "@/utils/navigate";
import type { SVirtualListExposed } from "@/components/ui/SVirtualList.vue";
import * as player from "@/core/player";
import IconArrowUpDown from "~icons/lucide/arrow-up-down";
import IconArrowUpAz from "~icons/lucide/arrow-up-az";
import IconLucideListEnd from "~icons/lucide/list-end";
import IconLucideListMinus from "~icons/lucide/list-minus";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import IconLucideArrowLeftRight from "~icons/lucide/arrow-left-right";
import IconLucideX from "~icons/lucide/x";

const props = withDefaults(
  defineProps<{
    /** 歌曲列表数据 */
    items: Track[];
    /** 搜索关键词 */
    searchQuery?: string;
    /** 显示序号 */
    showIndex?: boolean;
    /** 显示专辑 */
    showAlbum?: boolean;
    /** 显示时长 */
    showDuration?: boolean;
    /** 显示文件大小 */
    showSize?: boolean;
    /** 是否启用排序交互（默认关闭） */
    enableSort?: boolean;
    /** 列表来源 */
    source?: TrackSource;
    /** 集合类型 */
    collectionType?: CollectionType;
    /** 集合 ID（用于从歌单移除） */
    collectionId?: string;
  }>(),
  {
    searchQuery: "",
    showIndex: true,
    showAlbum: true,
    showDuration: true,
    showSize: false,
    enableSort: false,
    source: "local",
    collectionType: undefined,
    collectionId: undefined,
  },
);

const { t } = useI18n();
const media = useMediaStore();
const status = useStatusStore();

/** 排序器 默认使用 base 敏感度，忽略大小写 */
const textCollator = new Intl.Collator(undefined, {
  usage: "sort",
  sensitivity: "base",
  numeric: true,
});

/** 当前播放歌曲 ID */
const playingId = computed(() => media.track?.id);

type SortField = "none" | "title" | "artist" | "album" | "duration" | "size" | "mtime" | "ctime";
type SortOrder = "asc" | "desc";

/** 排序字段 */
const sortField = ref<SortField>("none");
/** 排序方向 */
const sortOrder = ref<SortOrder>("asc");

/** 字段文案 key 映射 */
const sortFieldLabelKeyMap: Record<SortField, string> = {
  none: "songList.sort.default",
  title: "songList.sort.byTitle",
  artist: "songList.sort.byArtist",
  album: "songList.sort.byAlbum",
  duration: "songList.sort.byDuration",
  size: "songList.sort.bySize",
  mtime: "songList.sort.byMtime",
  ctime: "songList.sort.byCtime",
};

/** 表头显示的当前排序文案 */
const sortTitleText = computed(() => {
  if (!props.enableSort) return t("songList.title");
  if (sortField.value === "none") return t("songList.title");
  const arrow = sortOrder.value === "asc" ? "↑" : "↓";
  return `${t("songList.title")}（ ${t(sortFieldLabelKeyMap[sortField.value])} ${arrow} ）`;
});

/** 根据搜索关键词过滤后的列表 */
const filteredItems = computed(() => {
  const query = props.searchQuery.trim().toLowerCase();
  if (!query) return props.items;
  return props.items.filter((track) => {
    const title = track.title.toLowerCase();
    const artists = track.artists.map((a) => a.name.toLowerCase()).join(" ");
    const album = track.album?.name?.toLowerCase() ?? "";
    return title.includes(query) || artists.includes(query) || album.includes(query);
  });
});

/** 排序后列表 */
const sortedItems = computed(() => {
  if (!props.enableSort || sortField.value === "none") return filteredItems.value;
  const result = [...filteredItems.value];
  const field = sortField.value;
  const direction = sortOrder.value === "asc" ? 1 : -1;

  const toArtistText = (track: Track): string => track.artists.map((a) => a.name).join(" / ");
  const toAlbumText = (track: Track): string => track.album?.name ?? "";

  const compare = (a: Track, b: Track): number => {
    let value = 0;
    if (field === "title") value = textCollator.compare(a.title, b.title);
    else if (field === "artist") value = textCollator.compare(toArtistText(a), toArtistText(b));
    else if (field === "album") value = textCollator.compare(toAlbumText(a), toAlbumText(b));
    else if (field === "duration") value = a.duration - b.duration;
    else if (field === "size") value = (a.fileSize ?? 0) - (b.fileSize ?? 0);
    else if (field === "mtime") value = (a.mtime ?? 0) - (b.mtime ?? 0);
    else value = (a.ctime ?? 0) - (b.ctime ?? 0);
    if (value !== 0) return value * direction;
    const fallback = textCollator.compare(a.title, b.title);
    if (fallback !== 0) return fallback;
    return textCollator.compare(a.id, b.id);
  };

  result.sort(compare);
  return result;
});

/** 当前播放歌曲在过滤后列表中的索引 */
const playingIndex = computed(() => {
  if (!playingId.value) return -1;
  return sortedItems.value.findIndex((track) => track.id === playingId.value);
});

/** 虚拟列表引用 */
const virtualListRef = shallowRef<SVirtualListExposed | null>(null);

/** 定位到当前播放歌曲 */
const scrollToPlaying = (): void => {
  if (playingIndex.value >= 0) virtualListRef.value?.scrollToIndex(playingIndex.value);
};

/** 批量操作 */
const batch = useMultiSelect(sortedItems, {
  source: computed(() => props.source),
  collectionType: computed(() => props.collectionType),
  collectionId: computed(() => props.collectionId),
});
const { deleteConfirmOpen, deleteDialogTitle, deleteDialogContent } = batch;

/** 右键菜单 */
const contextTrack = shallowRef<Track | undefined>();
const { items: contextMenuItems, handleSelect: onContextMenu } = useTrackMenu(contextTrack, {
  source: props.source,
  collectionType: props.collectionType,
  onRemove: (track) => batch.requestDelete([track], "remove"),
  onDeleteFile: (track) => batch.requestDelete([track], "file"),
});

const emit = defineEmits<{
  scroll: [event: Event];
}>();

onActivated(batch.exit);

defineExpose({
  /** 进入批量管理模式 */
  enterBatch: batch.enter,
});
</script>

<template>
  <div class="relative h-full @container/batch">
    <SContextMenu :items="contextMenuItems" @select="onContextMenu">
      <template #header>
        <div v-if="contextTrack">
          <div class="flex items-center gap-1.5 px-1 py-1">
            <SImg :src="contextTrack.cover" class="size-9 rounded-md shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="text-xs font-medium truncate">
                {{ contextTrack.title }}
              </div>
              <div class="text-[11px] text-on-surface-variant/60 truncate">
                {{ contextTrack.artists.map((a) => a.name).join(" / ") }}
              </div>
            </div>
          </div>
        </div>
      </template>
      <SVirtualList
        ref="virtualListRef"
        :items="sortedItems"
        :item-height="88"
        :padding-bottom="80"
        :get-item-key="(item: Track) => item.id"
        item-fixed
        height="100%"
        @scroll="(event: Event) => emit('scroll', event)"
      >
        <!-- 搜索无结果 -->
        <template v-if="searchQuery && sortedItems.length === 0" #empty>
          <div class="flex flex-col items-center gap-2 text-on-surface-variant/40">
            <IconLucideSearchX class="size-8" />
            <span class="text-sm">{{ t("songList.noResults") }}</span>
          </div>
        </template>
        <!-- 固定表头 -->
        <template #header>
          <div
            class="flex items-center gap-3 pl-3 pr-6 mx-3 h-10 text-sm text-on-surface-variant/60"
          >
            <div v-if="showIndex" class="w-8 shrink-0 flex items-center justify-center">
              <SCheckbox
                v-if="batch.active.value"
                :checked="batch.isAllSelected.value"
                :indeterminate="batch.isPartial.value"
                size="small"
                @update:checked="batch.toggleSelectAll"
                @click.stop
              />
              <span v-else>#</span>
            </div>
            <div class="flex-1 min-w-0">
              <SPopover
                v-if="enableSort"
                :side-offset="6"
                trigger="click"
                side="bottom"
                align="start"
                block
              >
                <template #trigger>
                  <div
                    class="w-full h-full px-1.5 py-1 rounded-md cursor-pointer transition-colors hover:bg-on-surface/8"
                  >
                    {{ sortTitleText }}
                  </div>
                </template>
                <div class="w-60 flex flex-col gap-3 text-sm">
                  <div class="flex items-center gap-2 text-xs">
                    <IconArrowUpDown class="size-3.5" />
                    <span>{{ t("songList.sort.mode") }}</span>
                  </div>
                  <SRadioGroup v-model:value="sortField" size="small">
                    <SRadio value="none" :label="t('songList.sort.default')" />
                    <SRadio value="title" :label="t('songList.sort.byTitle')" />
                    <SRadio value="artist" :label="t('songList.sort.byArtist')" />
                    <SRadio value="album" :label="t('songList.sort.byAlbum')" />
                    <SRadio value="duration" :label="t('songList.sort.byDuration')" />
                    <SRadio value="size" :label="t('songList.sort.bySize')" />
                    <SRadio value="mtime" :label="t('songList.sort.byMtime')" />
                    <SRadio value="ctime" :label="t('songList.sort.byCtime')" />
                  </SRadioGroup>

                  <div class="h-px bg-outline-variant/25" />

                  <div class="flex items-center gap-2 text-xs">
                    <IconArrowUpAz class="size-3.5" />
                    <span>{{ t("songList.sort.order") }}</span>
                  </div>
                  <SRadioGroup
                    v-model:value="sortOrder"
                    size="small"
                    :disabled="sortField === 'none'"
                  >
                    <SRadio value="asc" :label="t('songList.sort.asc')" />
                    <SRadio value="desc" :label="t('songList.sort.desc')" />
                  </SRadioGroup>
                </div>
              </SPopover>
              <div v-else class="w-full h-full px-1.5 py-1">
                {{ t("songList.title") }}
              </div>
            </div>
            <div v-if="showAlbum" class="flex-1 min-w-0">{{ t("songList.album") }}</div>
            <div v-if="showDuration" class="w-16 shrink-0 text-center">
              {{ t("songList.duration") }}
            </div>
            <div v-if="showSize" class="w-16 shrink-0 text-center">{{ t("songList.size") }}</div>
          </div>
        </template>
        <!-- 列表项 -->
        <template #default="{ item, index }: { item: Track; index: number }">
          <div class="px-3 pb-3">
            <div
              class="group flex items-center gap-3 pl-3 pr-6 h-19 rounded-xl cursor-pointer border-2 border-solid transition-[background-color,border-color] duration-200"
              :class="
                batch.active.value
                  ? batch.selectedIds.value.has(item.id)
                    ? 'bg-primary/10 border-primary/30'
                    : 'bg-surface-panel border-primary/12 hover:border-primary/20 hover:bg-on-surface/5'
                  : playingId === item.id
                    ? 'bg-primary/16 border-primary/40'
                    : 'bg-surface-panel border-primary/12 hover:border-primary/30 hover:bg-on-surface/8 active:bg-on-surface/12'
              "
              @click="batch.active.value ? batch.toggle(item.id) : undefined"
              @dblclick="batch.active.value ? undefined : player.playFrom(sortedItems, index)"
              @contextmenu="contextTrack = item"
            >
              <!-- 序号 / 多选 -->
              <div
                v-if="showIndex"
                class="w-8 shrink-0 flex items-center justify-center relative"
                :class="
                  batch.active.value
                    ? ''
                    : playingId === item.id
                      ? 'text-primary'
                      : 'text-on-surface-variant'
                "
                @click.stop="
                  batch.active.value
                    ? batch.toggle(item.id)
                    : playingId === item.id
                      ? player.togglePlay()
                      : player.playNow(item)
                "
              >
                <!-- 多选模式 -->
                <SCheckbox
                  v-if="batch.active.value"
                  :checked="batch.selectedIds.value.has(item.id)"
                  size="small"
                  @update:checked="batch.toggle(item.id)"
                  @click.stop
                />
                <!-- 普通模式 -->
                <template v-else>
                  <span
                    v-if="playingId !== item.id"
                    class="text-sm font-bold tabular-nums group-hover:opacity-0 transition-opacity duration-300"
                  >
                    {{ index + 1 }}
                  </span>
                  <IconLucideMusic
                    v-else
                    class="size-5 group-hover:opacity-0 transition-opacity duration-300"
                  />
                  <div
                    class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-[opacity,transform] duration-300 group-hover:scale-100 scale-80 cursor-pointer"
                  >
                    <IconLucidePause
                      v-if="playingId === item.id && status.isPlaying"
                      class="size-5"
                    />
                    <IconLucidePlay v-else class="size-5" />
                  </div>
                </template>
              </div>
              <!-- 信息 -->
              <div class="flex-1 min-w-0 flex items-center gap-3">
                <SImg :src="item.cover" class="size-12 rounded-lg shrink-0" />
                <div class="flex-1 min-w-0">
                  <div class="flex items-baseline gap-1.5 min-w-0">
                    <span
                      class="text-base font-medium truncate"
                      :class="playingId === item.id ? 'text-primary' : ''"
                    >
                      {{ item.title }}
                    </span>
                    <span
                      v-if="item.comment"
                      class="text-xs shrink-0 max-w-40 truncate"
                      :class="
                        playingId === item.id ? 'text-primary/60' : 'text-on-surface-variant/60'
                      "
                    >
                      {{ item.comment }}
                    </span>
                  </div>
                  <div
                    class="text-sm mt-1 truncate flex items-center gap-1"
                    :class="playingId === item.id ? 'text-primary/70' : 'text-on-surface-variant'"
                  >
                    <span
                      v-if="isLosslessQuality(item.quality)"
                      class="shrink-0 px-1 rounded text-[10px] leading-[18px] font-bold border border-solid text-[#D4A44A] border-[#D4A44A]/40"
                    >
                      {{ getQualityLevel(item.quality) === "hi-res" ? "HR" : "SQ" }}
                    </span>
                    <span class="truncate">
                      <span
                        v-for="(artist, i) in item.artists"
                        :key="artist.id ?? i"
                        class="cursor-pointer transition-opacity hover:opacity-70"
                        @click.stop="navigateToArtist(artist.name)"
                      >
                        {{ artist.name }}
                        <span v-if="i < item.artists.length - 1" class="mx-0.5 opacity-50">/</span>
                      </span>
                      <span v-if="!item.artists?.length" class="opacity-50">
                        {{ t("playlist.unknownArtist") }}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
              <!-- 专辑 -->
              <div
                v-if="showAlbum"
                class="flex-1 min-w-0 truncate text-sm cursor-pointer transition-opacity hover:opacity-70"
                :class="playingId === item.id ? 'text-primary/70' : 'text-on-surface'"
                @click.stop="navigateToAlbum(item.album?.name)"
              >
                {{ item.album?.name }}
              </div>
              <!-- 时长 -->
              <div
                v-if="showDuration"
                class="w-16 shrink-0 text-center text-sm tabular-nums"
                :class="playingId === item.id ? 'text-primary/60' : 'text-on-surface-variant'"
              >
                {{ formatTime(item.duration) }}
              </div>
              <!-- 文件大小 -->
              <div
                v-if="showSize"
                class="w-16 shrink-0 text-center text-sm tabular-nums"
                :class="playingId === item.id ? 'text-primary/60' : 'text-on-surface-variant'"
              >
                {{ item.fileSize ? formatFileSize(item.fileSize) : "" }}
              </div>
            </div>
          </div>
        </template>
      </SVirtualList>
    </SContextMenu>
    <!-- 定位歌曲 -->
    <Transition name="fade">
      <div
        v-if="playingIndex >= 0 && !batch.active.value"
        class="absolute right-6 bottom-5 z-20 rounded-full bg-surface-panel shadow-lg border border-solid border-primary/10"
      >
        <SButton type="primary" variant="bordered" circle :size="40" @click="scrollToPlaying">
          <template #icon>
            <IconLucideLocate class="size-4.5" />
          </template>
        </SButton>
      </div>
    </Transition>
    <!-- 批量操作栏 -->
    <Transition name="fade">
      <div
        v-if="batch.active.value"
        class="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-5 h-12 w-fit whitespace-nowrap rounded-xl bg-surface-bright/90 backdrop-blur-md border border-solid border-outline-variant/30 shadow-xl"
      >
        <span class="text-sm text-on-surface-variant tabular-nums shrink-0">
          {{ t("songList.batch.selected", { count: batch.selectedCount.value }) }}
        </span>
        <SDivider vertical />
        <SButton
          variant="ghost"
          size="small"
          :disabled="batch.selectedCount.value === 0"
          @click="batch.invertSelection"
        >
          <template #icon>
            <IconLucideArrowLeftRight class="size-3.5" />
          </template>
          <span class="hidden @[640px]/batch:inline">{{ t("songList.batch.invert") }}</span>
        </SButton>
        <SDivider vertical />
        <SButton
          variant="ghost"
          size="small"
          :disabled="batch.selectedCount.value === 0"
          @click="batch.addToQueue"
        >
          <template #icon>
            <IconLucideListEnd class="size-3.5" />
          </template>
          <span class="hidden @[640px]/batch:inline">{{ t("songList.batch.addToQueue") }}</span>
        </SButton>
        <SButton
          v-if="batch.canRemove.value"
          variant="ghost"
          size="small"
          :disabled="batch.selectedCount.value === 0"
          @click="batch.batchRemove"
        >
          <template #icon>
            <IconLucideListMinus class="size-3.5" />
          </template>
          <span class="hidden @[640px]/batch:inline">{{
            t("collection.removeFrom", { type: batch.collectionTypeLabel.value })
          }}</span>
        </SButton>
        <SButton
          v-if="source === 'local'"
          type="error"
          variant="ghost"
          size="small"
          :disabled="batch.selectedCount.value === 0"
          @click="batch.batchDelete"
        >
          <template #icon>
            <IconLucideTrash2 class="size-3.5" />
          </template>
          <span class="hidden @[640px]/batch:inline">{{ t("songList.context.deleteFile") }}</span>
        </SButton>
        <SDivider vertical />
        <SButton variant="ghost" size="small" circle @click="batch.exit">
          <template #icon>
            <IconLucideX class="size-3.5" />
          </template>
        </SButton>
      </div>
    </Transition>
    <!-- 删除确认弹窗 -->
    <SDialog v-model:open="deleteConfirmOpen" :title="deleteDialogTitle">
      <p class="text-sm text-on-surface-variant">{{ deleteDialogContent }}</p>
      <template #footer>
        <SButton variant="secondary" @click="batch.cancelDelete">{{ t("common.cancel") }}</SButton>
        <SButton type="error" @click="batch.confirmDelete">{{ t("common.confirm") }}</SButton>
      </template>
    </SDialog>
  </div>
</template>
