<script setup lang="ts">
import { useCopyText } from "@/composables/useCopyText";
import { toast } from "@/composables/useToast";
import { useSettingsStore } from "@/stores/settings";
import type { McpStatus } from "@shared/types/settings";
import IconLucideCopy from "~icons/lucide/copy";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const { copy } = useCopyText();
const settings = useSettingsStore();
const status = ref<McpStatus>({ listening: false, port: null, error: null });
const restarting = ref(false);

const address = computed(
  () => `http://127.0.0.1:${status.value.port ?? settings.system.mcp.port}/mcp`,
);

const restart = async (): Promise<void> => {
  if (!settings.system.mcp.enabled || restarting.value) return;
  restarting.value = true;
  try {
    const result = await window.api.mcp.restart();
    status.value = result;
    if (result.listening) {
      toast.success(t("settings.mcp.restarted"));
    } else if (result.error?.code === "EADDRINUSE") {
      toast.error(t("settings.mcp.portInUse", { port: settings.system.mcp.port }));
    } else if (result.error) {
      toast.error(result.error.message);
    }
  } finally {
    restarting.value = false;
  }
};

let unsubscribe: (() => void) | undefined;

onMounted(async () => {
  status.value = await window.api.mcp.getStatus();
  unsubscribe = window.api.mcp.onStatus((value) => {
    status.value = value;
  });
});

onBeforeUnmount(() => unsubscribe?.());
</script>

<template>
  <div
    class="flex items-center gap-3 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3"
  >
    <span
      class="size-2 shrink-0 rounded-full"
      :class="status.listening ? 'bg-green-500' : 'bg-red-500'"
    />
    <span class="shrink-0 text-sm text-on-surface-variant">
      {{ status.listening ? t("settings.mcp.running") : t("settings.mcp.stopped") }}
    </span>
    <div
      class="min-w-0 flex-1 truncate rounded-lg bg-on-surface/5 px-3 py-2 text-sm text-on-surface-variant tabular-nums"
    >
      {{ address }}
    </div>
    <SButton variant="ghost" circle size="small" @click="copy(address)">
      <template #icon><IconLucideCopy /></template>
    </SButton>
    <SButton
      type="primary"
      variant="secondary"
      size="small"
      :disabled="!settings.system.mcp.enabled"
      :loading="restarting"
      @click="restart"
    >
      {{ t("settings.mcp.restart") }}
    </SButton>
  </div>
</template>
