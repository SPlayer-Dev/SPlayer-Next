<script setup lang="ts">
import servicesCategory from "@/settings/categories/services";
import downloadCategory from "@/settings/categories/download";
import localCacheCategory from "@/settings/categories/localCache";
import { pickItems } from "@/settings/pickItems";
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import IconSettings from "~icons/lucide/settings-2";
import IconPuzzle from "~icons/lucide/puzzle";
import IconChevronLeft from "~icons/lucide/chevron-left";
import IconArrowRight from "~icons/lucide/arrow-right";

const { t } = useI18n();
defineEmits<{ (e: "next"): void; (e: "back"): void }>();

/** 网络与服务五个分类主控件 + 下载主开关 + 歌曲缓存开关 */
const items = [
  ...pickItems(servicesCategory, [
    "networkProxyProtocol",
    "systemMediaControls",
    "discordEnabled",
    "lastfmEnabled",
    "externalApiEnabled",
  ]),
  ...pickItems(downloadCategory, ["downloadEnabled"]),
  ...pickItems(localCacheCategory, ["enableSongCache"]),
];

const settingsDialog = useSettingsDialog();
/** 打开设置弹窗到插件管理分类 */
const openPlugins = (): void => settingsDialog.show("plugins");
</script>

<template>
  <div class="flex flex-col h-full max-w-2xl w-full mx-auto">
    <div class="shrink-0 flex items-center gap-3 mb-2">
      <IconSettings class="size-6 text-primary" />
      <h2 class="text-2xl font-bold">{{ t("onboarding.other.title") }}</h2>
    </div>
    <p class="shrink-0 text-on-surface-variant/70 mb-4 leading-relaxed">
      {{ t("onboarding.other.subtitle") }}
    </p>

    <div class="flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">
      <div class="flex flex-col gap-2.5 mb-4">
        <SettingsItem v-for="item in items" :key="item.key" :item="item" />
      </div>

      <!-- 插件管理入口 -->
      <div
        class="flex items-center justify-between gap-4 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 text-base">
            <span>{{ t("settings.group.plugins") }}</span>
            <STag type="primary">Beta</STag>
          </div>
          <div class="text-sm text-on-surface-variant/70 mt-0.5">
            {{ t("onboarding.other.pluginManageHint") }}
          </div>
        </div>
        <SButton type="primary" variant="secondary" size="small" @click="openPlugins">
          <template #icon><IconPuzzle /></template>
          {{ t("onboarding.other.pluginManage") }}
        </SButton>
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
