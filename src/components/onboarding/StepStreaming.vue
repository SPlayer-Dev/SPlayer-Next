<script setup lang="ts">
import mediaSourceCategory from "@/settings/categories/streaming";
import { pickItems } from "@/settings/pickItems";
import IconServer from "~icons/lucide/server";
import IconChevronLeft from "~icons/lucide/chevron-left";
import IconArrowRight from "~icons/lucide/arrow-right";

const { t } = useI18n();
defineEmits<{ (e: "next"): void; (e: "back"): void }>();

/** 流媒体开关 + 服务器列表（StreamingServerList 为 fullWidth custom 组件） */
const items = pickItems(mediaSourceCategory, ["streamingEnabled", "streamingServerList"]);
</script>

<template>
  <div class="flex flex-col h-full max-w-2xl w-full mx-auto">
    <div class="shrink-0 flex items-center gap-3 mb-2">
      <IconServer class="size-6 text-primary" />
      <h2 class="text-2xl font-bold">{{ t("onboarding.streaming.title") }}</h2>
    </div>
    <p class="shrink-0 text-on-surface-variant/70 mb-4 leading-relaxed">
      {{ t("onboarding.streaming.subtitle") }}
    </p>

    <div class="flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">
      <div class="flex flex-col gap-2.5">
        <SettingsItem v-for="item in items" :key="item.key" :item="item" compact />
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
