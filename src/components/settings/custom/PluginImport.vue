<script setup lang="ts">
import { usePluginsStore } from "@/stores/plugins";
import { toast } from "@/composables/useToast";
import { isExternalUrl, openExternal } from "@/utils/url";

defineOptions({ inheritAttrs: false });

/** 插件开发文档地址 */
const DOCS_URL = "https://splayer-next.imsyy.top/plugins/";

const { t } = useI18n();
const pluginsStore = usePluginsStore();

const importing = ref(false);
const urlDialogOpen = ref(false);
const urlInput = ref("");
const urlSubmitting = ref(false);

/** 通过原生文件选择框导入本地脚本 */
const handleImportLocal = async (): Promise<void> => {
  importing.value = true;
  try {
    const res = await pluginsStore.pickAndInstall();
    if (res.cancelled) return;
    if (res.ok) toast.success(t("settings.plugins.importSuccess"));
    else toast.error(res.error ?? t("settings.plugins.importFailed"));
  } finally {
    importing.value = false;
  }
};

const openUrlDialog = (): void => {
  urlInput.value = "";
  urlDialogOpen.value = true;
};

/** 从 URL 下载并导入 */
const handleImportFromUrl = async (): Promise<void> => {
  const url = urlInput.value.trim();
  if (!isExternalUrl(url)) {
    toast.error(t("settings.plugins.importUrlInvalid"));
    return;
  }
  urlSubmitting.value = true;
  try {
    const res = await pluginsStore.installFromUrl(url);
    if (res.ok) {
      toast.success(t("settings.plugins.importSuccess"));
      urlDialogOpen.value = false;
    } else {
      toast.error(res.error ?? t("settings.plugins.importFailed"));
    }
  } finally {
    urlSubmitting.value = false;
  }
};
</script>

<template>
  <div class="flex flex-col gap-3">
    <SAlert type="warning" :title="t('settings.plugins.securityWarningTitle')">
      {{ t("settings.plugins.securityWarning") }}
    </SAlert>

    <div
      class="flex items-center justify-between gap-4 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
    >
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-base">
          <span>{{ t("settings.plugins.hint") }}</span>
        </div>
        <div class="text-sm text-on-surface-variant/70 mt-0.5 flex items-center gap-1 flex-wrap">
          <span>{{ t("settings.plugins.hintDetail") }}</span>
          <a
            class="text-primary cursor-pointer hover:underline inline-flex items-center gap-0.5"
            @click="openExternal(DOCS_URL)"
          >
            {{ t("settings.plugins.docs") }}
          </a>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <SButton variant="secondary" size="small" :loading="importing" @click="handleImportLocal">
          <template #icon>
            <IconLucideFolderOpen class="size-4" />
          </template>
          {{ t("settings.plugins.importLocal") }}
        </SButton>
        <SButton variant="secondary" size="small" type="primary" @click="openUrlDialog">
          <template #icon>
            <IconLucideLink class="size-4" />
          </template>
          {{ t("settings.plugins.importFromUrl") }}
        </SButton>
      </div>
    </div>

    <!-- 在线导入 -->
    <SDialog
      v-model:open="urlDialogOpen"
      :title="t('settings.plugins.importUrlTitle')"
      width="480px"
    >
      <SInput
        v-model="urlInput"
        :placeholder="t('settings.plugins.importUrlPlaceholder')"
        :disabled="urlSubmitting"
        clearable
        @keydown.enter="handleImportFromUrl"
      />
      <template #footer="{ close }">
        <SButton variant="secondary" :disabled="urlSubmitting" @click="close">
          {{ t("common.cancel") }}
        </SButton>
        <SButton
          variant="secondary"
          type="primary"
          :loading="urlSubmitting"
          @click="handleImportFromUrl"
        >
          {{ t("settings.plugins.importUrlSubmit") }}
        </SButton>
      </template>
    </SDialog>
  </div>
</template>
