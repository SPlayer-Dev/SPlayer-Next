<script setup lang="ts">
import { renderSVG } from "uqr";
import type { QrLoginAdapter, QrLoginState } from "@/apis/login/platform";

const props = defineProps<{ active: boolean; adapter: QrLoginAdapter }>();
const emit = defineEmits<{ success: [] }>();
const { t } = useI18n();

const qrUrl = ref("");
const key = ref("");
const state = ref<QrLoginState>("waiting");
const nickname = ref("");
const avatarUrl = ref("");
const refreshing = ref(false);

const tip = computed(() => {
  if (state.value === "expired") return t("login.qrTipExpired");
  if (state.value === "scanned") return t("login.qrTipScanned");
  if (state.value === "success") return t("login.qrTipDone");
  return t("login.qrTipWaiting");
});

const refresh = async (): Promise<void> => {
  if (refreshing.value) return;
  refreshing.value = true;
  pause();
  if (state.value !== "expired") qrUrl.value = "";
  nickname.value = "";
  avatarUrl.value = "";
  try {
    const result = await props.adapter.create();
    key.value = result.key;
    if (result.content.startsWith("data:image/") || result.content.startsWith("blob:")) {
      qrUrl.value = result.content;
    } else {
      const svg = renderSVG(result.content, {
        ecc: "H",
        border: 0,
        pixelSize: 8,
        whiteColor: "#ffffff",
        blackColor: "#000000",
      });
      qrUrl.value = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }
    state.value = "waiting";
    if (props.active) resume();
  } finally {
    refreshing.value = false;
  }
};

const poll = async (): Promise<void> => {
  if (!key.value) return;
  const result = await props.adapter.check(key.value);
  state.value = result.state;
  nickname.value = result.nickname ?? nickname.value;
  avatarUrl.value = result.avatarUrl ?? avatarUrl.value;
  if (result.state === "expired") {
    pause();
    await refresh();
    return;
  }
  if (result.state === "success") {
    pause();
    emit("success");
  }
};

const { pause, resume } = useIntervalFn(poll, 1500, { immediate: false });

watch(
  () => props.active,
  (active) => {
    if (active) void refresh();
    else pause();
  },
  { immediate: true },
);

onBeforeUnmount(pause);

defineExpose({ pause, resume, refresh });
</script>

<template>
  <div class="flex flex-col items-center gap-3">
    <div
      class="relative size-40 rounded-2xl bg-white p-3 border border-solid border-on-surface/12 shadow-sm overflow-hidden"
    >
      <img
        v-if="qrUrl"
        :src="qrUrl"
        alt="QR"
        :class="[
          'size-full',
          state === 'scanned' && (avatarUrl || nickname) && 'opacity-30 blur-4',
          state === 'expired' && 'opacity-40',
        ]"
      />
      <SLoading v-else class="absolute inset-0 m-auto size-6 text-gray-400" />
      <Transition name="fade">
        <div
          v-if="state === 'scanned' && (avatarUrl || nickname)"
          class="absolute inset-0 flex flex-col items-center justify-center gap-1.5"
        >
          <img
            v-if="avatarUrl"
            :src="avatarUrl"
            alt="avatar"
            class="size-12 rounded-full object-cover"
          />
          <div v-if="nickname" class="text-xs font-semibold text-gray-900">{{ nickname }}</div>
        </div>
      </Transition>
      <div
        v-if="state === 'expired'"
        class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/75 text-xs font-medium text-gray-700"
      >
        <SLoading class="size-5" />
        {{ t("login.qrTipExpired") }}
      </div>
    </div>
    <div class="text-xs text-on-surface-variant">{{ tip }}</div>
  </div>
</template>
