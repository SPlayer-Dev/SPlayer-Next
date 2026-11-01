<script setup lang="ts">
import type { AutoMixComponentId } from "@shared/types/automix";
import { autoMixComponentStatus, refreshAutoMixComponents } from "@/services/automix";
import { formatFileSize } from "@/utils/format";
import { toast } from "@/composables/useToast";

defineOptions({ inheritAttrs: false });
const { t } = useI18n();
const open = ref(false);
const pending = ref<AutoMixComponentId | null>(null);
const status = autoMixComponentStatus;
const busy = computed(() => pending.value !== null || status.value.state === "downloading");
const models = computed(() =>
  (["beat", "demucs", "runtime"] as const).map((id) => ({
    id,
    ...status.value.models.find((item) => item.id === id),
  })),
);

/** 立即显示配置弹窗，在后台读取共享的组件状态 */
const handleOpen = (): void => {
  open.value = true;
  void refreshAutoMixComponents().catch((error: unknown) => {
    toast.error(error instanceof Error ? error.message : String(error));
  });
};

/**
 * 下载并安装指定组件
 * @param id - 组件标识
 */
const install = async (id: AutoMixComponentId): Promise<void> => {
  pending.value = id;
  try {
    const result = await window.api.automix.download(id);
    const error = result.models.find((item) => item.id === id)?.error;
    if (error) toast.error(error);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  } finally {
    pending.value = null;
  }
};

/** 取消当前组件的下载或解压 */
const cancel = async (): Promise<void> => {
  try {
    await window.api.automix.cancelDownload();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
};
</script>

<template>
  <SButton variant="secondary" type="primary" size="small" @click="handleOpen">
    {{ t("settings.automixComponents.configure") }}
  </SButton>
  <SDialog v-model:open="open" :title="t('settings.automixComponents.label')" width="560px">
    <div class="flex flex-col gap-2.5">
      <SCard v-for="model in models" :key="model.id" variant="settings">
        <div class="flex flex-wrap items-center gap-3">
          <div class="min-w-0 flex-1">
            <div class="text-sm text-on-surface">
              {{ t(`settings.automixModels.${model.id}.label`) }}
            </div>
            <div class="mt-1 text-xs text-on-surface-variant/70 tabular-nums" aria-live="polite">
              <template v-if="model.state === 'downloading'">
                {{ formatFileSize(model.received ?? 0) }} / {{ formatFileSize(model.total ?? 0) }}
                <span v-if="model.bytesPerSecond" class="ml-2">
                  {{ formatFileSize(model.bytesPerSecond) }}/s
                </span>
              </template>
              <template v-else-if="model.state">
                {{ t(`settings.automixComponents.${model.state}`) }}
                <span v-if="model.total" class="ml-2">{{ formatFileSize(model.total) }}</span>
              </template>
              <template v-else>{{ t("common.loading") }}</template>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <SButton
              v-if="model.state === 'downloading'"
              variant="secondary"
              size="small"
              @click="cancel"
            >
              {{ t("common.cancel") }}
            </SButton>
            <SButton
              v-else
              variant="secondary"
              type="primary"
              size="small"
              :disabled="
                busy || !model.state || model.state === 'ready' || model.state === 'unsupported'
              "
              :loading="pending === model.id"
              @click="install(model.id)"
            >
              {{ t("settings.automixComponents.download") }}
            </SButton>
          </div>
        </div>
        <p v-if="model.error" role="alert" class="mt-2 break-words text-xs text-error">
          {{ model.error }}
        </p>
      </SCard>
    </div>
    <template #footer="{ close }">
      <SButton variant="secondary" @click="close">{{ t("common.close") }}</SButton>
    </template>
  </SDialog>
</template>
