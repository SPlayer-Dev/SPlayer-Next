<script setup lang="ts">
import type { PluginInfo } from "@shared/types/plugin";
import { usePluginsStore } from "@/stores/plugins";
import { toast } from "@/composables/useToast";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const pluginsStore = usePluginsStore();
const { list, loaded } = storeToRefs(pluginsStore);

const confirmOpen = ref(false);
const pendingUninstallId = ref<string | null>(null);
const importing = ref(false);

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

/** name 首字母作为 avatar */
const initial = (name: string): string => (name.trim()[0] ?? "?").toUpperCase();

const handleImport = async (): Promise<void> => {
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

const handleToggleEnabled = async (id: string, enabled: boolean): Promise<void> => {
  await pluginsStore.setEnabled(id, enabled);
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
  return (
    list.value.find((i) => i.manifest.id === pendingUninstallId.value)?.manifest.name ?? ""
  );
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
      <SButton type="primary" size="small" :loading="importing" @click="handleImport">
        <template #icon>
          <IconLucidePlus class="size-4" />
        </template>
        {{ t("settings.plugins.import") }}
      </SButton>
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
    <ul v-else class="flex flex-col gap-2.5">
      <li
        v-for="info in list"
        :key="info.manifest.id"
        class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
      >
        <div class="flex items-start gap-3">
          <!-- 首字母头像 -->
          <div
            class="shrink-0 size-10 rounded-xl bg-primary/12 text-primary flex items-center justify-center text-base font-semibold"
          >
            {{ initial(info.manifest.name) }}
          </div>

          <!-- 主体信息 -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-medium text-on-surface truncate">
                {{ info.manifest.name }}
              </span>
              <STag size="tiny" type="default">v{{ info.manifest.version }}</STag>
              <STag size="tiny" :type="statusTag(info).type">
                {{ t(`settings.plugins.status.${statusTag(info).key}`) }}
              </STag>
              <STag
                v-if="info.manifest.platform === 'lx'"
                size="tiny"
                type="info"
                variant="outline"
              >
                lx
              </STag>
            </div>

            <div
              v-if="info.manifest.description"
              class="mt-1 text-xs text-on-surface-variant/70 line-clamp-2"
            >
              {{ info.manifest.description }}
            </div>

            <div
              v-if="info.manifest.author || sourceNames(info).length"
              class="mt-1.5 flex items-center gap-2 flex-wrap text-xs text-on-surface-variant/60"
            >
              <span v-if="info.manifest.author">
                {{ t("settings.plugins.by") }} {{ info.manifest.author }}
              </span>
              <span
                v-if="info.manifest.author && sourceNames(info).length"
                class="text-on-surface-variant/30"
                >·</span
              >
              <span v-if="sourceNames(info).length" class="flex items-center gap-1 flex-wrap">
                <span>{{ t("settings.plugins.sources") }}:</span>
                <STag
                  v-for="src in sourceNames(info)"
                  :key="src"
                  size="tiny"
                  variant="outline"
                  type="primary"
                >
                  {{ src }}
                </STag>
              </span>
            </div>

            <div
              v-if="info.status.state === 'error'"
              class="mt-2 rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-500 break-all"
            >
              {{ info.status.error.message }}
            </div>
          </div>

          <!-- 操作区 -->
          <div class="shrink-0 flex items-center gap-3">
            <SSwitch
              :model-value="info.enabled"
              @update:model-value="(v: boolean) => handleToggleEnabled(info.manifest.id, v)"
            />
            <SButton
              variant="text"
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
        <SButton type="error" @click="handleConfirmUninstall">{{ t("common.confirm") }}</SButton>
      </template>
    </SDialog>
  </div>
</template>
