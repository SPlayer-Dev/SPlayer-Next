<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import { CURRENT_AGREEMENT_VERSION } from "@shared/constants/agreement";

const router = useRouter();
const settings = useSettingsStore();

const accepting = ref(false);

/** 用户重新同意协议后,写回版本号并跳回主页 */
const onAccept = async (): Promise<void> => {
  if (accepting.value) return;
  accepting.value = true;
  try {
    await settings.setSystem("system.agreedAgreementVersion", CURRENT_AGREEMENT_VERSION);
    await router.replace("/");
  } finally {
    accepting.value = false;
  }
};
</script>

<template>
  <div class="flex flex-col h-screen w-screen bg-app text-on-surface overflow-hidden">
    <div class="app-drag-region h-16 shrink-0 flex items-center justify-end px-3">
      <WindowControls direct-quit />
    </div>

    <div class="flex-1 min-h-0 flex flex-col items-center px-8 py-6">
      <div class="w-full max-w-2xl flex-1 min-h-0 flex flex-col">
        <StepAgreement variant="update" :loading="accepting" @next="onAccept" />
      </div>
    </div>
  </div>
</template>
