<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import type { K20GTStatus } from "@shared/types/k20gt";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const settings = useSettingsStore();
const status = shallowRef<K20GTStatus>({ state: "disabled" });
const reconnecting = ref(false);
let unsubscribe: (() => void) | undefined;

/** 重新打开设备接口并恢复当前歌词 */
async function reconnect(): Promise<void> {
  reconnecting.value = true;
  try {
    await window.api.k20gt.reconnect();
  } catch (error) {
    status.value = { state: "error", error: String(error) };
  } finally {
    reconnecting.value = false;
  }
}

onMounted(async () => {
  let changed = false;
  let active = true;
  const off = window.api.k20gt.onStatus((value) => {
    changed = true;
    status.value = value;
  });
  unsubscribe = () => {
    active = false;
    off();
  };
  const initial = await window.api.k20gt.getStatus();
  if (active && !changed) status.value = initial;
});

onBeforeUnmount(() => unsubscribe?.());
</script>

<template>
  <div class="flex flex-col gap-2 rounded-xl bg-on-surface/4 px-4 py-3">
    <div class="flex items-center gap-3">
      <span
        class="size-2 shrink-0 rounded-full"
        :class="status.state === 'connected' ? 'bg-green-500' : 'bg-on-surface-variant/40'"
      />
      <span class="flex-1 text-sm text-on-surface-variant">
        {{ t(`settings.k20gtStatus.${status.state}`) }}
      </span>
      <SButton
        variant="secondary"
        size="small"
        :disabled="!settings.system.k20gt.enabled"
        :loading="reconnecting || status.state === 'connecting'"
        @click="reconnect"
      >
        {{ t("settings.k20gtStatus.reconnect") }}
      </SButton>
    </div>
    <p v-if="status.error" class="break-words text-xs text-red-500">{{ status.error }}</p>
  </div>
</template>
