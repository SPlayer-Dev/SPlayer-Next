<script setup lang="ts">
import type { Track } from "@shared/types/player";
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { queue, queueLength } from "@/stores/queue";
import type { SVirtualListExposed } from "@/components/ui/SVirtualList.vue";
import { useDragSort } from "@/composables/useDragSort";
import * as player from "@/core/player";

const props = defineProps<{
  /** 封面主题模式 */
  cover?: boolean;
}>();

const { t } = useI18n();
const statusStore = useStatusStore();
const mediaStore = useMediaStore();

/** 拼接艺术家名称 */
const formatArtists = (artists: Track["artists"]): string => {
  if (!artists?.length) return t("playlist.unknownArtist");
  return artists.map((ar) => ar.name).join(" / ");
};

/** 播放指定索引的歌曲 */
const playAtIndex = async (index: number): Promise<void> => {
  // 关闭播放列表
  statusStore.playlistOpen = false;
  if (index === statusStore.playIndex) return;
  statusStore.playIndex = index;
  const track = statusStore.currentTrack;
  if (track?.path) await player.load(track.path);
};

const clearConfirmOpen = ref(false);

/** 清空播放列表 */
const handleClear = (): void => {
  if (queueLength.value === 0) return;
  player.stop();
  statusStore.playIndex = -1;
  queue.value = [];
  mediaStore.clear();
  clearConfirmOpen.value = false;
};

const listRef = shallowRef<SVirtualListExposed | null>(null);

/** 定位到当前播放歌曲 */
const scrollToCurrent = (): void => {
  if (statusStore.playIndex >= 0) {
    listRef.value?.scrollToIndex(statusStore.playIndex);
  }
};

const {
  isDragging,
  draggedIndex,
  dropIndicator,
  dragLabelData,
  dragLabelPosition,
  handlePointerDown,
} = useDragSort({
  virtualListRef: listRef,
  itemCount: queueLength,
  onReorder: (from, to) => player.moveInQueue(from, to),
  triggerMode: "longpress",
});

/** 按钮类型 */
const btnType = computed(() => (props.cover ? "cover" : "default"));
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 播放列表 -->
    <div
      v-if="queueLength > 0"
      class="flex-1 min-h-0"
      :class="{ 'cursor-grabbing select-none': isDragging }"
    >
      <SVirtualList
        ref="listRef"
        :items="queue"
        :item-height="72"
        item-fixed
        height="100%"
        :default-scroll-index="Math.max(0, statusStore.playIndex)"
        :get-item-key="(item: Track) => item.id"
      >
        <template #default="{ item, index }: { item: Track; index: number }">
          <div class="relative px-3 py-1.5">
            <!-- 放置指示线 -->
            <div
              v-if="isDragging && dropIndicator.index === index"
              :class="[
                'absolute left-4 right-4 h-0.5 rounded-full z-10 pointer-events-none',
                cover ? 'bg-white/60' : 'bg-primary',
                dropIndicator.position === 'top' ? 'top-0' : 'bottom-0',
              ]"
            />
            <div
              class="group flex items-center gap-3 px-3 h-15 rounded-lg cursor-pointer border border-solid transition-[background-color,border-color,opacity,transform] duration-200"
              :class="[
                index === statusStore.playIndex
                  ? cover
                    ? 'bg-cover/25 text-cover border-cover/50 active:bg-cover/30'
                    : 'bg-primary/20 text-primary border-primary/50 active:bg-primary/25'
                  : cover
                    ? 'border-transparent bg-cover/6 hover:bg-cover/12 hover:border-cover/30 active:bg-cover/16'
                    : 'border-transparent bg-on-surface/5 hover:bg-on-surface/10 hover:border-primary/30 active:bg-on-surface/14',
                isDragging && draggedIndex === index ? 'opacity-30 scale-95' : 'opacity-100',
              ]"
              @click="playAtIndex(index)"
              @mousedown="handlePointerDown($event, index, item.title)"
              @touchstart.passive="handlePointerDown($event, index, item.title)"
            >
              <!-- 封面 -->
              <SImg :src="item.cover" class="size-10 rounded-md shrink-0" />
              <!-- 歌曲信息 -->
              <div class="flex-1 min-w-0">
                <div class="text-sm truncate">{{ item.title }}</div>
                <div
                  class="text-xs truncate"
                  :class="
                    index === statusStore.playIndex
                      ? cover
                        ? 'text-cover/70'
                        : 'text-primary/70'
                      : cover
                        ? 'text-cover/50'
                        : 'text-on-surface-variant'
                  "
                >
                  {{ formatArtists(item.artists) }}
                </div>
              </div>
              <!-- 移除按钮 -->
              <SButton
                :type="btnType"
                variant="ghost"
                circle
                size="tiny"
                class="opacity-0 group-hover:opacity-100"
                @click.stop="player.removeFromQueue(index)"
              >
                <template #icon>
                  <IconLucideX />
                </template>
              </SButton>
            </div>
          </div>
        </template>
      </SVirtualList>
    </div>
    <!-- 空状态 -->
    <div v-else class="flex-1 flex items-center justify-center">
      <div :class="cover ? 'text-cover/30' : 'text-on-surface-variant/50'">
        <IconLucideListMusic class="size-10 mx-auto mb-2 opacity-40" />
        <div class="text-sm">{{ t("playlist.empty") }}</div>
      </div>
    </div>
    <!-- 操作 -->
    <div class="shrink-0 p-3 flex gap-3">
      <SDialog
        v-model:open="clearConfirmOpen"
        :title="t('playlist.clearConfirmTitle')"
        :cover="cover"
      >
        {{ t("playlist.clearConfirmContent") }}
        <template #footer="{ close }">
          <SButton :type="cover ? 'cover' : 'default'" variant="secondary" @click="close">
            {{ t("common.cancel") }}
          </SButton>
          <SButton :type="cover ? 'cover' : 'error'" variant="secondary" @click="handleClear">
            {{ t("common.confirm") }}
          </SButton>
        </template>
      </SDialog>
      <SButton
        :type="btnType"
        variant="secondary"
        block
        :disabled="queueLength === 0"
        @click="clearConfirmOpen = true"
      >
        <template #icon>
          <IconLucideTrash2 />
        </template>
        {{ t("playlist.clearList") }}
      </SButton>
      <SButton
        :type="btnType"
        variant="secondary"
        block
        :disabled="queueLength === 0"
        @click="scrollToCurrent"
      >
        <template #icon>
          <IconLucideLocate />
        </template>
        {{ t("playlist.locateCurrent") }}
      </SButton>
    </div>

    <!-- 拖拽标签 -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-150"
        enter-from-class="opacity-0"
        leave-active-class="transition-opacity duration-200"
        leave-to-class="opacity-0"
      >
        <div
          v-if="isDragging && dragLabelData"
          :class="[
            'fixed z-9999 pointer-events-none max-w-60 truncate px-4 py-2 rounded-full text-sm font-medium shadow-lg',
            cover ? 'bg-white/15 backdrop-blur-lg text-cover' : 'bg-surface-bright text-on-surface',
          ]"
          :style="{
            top: `${dragLabelPosition.top + 12}px`,
            left: `${dragLabelPosition.left + 12}px`,
          }"
        >
          {{ dragLabelData.name }}
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
