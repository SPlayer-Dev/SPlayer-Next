<script setup lang="ts">
import { toast } from "@/composables/useToast";
import { useUserStore } from "@/stores/user";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  /** 登录成功 */
  success: [];
}>();

const { t } = useI18n();
const user = useUserStore();

const raw = ref("");
const loading = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) {
      raw.value = "";
      loading.value = false;
    }
  },
);

const submit = async (): Promise<void> => {
  const value = raw.value.trim();
  if (!value || !/MUSIC_U\s*=/i.test(value)) {
    toast.error(t("login.cookieInvalid"));
    return;
  }
  loading.value = true;
  try {
    const res = await window.api.apis.setCookie("netease", value);
    if (!res.ok) {
      toast.error(t("login.cookieInvalid"));
      return;
    }
    const ok = await user.fetchStatus();
    if (!ok) {
      toast.error(t("login.failed"));
      return;
    }
    toast.success(t("login.success"));
    emit("success");
    emit("update:open", false);
  } finally {
    loading.value = false;
  }
};

const onOpenUpdate = (value: boolean): void => emit("update:open", value);
</script>

<template>
  <SDialog :open="open" :title="t('login.manualCookie')" width="420px" @update:open="onOpenUpdate">
    <div class="flex flex-col gap-3">
      <SAlert>{{ t("login.cookieHint") }}</SAlert>
      <SInput
        v-model="raw"
        type="textarea"
        :rows="4"
        clearable
        :placeholder="t('login.cookiePlaceholder')"
        :disabled="loading"
      />
    </div>
    <template #footer="{ close }">
      <SButton variant="tertiary" :disabled="loading" @click="close">
        {{ t("common.cancel") }}
      </SButton>
      <SButton type="primary" :loading="loading" @click="submit">
        {{ t("login.cookieConfirm") }}
      </SButton>
    </template>
  </SDialog>
</template>
