<script setup lang="ts">
import { marked } from "marked";
import { useUpdateStore } from "@/stores/update";
import { APP_VERSION, IS_APPX } from "@/utils/config";
import { formatFileSize } from "@/utils/format";

const { t } = useI18n();
const update = useUpdateStore();

/** release notes 渲染为 HTML */
const notesHtml = computed(() =>
  update.meta?.releaseNotes
    ? (marked.parse(update.meta.releaseNotes, { async: false }) as string)
    : "",
);

/** 发布日期（本地化，空/非法则不显示） */
const releaseDateText = computed(() => {
  const raw = update.meta?.releaseDate;
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
});
</script>

<template>
  <SDialog
    :open="update.dialogOpen"
    :title="t('update.dialogTitle')"
    width="520px"
    destroy-on-close
    @update:open="update.dialogOpen = $event"
  >
    <div class="flex flex-col gap-4">
      <!-- 版本 + 元信息 -->
      <div v-if="update.meta" class="flex items-center gap-2 text-sm">
        <STag type="default" size="small">v{{ APP_VERSION }}</STag>
        <IconLucideArrowRight class="size-4 text-on-surface-variant/50" />
        <STag type="primary" size="small">v{{ update.meta.version }}</STag>
        <div
          v-if="releaseDateText || update.meta.size > 0"
          class="ml-auto flex items-center gap-3 text-xs text-on-surface-variant/60"
        >
          <span v-if="releaseDateText" class="flex items-center gap-1">
            <IconLucideCalendar class="size-3.5" />
            {{ releaseDateText }}
          </span>
          <span v-if="update.meta.size > 0" class="flex items-center gap-1">
            <IconLucideHardDrive class="size-3.5" />
            {{ formatFileSize(update.meta.size) }}
          </span>
        </div>
      </div>
      <div
        v-if="notesHtml"
        class="overflow-hidden rounded-xl border border-solid border-primary/10 bg-on-surface/4"
      >
        <!-- eslint-disable vue/no-v-html -->
        <div class="markdown-body max-h-80 overflow-y-auto px-4 py-3" v-html="notesHtml" />
        <!-- eslint-enable vue/no-v-html -->
      </div>
    </div>

    <template #footer="{ close }">
      <SButton variant="secondary" @click="close">{{ t("update.later") }}</SButton>
      <SButton
        v-if="update.canInstall && update.meta && update.phase !== 'checking'"
        variant="secondary"
        @click="
          update.openDownloadPage();
          close();
        "
      >
        {{ t("update.goDownload") }}
      </SButton>

      <!-- 主要操作按钮：优先展示 error 与 checking 状态，再分流平台安装/外部下载 -->
      <SButton v-if="update.phase === 'error'" type="primary" @click="update.retry()">
        {{ t("common.retry") }}
      </SButton>
      <SButton v-else-if="update.phase === 'checking'" type="primary" disabled>
        {{ t("settings.about.checking") }}
      </SButton>
      <SButton
        v-else-if="update.phase === 'downloaded' && update.canInstall && update.meta"
        type="primary"
        @click="update.install()"
      >
        {{ t("update.installNow") }}
      </SButton>
      <SButton
        v-else-if="update.phase === 'downloading' && update.canInstall && update.meta"
        type="primary"
        disabled
      >
        {{ t("update.downloading") }} {{ update.percent }}%
      </SButton>
      <SButton
        v-else-if="update.phase === 'available' && update.canInstall && update.meta"
        type="primary"
        @click="update.download()"
      >
        {{ t("update.download") }}
      </SButton>
      <SButton
        v-else-if="!update.canInstall && update.meta"
        type="primary"
        @click="
          update.openDownloadPage();
          close();
        "
      >
        {{ IS_APPX ? t("update.goStore") : t("update.goDownload") }}
      </SButton>
    </template>
  </SDialog>
</template>
