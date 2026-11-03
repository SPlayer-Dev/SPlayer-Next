<script setup lang="ts">
import type { Component } from "vue";
import type { PlayerLayout } from "@/types/settings";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { useImmersiveMode } from "@/composables/useImmersiveMode";
import { playerTransitionActive, switchPlayerLayout } from "@/services/playerTransition";
import { fullPlayerContextKey } from "./context";
import ClassicLayout from "./layouts/standard/ClassicLayout.vue";
import FullCoverLayout from "./layouts/standard/FullCoverLayout.vue";
import FullLyricLayout from "./layouts/standard/FullLyricLayout.vue";
import AppleLayout from "./layouts/apple/AppleLayout.vue";

/** 布局设置与布局组件的对应关系 */
const LAYOUTS: Record<PlayerLayout, Component> = {
  classic: ClassicLayout,
  fullCover: FullCoverLayout,
  fullLyric: FullLyricLayout,
  apple: AppleLayout,
};

const status = useStatusStore();
const settings = useSettingsStore();
const { isPlaying, isPlayerExpanded } = storeToRefs(status);

const lyricMounted = ref(false);
const lyricReady = ref(false);
const contentPrepared = ref(false);
const playerVisible = ref(false);
const visualizerMounted = ref(false);
let visualizerIdle = 0;
const visibility = useDocumentVisibility();

const contentActive = computed(
  () => isPlayerExpanded.value && contentPrepared.value && visibility.value === "visible",
);

/** 实际渲染的布局，与设置解耦以便在切换前截取旧快照 */
const layout = ref(settings.player.layout);
watch(
  () => settings.player.layout,
  (value) => switchPlayerLayout(() => (layout.value = value)),
  { flush: "sync" },
);

/** 歌词首帧就绪后在空闲时段创建可视化，避免布局测量与 WebGL 初始化争抢一帧 */
const scheduleVisualizers = (): void => {
  if (
    visualizerIdle ||
    visualizerMounted.value ||
    playerTransitionActive.value ||
    !isPlayerExpanded.value ||
    visibility.value !== "visible"
  ) {
    return;
  }
  visualizerIdle = requestIdleCallback(
    () => {
      visualizerIdle = 0;
      if (
        isPlayerExpanded.value &&
        !playerTransitionActive.value &&
        visibility.value === "visible"
      ) {
        visualizerMounted.value = true;
      }
    },
    { timeout: 500 },
  );
};

/** 歌词完成首次布局后安排可视化初始化 */
const onLyricReady = (): void => {
  if (!isPlayerExpanded.value) return;
  lyricReady.value = true;
  scheduleVisualizers();
};

watch(visibility, (value) => {
  if (value === "visible" && lyricReady.value) scheduleVisualizers();
});

/** 每次展开只初始化一次歌词，复用已挂载内容处理快速收起再展开 */
const preparePlayerContent = (): void => {
  if (contentPrepared.value) return;
  contentPrepared.value = true;
  lyricMounted.value = true;
  nextTick(() => {
    if (isPlayerExpanded.value && lyricReady.value) scheduleVisualizers();
  });
};

/** 展开前仅显示静态背景与封面 */
const onBeforeEnter = (): void => {
  playerVisible.value = true;
  contentPrepared.value = false;
};

/** 普通过渡完成后准备内容，共享过渡由快照结束驱动 */
const onAfterEnter = (): void => {
  if (!isPlayerExpanded.value || playerTransitionActive.value) return;
  preparePlayerContent();
};

watch(
  playerTransitionActive,
  (active, previous, onCleanup) => {
    if (active || !previous || !isPlayerExpanded.value) return;
    // 动画结束后再加载歌词引擎，避免解析抢占动画帧
    const idle = requestIdleCallback(
      () => {
        if (!playerTransitionActive.value && isPlayerExpanded.value) preparePlayerContent();
      },
      { timeout: 300 },
    );
    onCleanup(() => cancelIdleCallback(idle));
  },
  { immediate: true },
);

/** 收起前取消可视化初始化，歌词随 contentActive 冻结 */
const onBeforeLeave = (): void => {
  cancelIdleCallback(visualizerIdle);
  visualizerIdle = 0;
};

/** 收起结束后卸载歌词与可视化 */
const onAfterLeave = (): void => {
  playerVisible.value = false;
  lyricMounted.value = false;
  lyricReady.value = false;
  visualizerMounted.value = false;
};

onBeforeUnmount(() => cancelIdleCallback(visualizerIdle));

const { immersive, onPlayerMouseEnter, onPlayerMouseLeave, onMainMove, onBarEnter, onBarLeave } =
  useImmersiveMode(isPlayerExpanded);

provide(fullPlayerContextKey, {
  immersive,
  lyricMounted,
  contentActive,
  onLyricReady,
  onBarEnter,
  onBarLeave,
});
</script>

<template>
  <Teleport to="body">
    <Transition
      appear
      :css="!playerTransitionActive"
      enter-active-class="transition-transform duration-500 ease-[cubic-bezier(0.7,0,0.3,1)]"
      leave-active-class="transition-transform duration-500 ease-[cubic-bezier(0.7,0,0.3,1)]"
      enter-from-class="translate-y-full"
      leave-to-class="translate-y-full"
      @after-enter="onAfterEnter"
      @before-enter="onBeforeEnter"
      @before-leave="onBeforeLeave"
      @after-leave="onAfterLeave"
    >
      <div
        v-show="isPlayerExpanded"
        class="player-panel fixed inset-0 z-200 overflow-hidden text-cover"
        :class="immersive ? 'cursor-none [&_*]:!cursor-none' : ''"
        style="--lp-color: rgb(var(--s-cover))"
        @mouseenter="onPlayerMouseEnter"
        @mousemove="onMainMove"
        @mouseleave="onPlayerMouseLeave"
      >
        <PlayerBackground :visible="playerVisible" :active="visualizerMounted" />
        <BottomSpectrum
          v-if="isPlayerExpanded && visualizerMounted && settings.player.enableSpectrum"
          :show="isPlaying && immersive"
        />
        <component :is="LAYOUTS[layout]" />
      </div>
    </Transition>
  </Teleport>
</template>
