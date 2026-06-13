<script setup lang="ts">
import IconLucideFolder from "~icons/lucide/folder";
import IconLucideFolderPlus from "~icons/lucide/folder-plus";
import IconLucideTrash2 from "~icons/lucide/trash-2";

defineOptions({ inheritAttrs: false });

defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const { t } = useI18n();

const open = ref(false);

const folderName = (dir: string): string => {
  const parts = dir.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || dir;
};

const choose = async () => {
  const dir = await window.api.lyrics.pickLyricRepoDir();
  if (dir) emit("update:modelValue", dir);
};

const clear = () => emit("update:modelValue", "");
</script>

<template>
  <SButton type="primary" variant="secondary" size="small" @click="open = true">
    {{ t("common.configure") }}
  </SButton>
  <SDialog
    v-model:open="open"
    :title="t('settings.localLyricRepoDir.label')"
    :description="t('settings.localLyricRepoDir.description')"
    width="480px"
  >
    <div class="flex flex-col gap-2">
      <div v-if="modelValue" class="flex items-center gap-3 rounded-lg bg-on-surface/4 px-3 py-2">
        <IconLucideFolder class="size-4 shrink-0 text-on-surface-variant" />
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm text-on-surface">{{ folderName(modelValue) }}</div>
          <div class="truncate text-xs text-on-surface-variant/60">{{ modelValue }}</div>
        </div>
        <SButton
          variant="ghost"
          size="small"
          :title="t('settings.localLyricRepoDir.clear')"
          @click="clear"
        >
          <template #icon><IconLucideTrash2 /></template>
        </SButton>
      </div>

      <div v-else class="py-6 text-center text-sm text-on-surface-variant/50">
        {{ t("settings.localLyricRepoDir.unset") }}
      </div>

      <SButton class="mt-1" variant="secondary" block @click="choose">
        <template #icon><IconLucideFolderPlus /></template>
        {{ t("settings.localLyricRepoDir.choose") }}
      </SButton>
    </div>
  </SDialog>
</template>
