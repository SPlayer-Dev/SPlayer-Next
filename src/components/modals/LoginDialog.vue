<script setup lang="ts">
import { useUserStore } from "@/stores/user";
import { toast } from "@/composables/useToast";
import { dialog } from "@/composables/useDialog";
import { REPO_NAME } from "@/utils/config";
import { neteaseQrLoginAdapter } from "@/apis/login/netease";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const { t } = useI18n();
const user = useUserStore();
const adapter = neteaseQrLoginAdapter;
const panelRef = useTemplateRef("panelRef");
const loading = ref(false);
const cookieDialogOpen = ref(false);

const finishLogin = async (): Promise<boolean> => {
  const ok = await user.fetchStatus();
  if (ok) {
    toast.success(t("login.success"));
    emit("update:open", false);
    return true;
  }
  toast.error(t("login.failed"));
  return false;
};

const handleQrSuccess = async (): Promise<void> => {
  loading.value = true;
  try {
    if (!(await finishLogin())) void panelRef.value?.refresh();
  } finally {
    loading.value = false;
  }
};

const startAutoFetch = async (): Promise<void> => {
  if (loading.value) return;
  const ok = await dialog.confirm({
    title: t("login.autoFetchTitle"),
    content: t("login.autoFetchTip"),
    confirmText: t("login.autoFetchConfirm"),
    type: "warning",
  });
  if (!ok) return;
  loading.value = true;
  panelRef.value?.pause();
  try {
    const result = await window.api.apis.openLoginWeb("netease");
    if (!result.ok) {
      if (result.error !== "canceled") toast.error(t("login.failed"));
      panelRef.value?.resume();
      return;
    }
    if (!(await finishLogin())) void panelRef.value?.refresh();
  } finally {
    loading.value = false;
  }
};

const openManualCookie = (): void => {
  panelRef.value?.pause();
  cookieDialogOpen.value = true;
};

const onCookieDialogOpen = (open: boolean): void => {
  cookieDialogOpen.value = open;
  if (!open && props.open) panelRef.value?.resume();
};
</script>

<template>
  <SDialog :open="open" :closable="false" width="380px" @update:open="emit('update:open', $event)">
    <div class="flex flex-col items-center gap-4 py-3">
      <div class="flex flex-col items-center gap-2">
        <SLogo :size="48" />
        <div class="text-xl font-semibold text-on-surface">{{ REPO_NAME }}</div>
      </div>
      <QrLoginPanel
        ref="panelRef"
        class="mt-4"
        :active="open"
        :adapter="adapter"
        @success="handleQrSuccess"
      />
      <div class="flex items-center gap-2 pt-1">
        <SButton variant="ghost" size="small" :disabled="loading" @click="startAutoFetch">
          <template #icon><IconLucideScanLine /></template>
          {{ t("login.autoFetch") }}
        </SButton>
        <div class="h-3 w-px bg-outline-variant/40" />
        <SButton variant="ghost" size="small" :disabled="loading" @click="openManualCookie">
          <template #icon><IconLucideKeyRound /></template>
          {{ t("login.manualCookie") }}
        </SButton>
      </div>
    </div>
    <template #footer="{ close }">
      <SButton variant="tertiary" class="mx-auto" :disabled="loading" @click="close">
        <template #icon><IconLucideX /></template>
        {{ t("common.cancel") }}
      </SButton>
    </template>
  </SDialog>
  <LoginCookieDialog
    :open="cookieDialogOpen"
    @update:open="onCookieDialogOpen"
    @success="emit('update:open', false)"
  />
</template>
