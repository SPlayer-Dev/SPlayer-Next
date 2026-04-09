<script setup lang="ts">
import type { TrackSource } from "@shared/types/player";
import type { Collection, CollectionType } from "@/types/collection";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { usePlaylistStore } from "@/stores/playlist";
import { useLibraryStore } from "@/stores/library";
import SongList from "@/components/list/SongList.vue";
import { formatTime } from "@/utils/time";
import * as player from "@/core/player";
import IconLucidePencil from "~icons/lucide/pencil";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import IconLucideListChecks from "~icons/lucide/list-checks";
import IconLucideListMusic from "~icons/lucide/list-music";
import IconLucideHourglass from "~icons/lucide/hourglass";
import IconLucideCalendar from "~icons/lucide/calendar";

const { t } = useI18n();
const route = useRoute();
const playlistStore = usePlaylistStore();
const libraryStore = useLibraryStore();

const source = computed(() => route.params.source as TrackSource);
const type = computed(() => route.params.type as CollectionType);
const id = computed(() => route.params.id as string);

const collection = shallowRef<Collection | null>(null);

/** 是否可编辑 */
const editable = computed(() => source.value === "local" && type.value === "playlist");

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
const loadCollection = async () => {
  // 重置折叠状态
  collapsed.value = false;
  if (source.value === "local" && type.value === "playlist") {
    collection.value = await playlistStore.get(id.value);
  } else if (source.value === "local" && type.value === "album") {
    if (!libraryStore.initialized) await libraryStore.load();
    const albumName = decodeURIComponent(id.value);
    collection.value = libraryStore.getAlbumCollection(albumName);
  }
  // TODO: online / radio
};

watch(() => route.params, loadCollection, { immediate: true });

const typeLabel = computed(() => {
  const map: Record<CollectionType, string> = {
    album: t("collection.album"),
    playlist: t("collection.playlist"),
    radio: t("collection.radio"),
  };
  return map[type.value] ?? "";
});

/** 总时长 */
const totalDuration = computed(() => {
  if (!collection.value) return "";
  const total = collection.value.tracks.reduce((sum, t) => sum + t.duration, 0);
  return total > 0 ? formatTime(total) : "";
});

/** 歌手文本 */
const artistText = computed(() => {
  if (!collection.value?.artists?.length) return collection.value?.creator ?? "";
  return collection.value.artists.map((a) => a.name).join(" / ");
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

/** 更多菜单 */
const editLabel = computed(() => t("collection.edit", { type: typeLabel.value }));

const moreMenuItems = computed<DropdownMenuItem[]>(() => [
  { key: "batchManage", label: t("songList.batch.manage"), icon: IconLucideListChecks },
  { key: "edit", label: editLabel.value, icon: IconLucidePencil },
  {
    key: "delete",
    label: t("collection.delete", { type: typeLabel.value }),
    icon: IconLucideTrash2,
    separator: true,
  },
]);

/** 编辑弹窗 */
const editDialogOpen = ref(false);
const editTitle = ref("");
const editDescription = ref("");

const openEditDialog = () => {
  if (!collection.value) return;
  editTitle.value = collection.value.title;
  editDescription.value = collection.value.description ?? "";
  editDialogOpen.value = true;
};

const handleSaveEdit = async () => {
  if (!collection.value || !editTitle.value.trim()) return;
  await playlistStore.update(collection.value.id, {
    title: editTitle.value.trim(),
    description: editDescription.value.trim() || undefined,
  });
  await loadCollection();
  editDialogOpen.value = false;
};

/** 删除确认 */
const deleteConfirmOpen = ref(false);
const deleteTitle = ref("");
const router = useRouter();

const handleDelete = async () => {
  if (!collection.value) return;
  await playlistStore.remove(collection.value.id);
  deleteConfirmOpen.value = false;
  router.back();
};

const handleMoreMenu = (key: string) => {
  switch (key) {
    case "batchManage":
      songListRef.value?.enterBatch();
      break;
    case "edit":
      openEditDialog();
      break;
    case "delete":
      deleteTitle.value = collection.value?.title ?? "";
      deleteConfirmOpen.value = true;
      break;
  }
};
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
              class="font-bold text-on-surface truncate transition-[font-size,line-height] duration-300"
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
                  <span class="flex items-center gap-1">
                    <IconLucideListMusic class="shrink-0" />
                    {{ t("collection.totalSongs", { count: collection.tracks.length }) }}
                  </span>
                  <span v-if="totalDuration" class="flex items-center gap-1">
                    <IconLucideHourglass class="shrink-0" />
                    {{ t("collection.totalDuration", { time: totalDuration }) }}
                  </span>
                  <span v-if="updateTimeText" class="flex items-center gap-1">
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
                {{ t("collection.playAll") }}
              </SButton>
              <SDropdownMenu
                v-if="editable"
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
      <!-- 歌曲列表 -->
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
        />
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
    <SDialog v-model:open="editDialogOpen" :title="editLabel" width="400px">
      <div class="flex flex-col gap-4">
        <SFormItem :label="t('collection.name', { type: typeLabel })">
          <SInput v-model="editTitle" />
        </SFormItem>
        <SFormItem :label="t('collection.description', { type: typeLabel })">
          <SInput v-model="editDescription" />
        </SFormItem>
      </div>
      <template #footer="{ close }">
        <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
        <SButton type="primary" :disabled="!editTitle.trim()" @click="handleSaveEdit">
          {{ t("common.confirm") }}
        </SButton>
      </template>
    </SDialog>
    <!-- 删除确认 -->
    <SDialog v-model:open="deleteConfirmOpen" :title="t('collection.delete', { type: typeLabel })">
      <p class="text-sm text-on-surface-variant">
        {{ t("collection.deleteConfirm", { type: typeLabel, title: deleteTitle }) }}
      </p>
      <template #footer="{ close }">
        <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
        <SButton type="error" @click="handleDelete">{{ t("common.confirm") }}</SButton>
      </template>
    </SDialog>
  </div>
</template>
