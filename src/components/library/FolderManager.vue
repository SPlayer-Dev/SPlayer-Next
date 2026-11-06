<script setup lang="ts">
import { useLibraryStore } from "@/stores/library";
import { ErrorCode } from "@shared/types/errors";
import { toast } from "@/composables/useToast";
import IconLucideFolder from "~icons/lucide/folder";
import IconLucideFolderPlus from "~icons/lucide/folder-plus";
import IconLucideTrash2 from "~icons/lucide/trash-2";

const { t } = useI18n();
const libraryStore = useLibraryStore();
const { scanDirs } = storeToRefs(libraryStore);

const emit = defineEmits<{
  (e: "added"): void;
  (e: "removed", dir: string): void;
}>();

const folderName = (dir: string): string => {
  const parts = dir.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || dir;
};

const adding = ref(false);
const removingDir = ref<string | null>(null);
const removeConfirmOpen = ref(false);

const handleAdd = async (): Promise<void> => {
  if (adding.value) return;
  adding.value = true;
  try {
    const res = await libraryStore.addScanDir();
    if (res.success) {
      emit("added");
    } else if (res.error === ErrorCode.SCAN_DIR_NESTED) {
      toast.warning(t("library.nestedHint"));
    } else if (res.error) {
      toast.error(res.error);
    }
  } finally {
    adding.value = false;
  }
};

const confirmRemove = (dir: string): void => {
  removingDir.value = dir;
  removeConfirmOpen.value = true;
};

const handleRemove = async (): Promise<void> => {
  const dir = removingDir.value;
  if (!dir) return;
  await libraryStore.removeScanDir(dir);
  removeConfirmOpen.value = false;
  emit("removed", dir);
};

/** 进入时确保已同步后端目录列表 */
onMounted(() => {
  if (!libraryStore.initialized) libraryStore.load();
});
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      v-for="dir in scanDirs"
      :key="dir"
      class="flex items-center gap-3 px-3 py-2 rounded-lg bg-on-surface/4"
    >
      <IconLucideFolder class="size-4 text-on-surface-variant shrink-0" />
      <div class="flex-1 min-w-0">
        <div class="text-sm truncate text-on-surface">{{ folderName(dir) }}</div>
        <div class="text-xs truncate text-on-surface-variant/60">{{ dir }}</div>
      </div>
      <SButton variant="ghost" size="small" @click="confirmRemove(dir)">
        <template #icon><IconLucideTrash2 /></template>
      </SButton>
    </div>

    <div v-if="scanDirs.length === 0" class="py-6 text-center text-on-surface-variant/50 text-sm">
      {{ t("library.emptyHint") }}
    </div>

    <SButton class="mt-1" variant="secondary" :loading="adding" block @click="handleAdd">
      <template #icon><IconLucideFolderPlus /></template>
      {{ t("library.addFolder") }}
    </SButton>

    <SDialog v-model:open="removeConfirmOpen" :title="t('library.removeFolder')">
      <template #default>
        <p class="text-sm text-on-surface-variant">{{ t("library.removeFolderConfirm") }}</p>
        <p class="text-xs text-on-surface-variant/60 mt-2 break-all">{{ removingDir }}</p>
      </template>
      <template #footer="{ close }">
        <SButton variant="secondary" @click="close">
          {{ t("common.cancel") }}
        </SButton>
        <SButton type="error" @click="handleRemove">
          {{ t("common.confirm") }}
        </SButton>
      </template>
    </SDialog>
  </div>
</template>
