<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";
import { useSettingsStore } from "@/stores/settings";
import AMLLLyrics from "./AMLLLyrics.vue";
import DefaultLyrics from "./DefaultLyrics.vue";
import LyricCredit from "./LyricCredit.vue";

const props = withDefaults(
  defineProps<{
    /** 歌词行数据数组 */
    lyricLines: LyricLine[];
    /** 初始播放时间（毫秒） */
    initialTime?: number;
    /** 是否正在播放 */
    playing?: boolean;
  }>(),
  {
    initialTime: 0,
    playing: false,
  },
);

const emit = defineEmits<{
  (e: "seek", timeMs: number): void;
}>();

const settings = useSettingsStore();

type LyricEngineInstance = {
  setCurrentTime: (time: number, isSeeking?: boolean) => void;
  freeze: () => void;
  resume: () => void;
};

const activeEngineRef = ref<LyricEngineInstance | null>(null);

const springConfig = computed(() => ({
  mass: settings.lyric.springMass,
  damping: settings.lyric.springDamping,
  stiffness: settings.lyric.springStiffness,
}));

const setCurrentTime = (time: number, isSeeking = false) => {
  activeEngineRef.value?.setCurrentTime(time, isSeeking);
};

const freeze = () => {
  activeEngineRef.value?.freeze();
};

const resume = () => {
  activeEngineRef.value?.resume();
};

defineExpose({
  setCurrentTime,
  freeze,
  resume,
});
</script>

<template>
  <AMLLLyrics
    v-if="settings.lyric.engine === 'amll'"
    ref="activeEngineRef"
    :lyric-lines="props.lyricLines"
    :initial-time="props.initialTime"
    :playing="props.playing"
    :align-position="settings.lyric.alignPosition"
    :word-fade-width="settings.lyric.wordFadeWidth"
    :hide-passed-lines="settings.lyric.hidePassedLines"
    :enable-blur="settings.lyric.enableBlur"
    :show-translation="settings.lyric.showTranslation"
    :show-ruby="settings.lyric.showRuby"
    :show-romanization="settings.lyric.showRomanization"
    :show-word-romanization="settings.lyric.showWordRomanization"
    :bg-always-below="settings.lyric.bgAlwaysBelow"
    @seek="emit('seek', $event)"
  >
    <template #bottom>
      <slot name="bottom">
        <LyricCredit />
      </slot>
    </template>
  </AMLLLyrics>
  <DefaultLyrics
    v-else
    ref="activeEngineRef"
    :lyric-lines="props.lyricLines"
    :initial-time="props.initialTime"
    :playing="props.playing"
    :align-position="settings.lyric.alignPosition"
    :word-fade-width="settings.lyric.wordFadeWidth"
    :spring-config="springConfig"
    :inactive-alpha="settings.lyric.inactiveAlpha"
    :hide-passed-lines="settings.lyric.hidePassedLines"
    :enable-blur="settings.lyric.enableBlur"
    :enable-word-highlight="settings.lyric.enableWordHighlight"
    :enable-float-animation="settings.lyric.enableFloatAnimation"
    :enable-emphasize-effect="settings.lyric.enableEmphasizeEffect"
    :enable-scale="settings.lyric.enableScale"
    :bg-always-below="settings.lyric.bgAlwaysBelow"
    :show-translation="settings.lyric.showTranslation"
    :show-ruby="settings.lyric.showRuby"
    :show-romanization="settings.lyric.showRomanization"
    :show-word-romanization="settings.lyric.showWordRomanization"
    @seek="emit('seek', $event)"
  >
    <template #bottom>
      <slot name="bottom">
        <LyricCredit />
      </slot>
    </template>
  </DefaultLyrics>
</template>
