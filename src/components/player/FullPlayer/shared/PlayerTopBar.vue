<script setup lang="ts">
import type { PlayerLayout } from "@/types/settings";
import { useSettingsStore } from "@/stores/settings";
import { useWindowControls } from "@/composables/useWindowControls";
import { useFullPlayer } from "../context";

defineProps<{
  /** 歌词开关是否禁用 */
  lyricDisabled: boolean;
  /** 歌词开关是否高亮 */
  lyricActive: boolean;
}>();

defineEmits<{ toggleLyric: [] }>();

/** 可快速切换的播放器布局 */
const LAYOUT_OPTIONS: { value: PlayerLayout; labelKey: string }[] = [
  { value: "classic", labelKey: "settings.playerLayout.classic" },
  { value: "fullCover", labelKey: "settings.playerLayout.fullCover" },
  { value: "fullLyric", labelKey: "settings.playerLayout.fullLyric" },
];

const { t } = useI18n();
const settings = useSettingsStore();
const { immersive, onBarEnter, onBarLeave } = useFullPlayer();
const { isFullscreen, toggleFullscreen } = useWindowControls();

/** 布局弹层是否打开；打开期间顶栏保持可见 */
const layoutPopoverOpen = ref(false);

/**
 * 切换播放器布局，先收起弹层避免其被布局过渡的快照分组盖住
 * @param layout - 目标布局
 */
const selectLayout = (layout: PlayerLayout): void => {
  layoutPopoverOpen.value = false;
  settings.player.layout = layout;
};
</script>

<template>
  <div
    data-player-layout="top-bar"
    class="absolute top-0 inset-x-0 h-14 z-10 app-drag-region transition-opacity duration-400 flex items-center justify-between px-3"
    :class="immersive && !layoutPopoverOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'"
    @mouseenter="onBarEnter"
    @mouseleave="onBarLeave"
  >
    <div class="app-no-drag flex items-center gap-2">
      <SButton
        type="cover"
        variant="ghost"
        circle
        :size="40"
        :disabled="lyricDisabled"
        :class="lyricActive ? 'opacity-100' : 'opacity-40'"
        @click="$emit('toggleLyric')"
      >
        <template #icon><IconLucideTextQuote /></template>
      </SButton>
    </div>
    <div class="app-no-drag flex items-center gap-3">
      <SPopover
        v-model:open="layoutPopoverOpen"
        trigger="click"
        side="bottom"
        align="end"
        :side-offset="8"
        cover
      >
        <template #trigger>
          <SButton type="cover" variant="ghost" circle :size="40">
            <template #icon><IconLucideLayoutTemplate /></template>
          </SButton>
        </template>
        <div class="flex flex-col gap-2.5">
          <h4 class="m-0 text-sm font-medium leading-tight text-cover">
            {{ t("settings.playerLayout.label") }}
          </h4>
          <div
            role="radiogroup"
            :aria-label="t('settings.playerLayout.label')"
            class="grid grid-cols-2 gap-2"
          >
            <div
              v-for="option in LAYOUT_OPTIONS"
              :key="option.value"
              role="radio"
              tabindex="0"
              :aria-checked="settings.player.layout === option.value"
              class="flex flex-col items-center gap-1.5 p-1.5 rounded-xl cursor-pointer transition-colors outline-none focus-visible:bg-cover/12"
              :class="
                settings.player.layout === option.value
                  ? 'bg-cover/14 text-cover'
                  : 'text-cover/60 hover:bg-cover/8'
              "
              @click="selectLayout(option.value)"
              @keydown.enter.prevent="selectLayout(option.value)"
              @keydown.space.prevent="selectLayout(option.value)"
            >
              <!-- 布局示意 -->
              <div
                class="relative w-28 aspect-[16/10] rounded-lg overflow-hidden bg-cover/8 border border-solid"
                :class="
                  settings.player.layout === option.value ? 'border-cover/60' : 'border-cover/15'
                "
              >
                <span
                  v-if="option.value === 'classic'"
                  class="absolute left-[12%] top-1/2 -translate-y-1/2 w-[30%] aspect-square rounded-md bg-cover/45"
                />
                <span
                  v-else-if="option.value === 'fullCover'"
                  class="layout-preview-cover absolute inset-y-0 left-0 w-[60%] bg-cover/45"
                />
                <span
                  class="absolute right-[10%] top-1/2 -translate-y-1/2 flex flex-col gap-1"
                  :class="option.value === 'fullLyric' ? 'left-[10%]' : 'w-[36%]'"
                >
                  <span class="h-1 w-[70%] rounded-full bg-cover/30" />
                  <span class="h-1 w-full rounded-full bg-cover/70" />
                  <span class="h-1 w-[85%] rounded-full bg-cover/30" />
                </span>
              </div>
              <span class="text-xs leading-none">{{ t(option.labelKey) }}</span>
            </div>
          </div>
        </div>
      </SPopover>
      <SButton type="cover" variant="ghost" circle :size="40" @click="toggleFullscreen">
        <template #icon>
          <IconLucideMinimize v-if="isFullscreen" />
          <IconLucideMaximize v-else />
        </template>
      </SButton>
      <WindowControls cover />
    </div>
  </div>
</template>

<style scoped>
.layout-preview-cover {
  mask-image: linear-gradient(to right, #000 40%, transparent);
}
</style>
