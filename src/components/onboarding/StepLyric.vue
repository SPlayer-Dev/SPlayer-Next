<script setup lang="ts">
import lyricCategory from "@/settings/categories/lyric";
import externalLyricCategory from "@/settings/categories/externalLyric";
import { pickItems } from "@/settings/pickItems";
import IconMic2 from "~icons/lucide/mic-2";
import IconChevronLeft from "~icons/lucide/chevron-left";
import IconArrowRight from "~icons/lucide/arrow-right";

const { t } = useI18n();
defineEmits<{ (e: "next"): void; (e: "back"): void }>();

/** 歌词来源偏好 / 在线 TTML / 渲染引擎 + 外部歌词三个开关（taskbar 仅 Win 由 pickItems 过滤） */
const items = [
  ...pickItems(lyricCategory, ["lyricSourcePreference", "enableOnlineTTMLLyric", "engine"]),
  ...pickItems(externalLyricCategory, [
    "desktopLyricEnabled",
    "dynamicIslandEnabled",
    "taskbarLyricEnabled",
  ]),
];
</script>

<template>
  <div class="flex flex-col h-full max-w-2xl w-full mx-auto">
    <div class="shrink-0 flex items-center gap-3 mb-2">
      <IconMic2 class="size-6 text-primary" />
      <h2 class="text-2xl font-bold">{{ t("onboarding.lyric.title") }}</h2>
    </div>
    <p class="shrink-0 text-on-surface-variant/70 mb-4 leading-relaxed">
      {{ t("onboarding.lyric.subtitle") }}
    </p>

    <div class="flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">
      <div class="flex flex-col gap-2.5">
        <SettingsItem v-for="item in items" :key="item.key" :item="item" />
      </div>
    </div>

    <div class="shrink-0 flex items-center gap-3 mt-4">
      <SButton variant="ghost" round @click="$emit('back')">
        <template #icon><IconChevronLeft /></template>
        {{ t("onboarding.back") }}
      </SButton>
      <div class="flex-1" />
      <SButton type="primary" round @click="$emit('next')">
        {{ t("onboarding.next") }}
        <template #icon><IconArrowRight /></template>
      </SButton>
    </div>
  </div>
</template>
