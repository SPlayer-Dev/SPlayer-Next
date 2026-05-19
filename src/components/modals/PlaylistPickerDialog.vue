<script setup lang="ts">
import type { Track } from "@shared/types/player";
import type { ContentScope } from "@/types/collection";
import { usePlaylistStore } from "@/stores/playlist";
import { useUserStore } from "@/stores/user";
import { toast } from "@/composables/useToast";
import PlaylistCreateDialog from "./PlaylistCreateDialog.vue";
import IconLucidePlus from "~icons/lucide/plus";

const props = defineProps<{
  open: boolean;
  /** 本地 / 在线 */
  mode: ContentScope;
  /** 要加入的曲目 */
  tracks: Track[];
}>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const playlistStore = usePlaylistStore();
const userStore = useUserStore();

/** 列表项的统一形状 */
interface PickerEntry {
  id: string;
  name: string;
  cover?: string;
  trackCount: number;
}

/** 当前 mode 下的歌单 */
const entries = computed<PickerEntry[]>(() => {
  if (props.mode === "local") {
    return playlistStore.playlists.map((pl) => ({
      id: pl.id,
      name: pl.title,
      cover: pl.cover,
      trackCount: pl.trackCount ?? 0,
    }));
  }
  // 跳过"我喜欢"，红心按钮负责那条路径
  return userStore.createdPlaylists
    .filter(
      (pl): pl is typeof pl & { id: string } => !!pl.id && pl.id !== userStore.likedPlaylistId,
    )
    .map((pl) => ({
      id: pl.id,
      name: pl.name,
      cover: pl.cover,
      trackCount: pl.trackCount ?? 0,
    }));
});

const createDialogOpen = ref(false);
const submitting = ref(false);

/**
 * 分类型添加歌曲
 * @param playlistId 歌单 ID
 */
const handlePick = async (playlistId: string): Promise<void> => {
  if (submitting.value) return;
  submitting.value = true;
  try {
    let count = 0;
    if (props.mode === "local") {
      count = await playlistStore.addTracks(playlistId, props.tracks);
    } else {
      const ids = props.tracks.map((track) => track.id);
      count = await userStore.addTracksToPlaylist(playlistId, ids);
    }
    if (count > 0) {
      toast.success(t("collection.tracksAdded", { count }));
    } else {
      // 全部重复
      toast.warning(t("collection.alreadyInPlaylist"));
    }
    emit("update:open", false);
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : t("liked.toast.failed");
    toast.error(message);
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <SDialog
    :open="open"
    :title="t('collection.addTo', { type: t('collection.playlist') })"
    width="420px"
    @update:open="(v) => emit('update:open', v)"
  >
    <div class="max-h-96 overflow-y-auto flex flex-col">
      <!-- 新建 -->
      <div
        class="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-on-surface/5 transition-colors"
        @click="createDialogOpen = true"
      >
        <div
          class="size-12 rounded-md shrink-0 flex items-center justify-center bg-primary/10 text-primary"
        >
          <IconLucidePlus class="size-5" />
        </div>
        <span class="text-sm text-on-surface">
          {{ t("collection.create", { type: t("collection.playlist") }) }}
        </span>
      </div>
      <!-- 歌单项 -->
      <div
        v-for="entry in entries"
        :key="entry.id"
        class="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-on-surface/5 transition-colors"
        :class="submitting ? 'pointer-events-none opacity-50' : ''"
        @click="handlePick(entry.id)"
      >
        <SImg :src="entry.cover" :alt="entry.name" class="size-12 rounded-md shrink-0" />
        <div class="flex-1 min-w-0 flex flex-col gap-0.5">
          <span class="text-sm text-on-surface truncate">{{ entry.name }}</span>
          <span class="text-xs text-on-surface-variant/60 tabular-nums">
            {{ t("common.totalSongs", { count: entry.trackCount }) }}
          </span>
        </div>
      </div>
    </div>
    <template #footer="{ close }">
      <SButton variant="tertiary" @click="close">{{ t("common.cancel") }}</SButton>
    </template>
  </SDialog>
  <PlaylistCreateDialog v-model:open="createDialogOpen" :mode="mode" />
</template>
