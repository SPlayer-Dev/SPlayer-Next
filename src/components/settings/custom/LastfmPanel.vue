<script setup lang="ts">
import type { LastfmStatus } from "@shared/types/lastfm";
import { toast } from "@/composables/useToast";
import IconLucideRadio from "~icons/lucide/radio";
import IconLucideUnplug from "~icons/lucide/unplug";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();

const status = ref<LastfmStatus>({ connected: false, username: "" });
const connecting = ref(false);
const confirmOpen = ref(false);

/** 刷新连接状态 */
const refresh = async (): Promise<void> => {
  status.value = await window.api.lastfm.getStatus();
};

onMounted(refresh);

/** 发起连接 */
const handleConnect = async (): Promise<void> => {
  connecting.value = true;
  try {
    const result = await window.api.lastfm.connect();
    if (result.connected) {
      status.value = { connected: true, username: result.username ?? "" };
      toast.success(t("settings.lastfm.toast.connected", { name: result.username ?? "" }));
      return;
    }
    if (result.reason === "canceled") {
      toast.warning(t("settings.lastfm.toast.canceled"));
    } else if (result.reason === "timeout") {
      toast.error(t("settings.lastfm.toast.timeout"));
    } else {
      toast.error(t("settings.lastfm.toast.failed"));
    }
  } finally {
    connecting.value = false;
  }
};

/** 取消授权轮询 */
const handleCancel = (): void => {
  void window.api.lastfm.cancelConnect().catch(() => {});
};

/** 断开连接 */
const handleDisconnect = async (): Promise<void> => {
  confirmOpen.value = false;
  await window.api.lastfm.disconnect();
  await refresh();
  toast.success(t("settings.lastfm.toast.disconnected"));
};
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      class="flex items-center justify-between gap-4 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
    >
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div
          class="size-10 rounded-xl bg-on-surface/6 flex items-center justify-center text-on-surface-variant shrink-0"
        >
          <IconLucideRadio class="size-5" />
        </div>
        <div class="min-w-0">
          <div class="text-sm font-medium text-on-surface truncate">
            {{
              status.connected
                ? t("settings.lastfm.connectedAs", { name: status.username })
                : t("settings.lastfm.notConnected")
            }}
          </div>
          <div class="text-xs text-on-surface-variant/60 mt-0.5">
            {{ connecting ? t("settings.lastfm.connecting") : t("settings.lastfm.connectHint") }}
          </div>
        </div>
      </div>

      <div class="shrink-0 flex items-center gap-2">
        <SButton
          v-if="status.connected"
          variant="secondary"
          size="small"
          type="error"
          @click="confirmOpen = true"
        >
          <template #icon>
            <IconLucideUnplug class="size-4" />
          </template>
          {{ t("settings.lastfm.disconnect") }}
        </SButton>
        <template v-else>
          <SButton v-if="connecting" variant="secondary" size="small" @click="handleCancel">
            {{ t("settings.lastfm.cancel") }}
          </SButton>
          <SButton v-else variant="secondary" size="small" type="primary" @click="handleConnect">
            {{ t("settings.lastfm.connect") }}
          </SButton>
        </template>
      </div>
    </div>

    <SDialog v-model:open="confirmOpen" :title="t('settings.lastfm.disconnect')" width="400px">
      <p class="text-sm text-on-surface-variant">
        {{ t("settings.lastfm.connectedAs", { name: status.username }) }}
      </p>
      <template #footer="{ close }">
        <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
        <SButton variant="secondary" type="error" @click="handleDisconnect">
          {{ t("common.confirm") }}
        </SButton>
      </template>
    </SDialog>
  </div>
</template>
