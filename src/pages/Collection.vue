<script setup lang="ts">
import type { NeteasePlaybackSource, Track, TrackSource } from "@shared/types/player";
import type { Collection, CollectionType } from "@/types/collection";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { loadCollection as loadCollectionService } from "@/services/collection";
import { fetchPodcastPrograms, searchPodcastPrograms } from "@/apis/podcast/netease";
import { useCollectionSubscribe } from "@/composables/collection/useCollectionSubscribe";
import { usePlaylistManage } from "@/composables/collection/usePlaylistManage";
import { toast } from "@/composables/useToast";
import SongList from "@/components/list/SongList.vue";
import { formatTime } from "@/utils/time";
import * as player from "@/core/player";
import IconLucidePencil from "~icons/lucide/pencil";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import IconLucideListChecks from "~icons/lucide/list-checks";
import IconLucideListMusic from "~icons/lucide/list-music";
import IconLucideHourglass from "~icons/lucide/hourglass";
import IconLucideCalendar from "~icons/lucide/calendar";
import IconLucideUser from "~icons/lucide/user";
import IconMaterialSymbolsFavoriteRounded from "~icons/material-symbols/favorite-rounded";
import IconMaterialSymbolsFavoriteOutlineRounded from "~icons/material-symbols/favorite-outline-rounded";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const source = route.params.source as TrackSource;
const type = route.params.type as CollectionType;
const id = route.params.id as string;

const collection = shallowRef<Collection | null>(null);
/** 正在加载 */
const loading = ref(false);
const loadError = ref("");
const podcastHasMore = ref(false);
const podcastLoadingMore = ref(false);
const podcastSearchResults = shallowRef<Track[]>([]);
const podcastSearchLoading = ref(false);
const searchQuery = ref("");
let podcastSearchToken = 0;
/** 取消当次加载 */
let loadAbort: AbortController | null = null;

/** 折叠状态 */
const collapsed = ref(false);
const descriptionExpanded = ref(false);
const descriptionExpandable = ref(false);
const descriptionTextRef = shallowRef<HTMLElement | null>(null);
const descriptionButtonRef = shallowRef<HTMLButtonElement | null>(null);
const descriptionAnimating = ref(false);
let descriptionAnimations: Animation[] = [];
let descriptionAnimationId = 0;

/** 检查简介在单行状态下是否溢出 */
const measureDescription = (): void => {
  const element = descriptionTextRef.value;
  if (!element || descriptionExpanded.value) return;
  descriptionExpandable.value = element.scrollWidth > element.clientWidth + 1;
};

useResizeObserver(descriptionTextRef, measureDescription);

/** 取消简介动画并释放动画对象 */
const cancelDescriptionAnimations = (): void => {
  descriptionAnimationId += 1;
  descriptionAnimations.forEach((animation) => animation.cancel());
  descriptionAnimations = [];
  if (descriptionTextRef.value) descriptionTextRef.value.style.height = "";
  descriptionAnimating.value = false;
};

const toggleDescription = async (): Promise<void> => {
  const element = descriptionTextRef.value;
  if (!element || descriptionAnimating.value) return;
  const button = descriptionButtonRef.value;
  const animationId = ++descriptionAnimationId;
  descriptionAnimating.value = true;

  const outgoing = [
    element.animate(
      [
        { opacity: 1, transform: "translateY(0)" },
        { opacity: 0, transform: "translateY(2px)" },
      ],
      { duration: 100, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
    ),
  ];
  if (button) {
    outgoing.push(
      button.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 100,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: "forwards",
      }),
    );
  }
  descriptionAnimations = outgoing;
  await Promise.allSettled(outgoing.map((animation) => animation.finished));
  if (animationId !== descriptionAnimationId) return;
  outgoing.forEach((animation) => animation.cancel());

  const startHeight = element.getBoundingClientRect().height;
  element.style.height = `${startHeight}px`;
  descriptionExpanded.value = !descriptionExpanded.value;
  await nextTick();
  if (animationId !== descriptionAnimationId) return;

  element.style.height = "";
  const endHeight = element.getBoundingClientRect().height;
  element.style.height = `${endHeight}px`;
  const incoming = [
    element.animate([{ height: `${startHeight}px` }, { height: `${endHeight}px` }], {
      duration: 300,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
    }),
    element.animate(
      [
        { opacity: 0, transform: "translateY(2px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      {
        duration: 200,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: "both",
      },
    ),
  ];
  if (button) {
    incoming.push(
      button.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 200,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: "both",
      }),
    );
  }
  descriptionAnimations = incoming;
  await Promise.allSettled(incoming.map((animation) => animation.finished));
  if (animationId !== descriptionAnimationId) return;

  descriptionAnimations.forEach((animation) => animation.cancel());
  descriptionAnimations = [];
  element.style.height = "";
  descriptionAnimating.value = false;
  if (!descriptionExpanded.value) measureDescription();
};

/** 滚动超过阈值折叠 */
const handleListScroll = (event: Event) => {
  const scrollTop = (event.target as HTMLElement).scrollTop;
  if (!collapsed.value && scrollTop > 10) {
    collapsed.value = true;
  } else if (collapsed.value && scrollTop === 0) {
    collapsed.value = false;
  }
};

/** 加载数据 */
const loadCollection = async (): Promise<void> => {
  collapsed.value = false;
  cancelDescriptionAnimations();
  descriptionExpanded.value = false;
  descriptionExpandable.value = false;
  loadError.value = "";
  podcastHasMore.value = false;
  podcastLoadingMore.value = false;
  podcastSearchToken += 1;
  podcastSearchResults.value = [];
  podcastSearchLoading.value = false;
  loadAbort?.abort();
  const myAbort = new AbortController();
  loadAbort = myAbort;
  loading.value = true;

  try {
    await loadCollectionService(source, type, id, {
      fallbackName: typeof route.query.name === "string" ? route.query.name : undefined,
      signal: myAbort.signal,
      onUpdate: (next) => {
        if (myAbort.signal.aborted) return;
        collection.value = next;
        if (type === "radio") {
          podcastHasMore.value = Boolean(
            next && next.tracks.length < (next.trackCount ?? next.tracks.length),
          );
        }
        void nextTick(measureDescription);
      },
    });
  } catch {
    if (!myAbort.signal.aborted) loadError.value = t("collection.loadFailed");
  } finally {
    if (!myAbort.signal.aborted) loading.value = false;
  }
};

/** 触底加载下一页播客节目 */
const loadMorePodcastPrograms = async (): Promise<void> => {
  const current = collection.value;
  if (
    type !== "radio" ||
    !current ||
    searchQuery.value.trim() ||
    !podcastHasMore.value ||
    podcastLoadingMore.value
  ) {
    return;
  }
  podcastLoadingMore.value = true;
  try {
    const page = await fetchPodcastPrograms(decodeURIComponent(current.id), current.tracks.length);
    if (loadAbort?.signal.aborted || collection.value !== current) return;
    if (page.items.length === 0) {
      podcastHasMore.value = false;
      return;
    }
    const tracks = [...current.tracks, ...page.items];
    collection.value = {
      ...current,
      tracks,
      trackCount: page.total || current.trackCount,
    };
    podcastHasMore.value = page.hasMore;
  } catch {
    if (!loadAbort?.signal.aborted) toast.error(t("collection.loadFailed"));
  } finally {
    podcastLoadingMore.value = false;
  }
};

/** 使用网易云桌面端接口搜索指定播客内的声音 */
const runPodcastSearch = useDebounceFn(async (token: number, keyword: string): Promise<void> => {
  const current = collection.value;
  if (type !== "radio" || !current) return;

  try {
    const remote = await searchPodcastPrograms(decodeURIComponent(current.id), keyword);
    if (token !== podcastSearchToken || collection.value !== current) return;
    const seen = new Set(current.tracks.map((track) => track.extId ?? track.id));
    podcastSearchResults.value = [
      ...current.tracks,
      ...remote.filter((track) => {
        const key = track.extId ?? track.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    ];
  } catch {
    if (token === podcastSearchToken) podcastSearchResults.value = current.tracks;
  } finally {
    if (token === podcastSearchToken) podcastSearchLoading.value = false;
  }
}, 300);

watch(searchQuery, (value) => {
  const token = ++podcastSearchToken;
  const keyword = value.trim();
  if (type !== "radio" || !keyword) {
    podcastSearchLoading.value = false;
    podcastSearchResults.value = [];
    return;
  }
  podcastSearchResults.value = collection.value?.tracks ?? [];
  podcastSearchLoading.value = true;
  void runPodcastSearch(token, keyword);
});

/** 搜索时切换到当前播客的服务端搜索结果 */
const displayedTracks = computed(() => {
  const current = collection.value;
  if (!current) return [];
  if (type === "radio" && searchQuery.value.trim()) return podcastSearchResults.value;
  return current.tracks;
});

/**
 * 乐观过滤本地 tracks
 * @param removedIds 已成功删除的曲目 id 列表
 */
const handleTracksRemoved = (removedIds: string[]): void => {
  if (!collection.value || removedIds.length === 0) return;
  const removed = new Set(removedIds);
  const tracks = collection.value.tracks.filter((track) => !removed.has(track.id));
  collection.value = {
    ...collection.value,
    tracks,
    trackCount: tracks.length,
  };
};

const typeLabel = computed(() => {
  const map: Record<CollectionType, string> = {
    album: t("collection.album"),
    playlist: t("collection.playlist"),
    radio: t("collection.radio"),
    cloud: t("cloud.title"),
  };
  return map[type] ?? "";
});

/** 总时长 */
const totalDuration = computed(() => {
  if (!collection.value) return "";
  const total = collection.value.tracks.reduce((sum, t) => sum + t.duration, 0);
  return total > 0 ? formatTime(total) : "";
});

/** 歌手文本 */
const artistText = computed(() => {
  if (!collection.value?.artists?.length) return "";
  return collection.value.artists.map((a) => a.name).join(" / ");
});

/** 创建者（歌单作者） */
const creatorText = computed(() => {
  if (collection.value?.artists?.length) return "";
  return collection.value?.creator ?? "";
});

/** 更新时间文本 */
const updateTimeText = computed(() => {
  if (!collection.value?.updateTime) return "";
  return new Date(collection.value.updateTime).toLocaleDateString();
});

const playbackSource = computed<NeteasePlaybackSource | undefined>(() => {
  const current = collection.value;
  if (!current || current.source !== "netease") return undefined;
  const sourceType =
    current.type === "playlist" ? "list" : current.type === "radio" ? "radio" : current.type;
  if (sourceType !== "list" && sourceType !== "album" && sourceType !== "radio") return undefined;
  return { id: current.id, type: sourceType };
});

/** 集合内容数量 */
const contentCountText = computed(() => {
  const current = collection.value;
  if (!current) return "";
  const count = current.trackCount ?? current.tracks.length;
  return t(type === "radio" ? "common.totalVoices" : "common.totalSongs", { count });
});

const handlePlayAll = () => {
  if (!collection.value?.tracks.length) return;
  player.playFrom(collection.value.tracks, 0, playbackSource.value);
};

/** 歌曲列表引用 */
const songListRef = shallowRef<InstanceType<typeof SongList> | null>(null);

/** 收藏 / 取消收藏 */
const subscribe = useCollectionSubscribe(collection);

/** 歌单管理：编辑 + 删除 */
const manage = usePlaylistManage(collection, {
  onEdited: () => loadCollection(),
  onDeleted: () => {
    if (window.history.length > 1) router.back();
    else router.replace("/");
  },
});

/** 更多菜单 */
const editLabel = computed(() => t("collection.edit", { type: typeLabel.value }));

const moreMenuItems = computed<DropdownMenuItem[]>(() => {
  const list: DropdownMenuItem[] =
    type === "radio"
      ? []
      : [{ key: "batchManage", label: t("songList.batch.manage"), icon: IconLucideListChecks }];
  if (manage.canManage.value) {
    list.push({ key: "edit", label: editLabel.value, icon: IconLucidePencil });
    list.push({
      key: "delete",
      label: t("collection.delete", { type: typeLabel.value }),
      icon: IconLucideTrash2,
      separator: true,
    });
  }
  return list;
});

const handleMoreMenu = (key: string) => {
  switch (key) {
    case "batchManage":
      songListRef.value?.enterBatch();
      break;
    case "edit":
      manage.openEdit();
      break;
    case "delete":
      manage.openDelete();
      break;
  }
};

onMounted(() => {
  loadCollection();
});

onBeforeUnmount(() => {
  loadAbort?.abort();
  podcastSearchToken += 1;
  cancelDescriptionAnimations();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 头部信息 -->
    <div v-if="collection" class="shrink-0 px-5 pb-2">
      <div
        class="flex mt-2 transition-[gap,margin] duration-300"
        :class="collapsed ? 'gap-3' : 'gap-5'"
      >
        <!-- 封面 -->
        <SImg
          :src="collection.cover"
          :alt="collection.title"
          class="rounded-xl shrink-0 transition-[width,height] duration-300"
          :class="collapsed ? 'size-20' : 'size-40'"
        />
        <!-- 信息 -->
        <div class="flex-1 flex flex-col min-w-0">
          <div
            class="flex flex-col transition-[gap] duration-300"
            :class="collapsed ? 'gap-0.5' : 'gap-2'"
          >
            <h1
              class="font-bold text-on-surface truncate lh-normal transition-[font-size,line-height] duration-300"
              :class="collapsed ? 'text-xl' : 'text-3xl'"
            >
              {{ collection.title }}
            </h1>
            <div
              class="grid transition-[grid-template-rows,opacity] duration-300"
              :class="collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'"
            >
              <div class="overflow-hidden flex flex-col gap-2">
                <!-- 歌手 -->
                <div v-if="artistText" class="text-sm text-on-surface-variant/70 truncate">
                  {{ artistText }}
                </div>
                <!-- 描述 -->
                <div class="relative min-w-0 mb-1 text-sm text-on-surface-variant/70">
                  <p
                    ref="descriptionTextRef"
                    class="min-w-0 overflow-hidden"
                    :class="
                      descriptionExpanded
                        ? 'whitespace-pre-line break-words pb-6'
                        : 'truncate pr-10'
                    "
                  >
                    {{ collection.description || t("collection.noDescription") }}
                  </p>
                  <button
                    v-if="collection.description && (descriptionExpandable || descriptionExpanded)"
                    ref="descriptionButtonRef"
                    type="button"
                    class="appearance-none absolute p-0 border-0 bg-transparent text-primary font-medium cursor-pointer transition-opacity duration-150 hover:opacity-70 disabled:pointer-events-none"
                    :class="descriptionExpanded ? 'right-0 bottom-0' : 'right-0 top-0'"
                    :disabled="descriptionAnimating"
                    @click="toggleDescription"
                  >
                    {{
                      t(
                        descriptionExpanded
                          ? "collection.collapseDescription"
                          : "collection.expandDescription",
                      )
                    }}
                  </button>
                </div>
                <div
                  class="flex items-center gap-3 text-sm leading-none text-on-surface-variant/50"
                >
                  <span v-if="creatorText" class="flex items-center gap-1 min-w-0">
                    <IconLucideUser class="shrink-0" />
                    <span class="truncate">{{ creatorText }}</span>
                  </span>
                  <span class="flex items-center gap-1 shrink-0">
                    <IconLucideListMusic class="shrink-0" />
                    {{ contentCountText }}
                  </span>
                  <span v-if="totalDuration" class="flex items-center gap-1 shrink-0">
                    <IconLucideHourglass class="shrink-0" />
                    {{ t("collection.totalDuration", { time: totalDuration }) }}
                  </span>
                  <span v-if="updateTimeText" class="flex items-center gap-1 shrink-0">
                    <IconLucideCalendar class="shrink-0" />
                    {{ updateTimeText }}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <!-- 操作栏 -->
          <div class="mt-auto pt-3 flex items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <SButton
                type="primary"
                variant="secondary"
                round
                :disabled="collection.tracks.length === 0"
                @click="handlePlayAll"
              >
                <template #icon>
                  <IconLucidePlay />
                </template>
                {{ t("common.playAll") }}
              </SButton>
              <SButton
                v-if="subscribe.available.value"
                variant="secondary"
                round
                :disabled="subscribe.busy.value"
                @click="subscribe.toggle"
              >
                <template #icon>
                  <IconMaterialSymbolsFavoriteRounded v-if="subscribe.isSubscribed.value" />
                  <IconMaterialSymbolsFavoriteOutlineRounded v-else />
                </template>
                {{
                  t(
                    subscribe.isSubscribed.value
                      ? "collection.unsubscribe"
                      : "collection.subscribe",
                  )
                }}
              </SButton>
              <SDropdownMenu
                v-if="moreMenuItems.length > 0"
                :items="moreMenuItems"
                align="start"
                @select="handleMoreMenu"
              >
                <template #trigger>
                  <SButton variant="secondary" circle>
                    <template #icon>
                      <IconLucideEllipsis />
                    </template>
                  </SButton>
                </template>
              </SDropdownMenu>
            </div>
            <SInput
              v-model="searchQuery"
              :placeholder="t('common.search')"
              clearable
              round
              class="w-40 focus-within:w-56"
              data-search-input
            >
              <template #prefix>
                <IconLucideSearch class="size-4 text-on-surface-variant/40 shrink-0" />
              </template>
            </SInput>
          </div>
        </div>
      </div>
    </div>
    <Transition name="fade" mode="out-in" :duration="150">
      <div
        v-if="collection && collection.tracks.length > 0"
        :key="collection.id"
        class="flex-1 min-h-0"
      >
        <SongList
          ref="songListRef"
          :items="displayedTracks"
          :search-query="searchQuery"
          :show-album="type !== 'album' && type !== 'radio'"
          :show-podcast-metadata="type === 'radio'"
          :show-favorite="type !== 'radio'"
          :show-size="source === 'local'"
          :source="source"
          :collection-type="type"
          :collection-id="id"
          :playback-source="playbackSource"
          :can-remove="manage.canManage.value"
          :has-more="type === 'radio' && !searchQuery.trim() && podcastHasMore"
          :loading-more="
            type === 'radio' && (searchQuery.trim() ? podcastSearchLoading : podcastLoadingMore)
          "
          enable-sort
          @scroll="handleListScroll"
          @reach-bottom="loadMorePodcastPrograms"
          @change="handleTracksRemoved"
        />
      </div>
      <!-- 加载中 -->
      <div v-else-if="loading" key="loading" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/60">
          <SLoading class="text-4xl text-primary/70 mb-4 mx-auto block" />
          <div class="text-sm">{{ t("common.loading") }}</div>
        </div>
      </div>
      <!-- 加载失败 -->
      <div v-else-if="loadError" key="error" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/60">
          <IconLucideTriangleAlert class="size-12 mx-auto mb-3 text-red-500/70" />
          <div class="text-sm mb-3">{{ loadError }}</div>
          <SButton variant="secondary" round @click="loadCollection">
            {{ t("common.retry") }}
          </SButton>
        </div>
      </div>
      <!-- 空状态 -->
      <div v-else-if="collection" key="empty" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideMusic class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm">
            {{ t(type === "radio" ? "collection.emptyRadio" : "collection.empty") }}
          </div>
        </div>
      </div>
    </Transition>
    <!-- 编辑弹窗 -->
    <SDialog v-model:open="manage.editOpen.value" :title="editLabel" width="400px">
      <div class="flex flex-col gap-4">
        <SFormItem :label="t('collection.name', { type: typeLabel })">
          <SInput v-model="manage.editTitle.value" :disabled="manage.submitting.value" />
        </SFormItem>
        <SFormItem :label="t('collection.description', { type: typeLabel })">
          <SInput v-model="manage.editDescription.value" :disabled="manage.submitting.value" />
        </SFormItem>
      </div>
      <template #footer="{ close }">
        <SButton variant="secondary" :disabled="manage.submitting.value" @click="close">
          {{ t("common.cancel") }}
        </SButton>
        <SButton
          type="primary"
          :disabled="!manage.editTitle.value.trim()"
          :loading="manage.submitting.value"
          @click="manage.saveEdit"
        >
          {{ t("common.confirm") }}
        </SButton>
      </template>
    </SDialog>
    <!-- 删除确认 -->
    <SDialog
      v-model:open="manage.deleteOpen.value"
      :title="t('collection.delete', { type: typeLabel })"
    >
      <p class="text-sm text-on-surface-variant">
        {{ t("collection.deleteConfirm", { type: typeLabel, title: collection?.title ?? "" }) }}
      </p>
      <template #footer="{ close }">
        <SButton variant="secondary" :disabled="manage.deleting.value" @click="close">
          {{ t("common.cancel") }}
        </SButton>
        <SButton type="error" :loading="manage.deleting.value" @click="manage.confirmDelete">
          {{ t("common.confirm") }}
        </SButton>
      </template>
    </SDialog>
  </div>
</template>
