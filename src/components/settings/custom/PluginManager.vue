<script setup lang="ts">
import type { PluginInfo } from "@shared/types/plugin";
import { usePluginsStore } from "@/stores/plugins";
import { toast } from "@/composables/useToast";
import { isExternalUrl, openExternal } from "@/utils/url";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const pluginsStore = usePluginsStore();
const { list, loaded } = storeToRefs(pluginsStore);

const confirmOpen = ref(false);
const pendingUninstallId = ref<string | null>(null);
const importing = ref(false);
const urlDialogOpen = ref(false);
const urlInput = ref("");
const urlSubmitting = ref(false);

onMounted(() => {
  if (!loaded.value) void pluginsStore.load();
});

type TagType = "default" | "success" | "info" | "warning" | "error";

/** 当前状态 → 徽章颜色 + 文案 key */
const statusTag = (info: PluginInfo): { type: TagType; key: string } => {
  if (!info.enabled) return { type: "default", key: "disabled" };
  switch (info.status.state) {
    case "ready":
      return { type: "success", key: "ready" };
    case "loading":
      return { type: "info", key: "loading" };
    case "error":
      return { type: "error", key: "error" };
    case "disabled":
      return { type: "default", key: "disabled" };
    default:
      return { type: "warning", key: "unloaded" };
  }
};

/** ready 状态下展示声明的 sources 名 */
const sourceNames = (info: PluginInfo): string[] => {
  if (info.status.state !== "ready") return [];
  return Object.keys(info.status.sources);
};

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

const handleToggleEnabled = async (id: string, currentlyEnabled: boolean): Promise<void> => {
  if (currentlyEnabled) {
    await pluginsStore.setEnabled(id, false);
  } else {
    await pluginsStore.enableExclusive(id);
  }
};

const openUninstallConfirm = (id: string): void => {
  pendingUninstallId.value = id;
  confirmOpen.value = true;
};

const handleConfirmUninstall = async (): Promise<void> => {
  const id = pendingUninstallId.value;
  confirmOpen.value = false;
  pendingUninstallId.value = null;
  if (!id) return;
  const res = await pluginsStore.uninstall(id);
  if (res.ok) toast.success(t("settings.plugins.uninstallSuccess"));
  else toast.error(res.error ?? t("settings.plugins.uninstallFailed"));
};

/** 当前待卸载的插件名（对话框提示） */
const pendingName = computed(() => {
  if (!pendingUninstallId.value) return "";
  return list.value.find((i) => i.manifest.id === pendingUninstallId.value)?.manifest.name ?? "";
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- 顶部操作条：说明 + 导入按钮 -->
    <div
      class="flex items-center justify-between gap-4 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3"
    >
      <div class="min-w-0 flex-1">
        <div class="text-sm text-on-surface">{{ t("settings.plugins.hint") }}</div>
        <div class="text-xs text-on-surface-variant/60 mt-0.5">
          {{ t("settings.plugins.hintDetail") }}
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <SButton variant="secondary" size="small" :loading="importing" @click="handleImportLocal">
          <template #icon>
            <IconLucideFolderOpen class="size-4" />
          </template>
          {{ t("settings.plugins.importLocal") }}
        </SButton>
        <SButton variant="secondary" size="small" @click="openUrlDialog">
          <template #icon>
            <IconLucideLink class="size-4" />
          </template>
          {{ t("settings.plugins.importFromUrl") }}
        </SButton>
      </div>
    </div>

    <!-- 空态 -->
    <div
      v-if="list.length === 0"
      class="flex flex-col items-center gap-3 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 py-10"
    >
      <div
        class="size-12 rounded-xl bg-on-surface/6 flex items-center justify-center text-on-surface-variant"
      >
        <IconLucidePuzzle class="size-6" />
      </div>
      <div class="text-sm text-on-surface-variant">
        {{ t("settings.plugins.empty") }}
      </div>
      <div class="text-xs text-on-surface-variant/60">
        {{ t("settings.plugins.emptyHint") }}
      </div>
    </div>

    <!-- 插件列表 -->
    <ul v-else class="flex flex-col gap-2.5 list-none p-0 m-0">
      <li
        v-for="info in list"
        :key="info.manifest.id"
        class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
      >
        <div class="flex items-start gap-3">
          <!-- 主体信息 -->
          <div class="flex-1 min-w-0">
            <!-- 标题行：名字 + 版本 + 状态 + 外链 -->
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-medium text-on-surface truncate">
                {{ info.manifest.name }}
              </span>
              <button
                v-if="isExternalUrl(info.manifest.homepage)"
                type="button"
                class="p-0 border-none bg-transparent text-on-surface-variant/50 hover:text-primary cursor-pointer transition-colors leading-0"
                :title="info.manifest.homepage"
                @click="openExternal(info.manifest.homepage)"
              >
                <IconLucideExternalLink class="size-3.5" />
              </button>
              <STag size="tiny" type="default" variant="soft">v{{ info.manifest.version }}</STag>
              <STag size="tiny" :type="statusTag(info).type" variant="soft">
                {{ t(`settings.plugins.status.${statusTag(info).key}`) }}
              </STag>
              <STag v-if="info.updateInfo" size="tiny" type="warning" variant="soft">
                {{ t("settings.plugins.updateAvailable") }}
              </STag>
            </div>

            <!-- 简介 -->
            <div
              v-if="info.manifest.description"
              class="mt-1.5 flex items-start gap-1.5 text-xs text-on-surface-variant/70"
            >
              <IconLucideInfo class="size-3.5 shrink-0 mt-0.5 opacity-60" />
              <span class="line-clamp-2">{{ info.manifest.description }}</span>
            </div>

            <!-- 作者 + 支持源 -->
            <div
              v-if="info.manifest.author || sourceNames(info).length"
              class="mt-1.5 flex items-center gap-3 flex-wrap text-xs text-on-surface-variant/60"
            >
              <span v-if="info.manifest.author" class="flex items-center gap-1">
                <IconLucideUser class="size-3.5 opacity-60" />
                {{ info.manifest.author }}
              </span>
              <span v-if="sourceNames(info).length" class="flex items-center gap-1 flex-wrap">
                <STag
                  v-for="src in sourceNames(info)"
                  :key="src"
                  size="tiny"
                  variant="soft"
                  type="primary"
                  class="gap-1"
                >
                  <IconLucideDatabase class="size-3" />
                  {{ src }}
                </STag>
              </span>
            </div>

            <!-- 错误信息 -->
            <div
              v-if="info.status.state === 'error'"
              class="mt-2 rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-500 break-all"
            >
              {{ info.status.error.message }}
            </div>

            <!-- 更新提示 -->
            <div
              v-if="info.updateInfo"
              class="mt-2 rounded-md bg-amber-500/10 px-3 py-2 flex flex-col gap-1.5"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5 text-xs font-medium text-amber-600">
                  <IconLucideArrowUpCircle class="size-3.5" />
                  <span>
                    {{ t("settings.plugins.newVersion") }}
                    <template v-if="info.updateInfo.version">
                      v{{ info.updateInfo.version }}
                    </template>
                  </span>
                </div>
                <SButton
                  v-if="isExternalUrl(info.updateInfo.updateUrl)"
                  variant="secondary"
                  size="tiny"
                  type="warning"
                  @click="openExternal(info.updateInfo.updateUrl)"
                >
                  <template #icon>
                    <IconLucideExternalLink class="size-3" />
                  </template>
                  {{ t("settings.plugins.openUpdateUrl") }}
                </SButton>
              </div>
              <div
                v-if="info.updateInfo.log"
                class="text-xs text-on-surface-variant/80 whitespace-pre-wrap break-words"
              >
                {{ info.updateInfo.log }}
              </div>
            </div>
          </div>

          <!-- 操作区 -->
          <div class="shrink-0 flex items-center gap-2">
            <SButton
              :variant="info.enabled ? 'filled' : 'secondary'"
              size="small"
              :type="info.enabled ? 'primary' : 'default'"
              @click="handleToggleEnabled(info.manifest.id, info.enabled)"
            >
              <template #icon>
                <IconLucideCircleCheck v-if="info.enabled" class="size-4" />
                <IconLucidePower v-else class="size-4" />
              </template>
              {{ info.enabled ? t("settings.plugins.enabled") : t("settings.plugins.enable") }}
            </SButton>
            <SButton
              variant="secondary"
              size="small"
              type="error"
              @click="openUninstallConfirm(info.manifest.id)"
            >
              <template #icon>
                <IconLucideTrash2 class="size-4" />
              </template>
              {{ t("settings.plugins.uninstall") }}
            </SButton>
          </div>
        </div>
      </li>
    </ul>

    <!-- URL 导入 -->
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

    <!-- 卸载确认 -->
    <SDialog
      v-model:open="confirmOpen"
      :title="t('settings.plugins.uninstallConfirmTitle')"
      width="400px"
    >
      <p class="text-sm text-on-surface-variant">
        {{ t("settings.plugins.uninstallConfirm", { name: pendingName }) }}
      </p>
      <template #footer="{ close }">
        <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
        <SButton variant="secondary" type="error" @click="handleConfirmUninstall">
          {{ t("common.confirm") }}
        </SButton>
      </template>
    </SDialog>
  </div>
</template>
