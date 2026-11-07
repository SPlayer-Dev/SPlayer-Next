<script setup lang="ts">
import { getWordSweepProgress } from "lyric-kit";
import { computeLyricScrollOffset } from "@windows/shared/lyricScroll";
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });

const status = useStatusStore();
const media = useMediaStore();
const settings = useSettingsStore();
const visibility = useDocumentVisibility();
const viewportRef = ref<HTMLElement>();
const textRef = ref<HTMLElement>();
const mode = computed(() => settings.player.barLyricMode);
const mainLines = computed(() => media.parsedLyric.filter((line) => !line.isBG));

const currentLine = computed(() => {
  if (!settings.player.showLyricInBar || !status.isPlaying || media.lyricIndex < 0) return null;
  const currentMs = media.parsedLyric[media.lyricIndex]?.startTime ?? 0;
  return mainLines.value.findLast((line) => line.startTime <= currentMs) ?? null;
});

const original = computed(() => currentLine.value?.words.map((word) => word.word).join("") ?? "");
const text = computed(() => {
  const translation = currentLine.value?.translatedLyric;
  return mode.value === "translation" && translation
    ? `${original.value}（${translation}）`
    : original.value;
});
const wordMode = computed(() => {
  const words = currentLine.value?.words;
  return mode.value === "word" && media.wordTimed && !!words?.length;
});

// 隐藏时不订阅播放进度，恢复后直接采用最新时间
const time = computed(() => {
  if (!currentLine.value || status.isPlayerExpanded || visibility.value !== "visible") return null;
  return status.position + status.lyricOffsetMs;
});
const metrics = shallowRef({ viewport: 0, overflow: 0 });

/** 缓存容器和当前行宽度，尺寸变化时重新测量 */
const measure = (): void => {
  const viewport = viewportRef.value;
  const content = textRef.value;
  if (!viewport || !content) return;
  metrics.value = {
    viewport: viewport.clientWidth,
    overflow: Math.max(0, content.scrollWidth - viewport.clientWidth),
  };
};

useResizeObserver([viewportRef, textRef], measure);

const scrollOffset = computed(() => {
  const line = currentLine.value;
  const { viewport, overflow } = metrics.value;
  if (!line || time.value === null || !overflow) return 0;
  return computeLyricScrollOffset({
    currentMs: time.value,
    activatedAtMs: line.startTime,
    timingLine: line,
    containerWidth: viewport,
    range: { startOffset: 0, distance: overflow },
  });
});
</script>

<template>
  <Transition name="slide-up" mode="out-in">
    <div
      v-if="currentLine && original"
      :key="`${currentLine.startTime}:${original}`"
      ref="viewportRef"
      class="bar-lyric min-w-0 overflow-hidden text-on-surface-variant"
      :class="[compact ? 'text-xs leading-tight mt-0.5' : 'text-sm mt-1']"
    >
      <span
        ref="textRef"
        class="bar-text relative inline-block whitespace-pre align-top"
        :class="
          time !== null &&
          'transition-transform duration-200 ease-linear motion-reduce:transition-none'
        "
        :style="{ transform: `translateX(${scrollOffset}px)` }"
      >
        <template v-if="wordMode">
          <span
            v-for="(word, index) in currentLine.words"
            :key="index"
            class="bar-word inline text-transparent bg-clip-text [-webkit-text-fill-color:transparent]"
            :class="
              time !== null
                ? 'duration-200 ease-linear motion-reduce:transition-none'
                : 'duration-0'
            "
            :style="{
              '--bar-word-progress':
                time === null ? 1 : getWordSweepProgress(word, currentLine.startTime, time),
            }"
          >
            {{ word.word }}
          </span>
        </template>
        <template v-else>{{ text }}</template>
      </span>
    </div>
    <slot v-else />
  </Transition>
</template>

<style scoped>
@property --bar-word-progress {
  syntax: "<number>";
  inherits: false;
  initial-value: 0;
}

.bar-lyric {
  .bar-word {
    transition-property: --bar-word-progress;
    background-image: linear-gradient(
      90deg,
      color-mix(in srgb, rgb(var(--s-on-surface-variant)) 65%, rgb(var(--s-on-surface)))
        calc(var(--bar-word-progress) * (100% + 4px) - 4px),
      rgb(var(--s-on-surface-variant) / 0.55) calc(var(--bar-word-progress) * (100% + 4px))
    );
  }
}
</style>
