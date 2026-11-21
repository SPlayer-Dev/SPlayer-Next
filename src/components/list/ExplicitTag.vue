<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";

defineProps<{
  explicit?: boolean;
  /** 跟随歌词界面主题色显示，而非默认灰化 */
  tinted?: boolean;
}>();

const { t } = useI18n();
const settings = useSettingsStore();
</script>

<template>
  <span
    v-if="explicit && !settings.preset.hideExplicitTag"
    role="img"
    :aria-label="t('songList.explicitTagLabel')"
    class="shrink-0 self-center leading-none"
    :class="tinted ? 'text-cover/90 explicit-tinted' : 'grayscale opacity-60'"
  >
    🅴
  </span>
</template>

<style scoped>
/* 强制文本字形呈现：部分平台默认按彩色 emoji 渲染，color 不生效 */
.explicit-tinted {
  font-variant-emoji: text;
}
</style>
