<script setup lang="ts">
import type { PluginInfo } from "@shared/types/plugin";
import { usePluginsStore } from "@/stores/plugins";
import { toast } from "@/composables/useToast";
import { isExternalUrl } from "@/utils/url";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const pluginsStore = usePluginsStore();
const { sourcePlugins, controlPlugins, loaded } = storeToRefs(pluginsStore);

const confirmOpen = ref(false);
const pendingUninstallId = ref<string | null>(null);
const importing = ref(false);
const urlDialogOpen = ref(false);
const urlInput = ref("");
const urlSubmitting = ref(false);
const settingsDialogOpen = ref(false);
const settingsDialogId = ref<string | null>(null);

onMounted(() => {
  if (!loaded.value) void pluginsStore.load();
});

/** 控制类插件 ready 时声明的设置 schema（配置弹窗用） */
const controlSettings = (info: PluginInfo) => {
  if (info.status.state !== "ready") return [];
  return info.status.settings ?? [];
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

/**
 * 切换插件启用状态
 * - 音源类：setEnabled 内部已处理互斥（启用时禁掉其他音源）
 * - 控制类：setEnabled 独立切换
 * @param id - 插件 ID
 * @param currentlyEnabled - 当前是否已启用
 */
const handleToggleEnabled = async (id: string, currentlyEnabled: boolean): Promise<void> => {
  await pluginsStore.setEnabled(id, !currentlyEnabled);
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

/** 写入控制类插件的单个设置项 */
const onSettingChange = async (pluginId: string, key: string, value: unknown): Promise<void> => {
  await pluginsStore.setSetting(pluginId, key, value);
};

/** 当前打开配置弹窗的控制类插件 */
const settingsDialogInfo = computed(
  () => controlPlugins.value.find((info) => info.manifest.id === settingsDialogId.value) ?? null,
);
/** 弹窗内设置表单的 schema 与当前值 */
const settingsDialogSchema = computed(() =>
  settingsDialogInfo.value ? controlSettings(settingsDialogInfo.value) : [],
);
const settingsDialogValues = computed(() => settingsDialogInfo.value?.settingsValues ?? {});

/** 打开某控制类插件的配置弹窗 */
const openSettingsDialog = (id: string): void => {
  settingsDialogId.value = id;
  settingsDialogOpen.value = true;
};

/** 弹窗内修改某设置项 */
const onDialogSettingChange = (key: string, value: unknown): void => {
  if (settingsDialogId.value) void onSettingChange(settingsDialogId.value, key, value);
};

/** 当前待卸载的插件名（对话框提示） */
const pendingName = computed(() => {
  if (!pendingUninstallId.value) return "";
  const allPlugins = [...sourcePlugins.value, ...controlPlugins.value];
  return (
    allPlugins.find((info) => info.manifest.id === pendingUninstallId.value)?.manifest.name ?? ""
  );
});

/** 两个分区均无插件 */
const isEmpty = computed(
  () => sourcePlugins.value.length === 0 && controlPlugins.value.length === 0,
);
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
      v-if="isEmpty"
      class="flex flex-col items-center gap-3 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 py-10"
    >
      <div
        class="size-12 rounded-xl bg-on-surface/6 flex items-center justify-center text-on-surface-variant"
      >
        <IconLucidePuzzle class="size-6" />
      </div>
      <div class="text-sm text-on-surface-variant">{{ t("settings.plugins.empty") }}</div>
      <div class="text-xs text-on-surface-variant/60">{{ t("settings.plugins.emptyHint") }}</div>
    </div>

    <!-- 音源插件分区 -->
    <div v-if="sourcePlugins.length > 0" class="flex flex-col gap-2">
      <div class="text-xs font-medium text-on-surface-variant/60 px-1">
        {{ t("settings.plugins.sectionSource") }}
      </div>
      <div class="flex flex-col gap-2.5">
        <PluginCard
          v-for="info in sourcePlugins"
          :key="info.manifest.id"
          :info="info"
          @toggle="handleToggleEnabled"
          @uninstall="openUninstallConfirm"
          @configure="openSettingsDialog"
        />
      </div>
    </div>

    <!-- 控制插件分区 -->
    <div v-if="controlPlugins.length > 0" class="flex flex-col gap-2">
      <div class="text-xs font-medium text-on-surface-variant/60 px-1">
        {{ t("settings.plugins.sectionControl") }}
      </div>
      <div class="flex flex-col gap-2.5">
        <PluginCard
          v-for="info in controlPlugins"
          :key="info.manifest.id"
          :info="info"
          @toggle="handleToggleEnabled"
          @uninstall="openUninstallConfirm"
          @configure="openSettingsDialog"
        />
      </div>
    </div>

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

    <!-- 控制类插件配置 -->
    <SDialog
      v-model:open="settingsDialogOpen"
      :title="settingsDialogInfo?.manifest.name ?? ''"
      :description="t('settings.plugins.configSubtitle')"
      width="520px"
    >
      <PluginSettingsForm
        :schema="settingsDialogSchema"
        :values="settingsDialogValues"
        @change="onDialogSettingChange"
      />
      <template #footer="{ close }">
        <SButton variant="secondary" @click="close">{{ t("common.close") }}</SButton>
      </template>
    </SDialog>
  </div>
</template>
