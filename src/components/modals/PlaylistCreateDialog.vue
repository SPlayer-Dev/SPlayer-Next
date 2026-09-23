<script setup lang="ts">
import type { ContentScope } from "@/types/collection";
import { usePlaylistStore } from "@/stores/playlist";
import { useUserStore } from "@/stores/user";
import { toast } from "@/composables/useToast";

const props = defineProps<{
  open: boolean;
  /** 默认新建类型 */
  mode: ContentScope;
  /** 预填歌单名 */
  initialName?: string;
}>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  /** 新建成功：歌单 id + 实际类型 */
  created: [playlistId: string, scope: ContentScope];
}>();

const { t } = useI18n();
const playlistStore = usePlaylistStore();
const userStore = useUserStore();

const scope = ref<ContentScope>(props.mode);
const name = ref("");
const privacy = ref<0 | 10>(0);
const submitting = ref(false);

const typeTabs = computed(() => [
  { key: "local", label: t("collection.localPlaylist") },
  { key: "online", label: t("collection.onlinePlaylist") },
]);
const canSubmit = computed(() => Boolean(name.value.trim()));

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    scope.value = props.mode;
    name.value = props.initialName?.trim() ?? "";
    privacy.value = 0;
    submitting.value = false;
  },
);

const handleConfirm = async (): Promise<void> => {
  const title = name.value.trim();
  if (!canSubmit.value || submitting.value) return;
  submitting.value = true;
  try {
    let id: string | undefined;
    if (scope.value === "local") {
      id = (await playlistStore.create(title)).id;
    } else {
      id = (await userStore.createPlaylist(title, privacy.value)).id;
    }
    if (!id) {
      toast.error(t("liked.toast.failed"));
      return;
    }
    emit("created", id, scope.value);
    emit("update:open", false);
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : t("liked.toast.failed");
    toast.error(message);
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <SDialog
    :open="open"
    :title="t('collection.create', { type: t('collection.playlist') })"
    width="480px"
    @update:open="(value) => emit('update:open', value)"
  >
    <STabs v-model="scope" :tabs="typeTabs" type="segment" animated>
      <template #local>
        <div class="flex flex-col gap-4 pt-4">
          <label class="flex flex-col gap-1">
            <span class="text-xs text-on-surface-variant">
              {{ t("collection.name", { type: t("collection.playlist") }) }}
            </span>
            <SInput
              v-model="name"
              :placeholder="t('collection.playlistNamePlaceholder')"
              :disabled="submitting"
              clearable
              @keyup.enter="handleConfirm"
            />
          </label>
        </div>
      </template>

      <template #online>
        <div class="flex flex-col gap-4 pt-4">
          <label class="flex flex-col gap-1">
            <span class="text-xs text-on-surface-variant">
              {{ t("collection.name", { type: t("collection.playlist") }) }}
            </span>
            <SInput
              v-model="name"
              :placeholder="t('collection.playlistNamePlaceholder')"
              :disabled="submitting"
              clearable
              @keyup.enter="handleConfirm"
            />
          </label>
          <div class="flex items-center gap-2">
            <span class="text-on-surface">{{ t("collection.privacy.private") }}</span>
            <SSwitch
              :model-value="privacy === 10"
              :disabled="submitting"
              @update:model-value="(value: boolean) => (privacy = value ? 10 : 0)"
            />
          </div>
        </div>
      </template>
    </STabs>

    <template #footer="{ close }">
      <SButton variant="tertiary" :disabled="submitting" @click="close">
        {{ t("common.cancel") }}
      </SButton>
      <SButton type="primary" :disabled="!canSubmit" :loading="submitting" @click="handleConfirm">
        {{ t("common.confirm") }}
      </SButton>
    </template>
  </SDialog>
</template>
