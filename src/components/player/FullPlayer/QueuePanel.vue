<script setup lang="ts">
import type { Track } from "@shared/types/player";
import type { SVirtualListExposed } from "@/components/ui/SVirtualList.vue";
import { useQueuePanel } from "@/composables/useQueuePanel";

defineEmits<{ close: [] }>();

const { t } = useI18n();
const listRef = shallowRef<SVirtualListExposed | null>(null);
const {
  statusStore,
  queue,
  queueLength,
  formatArtists,
  playAt,
  removeAt,
  clearConfirmOpen,
  clearAll,
  scrollToCurrent,
} = useQueuePanel({ listRef });
</script>

<template>
  <div class="flex flex-col h-full text-cover">
    <div class="shrink-0 flex items-start justify-between gap-4 pl-1 pr-20 pb-4">
      <div class="flex flex-col min-w-0 pl-2.5">
        <h2 class="m-0 text-2xl font-semibold leading-tight truncate">
          {{ t("playlist.title") }}
        </h2>
        <span class="text-sm text-cover/55 mt-1">
          {{ t("common.totalSongs", { count: queueLength }) }}
        </span>
      </div>
      <div class="shrink-0 flex items-center gap-3">
        <SButton
          type="cover"
          variant="secondary"
          round
          :size="40"
          :disabled="queueLength === 0"
          @click="scrollToCurrent"
        >
          <template #icon><IconLucideLocate /></template>
        </SButton>
        <SButton
          type="cover"
          variant="secondary"
          round
          :size="40"
          :disabled="queueLength === 0"
          @click="clearConfirmOpen = true"
        >
          <template #icon><IconLucideTrash2 /></template>
        </SButton>
        <SButton type="cover" variant="secondary" round :size="40" @click="$emit('close')">
          <template #icon><IconLucideX /></template>
        </SButton>
      </div>
    </div>
    <!-- 列表 -->
    <div
      v-if="queueLength > 0"
      class="flex-1 min-h-0"
      :style="{
        maskImage:
          'linear-gradient(180deg, transparent 0px, #000 32px, #000 calc(100% - 32px), transparent 100%)',
      }"
    >
      <SVirtualList
        ref="listRef"
        :items="queue"
        :item-height="72"
        :padding-top="32"
        :padding-bottom="32"
        item-fixed
        cover
        height="100%"
        :default-scroll-index="Math.max(0, statusStore.playIndex)"
        :get-item-key="(item: Track) => item.id"
      >
        <template #default="{ item, index }: { item: Track; index: number }">
          <div class="relative pl-1 pr-20 py-1">
            <div
              class="group relative flex items-center gap-3 px-2.5 h-16 rounded-xl cursor-pointer transition-[background-color] duration-150"
              :class="
                index === statusStore.playIndex
                  ? 'bg-cover/14 text-cover'
                  : 'hover:bg-cover/8 active:bg-cover/12'
              "
              @click="playAt(index)"
            >
              <!-- 当前播放：左侧 indicator -->
              <span
                v-if="index === statusStore.playIndex"
                class="absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-cover"
              />
              <SImg :src="item.cover" class="size-12 rounded-lg shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="text-base truncate font-medium leading-snug">{{ item.title }}</div>
                <div
                  class="text-sm truncate leading-snug mt-0.5"
                  :class="index === statusStore.playIndex ? 'text-cover/70' : 'text-cover/55'"
                >
                  {{ formatArtists(item.artists) }}
                </div>
              </div>
              <SButton
                type="cover"
                variant="ghost"
                circle
                size="tiny"
                class="opacity-0 group-hover:opacity-100"
                @click.stop="removeAt(index)"
              >
                <template #icon><IconLucideX /></template>
              </SButton>
            </div>
          </div>
        </template>
      </SVirtualList>
    </div>
    <!-- 空 -->
    <div v-else class="flex-1 flex items-center justify-center text-cover/35">
      <div class="text-center">
        <IconLucideListMusic class="size-10 mx-auto mb-2 opacity-40" />
        <div class="text-sm">{{ t("playlist.empty") }}</div>
      </div>
    </div>

    <!-- 清空确认 -->
    <SDialog v-model:open="clearConfirmOpen" :title="t('playlist.clearConfirmTitle')">
      {{ t("playlist.clearConfirmContent") }}
      <template #footer="{ close }">
        <SButton variant="secondary" @click="close">
          {{ t("common.cancel") }}
        </SButton>
        <SButton type="error" variant="secondary" @click="clearAll">
          {{ t("common.confirm") }}
        </SButton>
      </template>
    </SDialog>
  </div>
</template>
