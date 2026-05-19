<script setup lang="ts">
import type { TrackSource } from "@shared/types/player";
import type { Collection, CollectionType } from "@/types/collection";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { loadCollection as loadCollectionService } from "@/services/collectionLoader";
import { useCollectionSubscribe } from "@/composables/collection/useCollectionSubscribe";
import { usePlaylistManage } from "@/composables/collection/usePlaylistManage";
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
/** 取消当次加载 */
let loadAbort: AbortController | null = null;

/** 折叠状态 */
const collapsed = ref(false);

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
      },
    });
  } finally {
    if (!myAbort.signal.aborted) loading.value = false;
  }
};

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

const handlePlayAll = () => {
  if (!collection.value?.tracks.length) return;
  player.playFrom(collection.value.tracks, 0);
};

const searchQuery = ref("");

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
  const list: DropdownMenuItem[] = [
    { key: "batchManage", label: t("songList.batch.manage"), icon: IconLucideListChecks },
  ];
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
                <p v-if="type !== 'album'" class="text-sm text-on-surface-variant/70 truncate">
                  {{ collection.description || t("collection.noDescription") }}
                </p>
                <div
                  class="flex items-center gap-3 text-sm leading-none text-on-surface-variant/50"
                >
                  <span v-if="creatorText" class="flex items-center gap-1 min-w-0">
                    <IconLucideUser class="shrink-0" />
                    <span class="truncate">{{ creatorText }}</span>
                  </span>
                  <span class="flex items-center gap-1 shrink-0">
                    <IconLucideListMusic class="shrink-0" />
                    {{ t("common.totalSongs", { count: collection.tracks.length }) }}
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
          <div class="mt-auto flex items-center justify-between gap-4">
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
      <!-- 歌曲列表（首批到位即渲染，剩余批次会自动追加） -->
      <div
        v-if="collection && collection.tracks.length > 0"
        :key="collection.id"
        class="flex-1 min-h-0"
      >
        <SongList
          ref="songListRef"
          :items="collection.tracks"
          :search-query="searchQuery"
          :show-album="type !== 'album'"
          :show-size="source === 'local'"
          :source="source"
          :collection-type="type"
          :collection-id="id"
          enable-sort
          @scroll="handleListScroll"
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
      <!-- 空状态 -->
      <div v-else-if="collection" key="empty" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideMusic class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm">{{ t("collection.empty") }}</div>
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
