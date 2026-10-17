<script setup lang="ts">
import IconLucideFolder from "~icons/lucide/folder";
import IconLucideFolderPlus from "~icons/lucide/folder-plus";
import IconLucideTrash2 from "~icons/lucide/trash-2";

defineOptions({ inheritAttrs: false });

const props = defineProps<{ modelValue: string[] }>();
const emit = defineEmits<{ "update:modelValue": [value: string[]] }>();

const { t } = useI18n();

const open = ref(false);

const dirs = computed(() => props.modelValue ?? []);

const folderName = (dir: string): string => {
  const parts = dir.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || dir;
};

const choose = async () => {
  const dir = await window.api.lyrics.pickLyricRepoDir();
  if (!dir || dirs.value.includes(dir)) return;
  emit("update:modelValue", [...dirs.value, dir]);
};

const remove = (dir: string) =>
  emit(
    "update:modelValue",
    dirs.value.filter((item) => item !== dir),
  );
</script>

<template>
  <SButton type="primary" variant="secondary" size="small" @click="open = true">
    {{ t("common.configure") }}
  </SButton>
  <SDialog
    v-model:open="open"
    :title="t('settings.localLyricRepoDirs.label')"
    :description="t('settings.localLyricRepoDirs.description')"
    width="480px"
  >
    <div class="flex flex-col gap-2">
      <div
        v-for="dir in dirs"
        :key="dir"
        class="flex items-center gap-3 rounded-lg bg-on-surface/4 px-3 py-2"
      >
        <IconLucideFolder class="size-4 shrink-0 text-on-surface-variant" />
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm text-on-surface">{{ folderName(dir) }}</div>
          <div class="truncate text-xs text-on-surface-variant/60">{{ dir }}</div>
        </div>
        <SButton
          variant="ghost"
          size="small"
          :title="t('settings.localLyricRepoDirs.clear')"
          @click="remove(dir)"
        >
          <template #icon><IconLucideTrash2 /></template>
        </SButton>
      </div>

      <div v-if="dirs.length === 0" class="py-6 text-center text-sm text-on-surface-variant/50">
        {{ t("settings.localLyricRepoDirs.unset") }}
      </div>

      <div class="mt-1 text-xs text-on-surface-variant/60">
        {{ t("settings.localLyricRepoDirs.hint") }}
      </div>

      <SButton variant="secondary" block @click="choose">
        <template #icon><IconLucideFolderPlus /></template>
        {{ t("settings.localLyricRepoDirs.choose") }}
      </SButton>
    </div>
  </SDialog>
</template>
