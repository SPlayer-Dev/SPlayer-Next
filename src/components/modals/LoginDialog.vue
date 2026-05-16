<script setup lang="ts">
import { renderSVG } from "uqr";
import { useUserStore } from "@/stores/user";
import { toast } from "@/composables/useToast";
import { dialog } from "@/composables/useDialog";
import { REPO_NAME } from "@/utils/config";
import { qrKey, qrCheck, qrContent, type QrStatusCode } from "@/apis/login/netease";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const user = useUserStore();

const loading = ref(false);
const cookieDialogOpen = ref(false);

const qrUrl = ref("");
const qrUnikey = ref("");
const qrStatus = ref<QrStatusCode>(801);
const scannedNickname = ref("");
const scannedAvatar = ref("");

const qrTip = computed(() => {
  switch (qrStatus.value) {
    case 800:
      return t("login.qrTipExpired");
    case 801:
      return t("login.qrTipWaiting");
    case 802:
      return t("login.qrTipScanned");
    case 803:
      return t("login.qrTipDone");
    default:
      return t("login.qrTipUnknown");
  }
});

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

const resetScanned = (): void => {
  scannedNickname.value = "";
  scannedAvatar.value = "";
};

/** 取新 unikey + 渲染二维码 SVG。错误纠错级 H：中心遮挡 logo 后仍可扫码
 *  用 data URL + <img> 渲染，避免 v-html 注入 SVG 的 XSS 风险面 */
const refreshQr = async (): Promise<void> => {
  resetScanned();
  qrStatus.value = 801;
  try {
    const key = await qrKey();
    qrUnikey.value = key;
    const svg = renderSVG(qrContent(key), {
      ecc: "H",
      border: 0,
      pixelSize: 8,
      whiteColor: "#ffffff",
      blackColor: "#000000",
    });
    qrUrl.value = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  } catch (err) {
    console.warn("[login] qr key failed:", err);
    qrUnikey.value = "";
    qrUrl.value = "";
  }
};

/** 803 时 cookie 已由主进程 SESSION_MUTATING 自动落库，这里只拉 profile */
const handleQrSuccess = async (cookie: string): Promise<void> => {
  if (!cookie || !cookie.includes("MUSIC_U")) {
    toast.error(t("login.failed"));
    void refreshQr();
    return;
  }
  loading.value = true;
  try {
    await finishLogin();
  } finally {
    loading.value = false;
  }
};

const pollOnce = async (): Promise<void> => {
  if (!qrUnikey.value) return;
  let result: Awaited<ReturnType<typeof qrCheck>>;
  try {
    result = await qrCheck(qrUnikey.value);
  } catch {
    return;
  }
  qrStatus.value = result.code;
  if (result.code === 800) {
    void refreshQr();
    return;
  }
  if (result.code === 802) {
    if (result.nickname) scannedNickname.value = result.nickname;
    if (result.avatarUrl) scannedAvatar.value = result.avatarUrl;
    return;
  }
  if (result.code === 803 && result.cookie) {
    pause();
    await handleQrSuccess(result.cookie);
  }
};

const { pause, resume } = useIntervalFn(pollOnce, 1500, { immediate: false });

const startQrFlow = async (): Promise<void> => {
  pause();
  await refreshQr();
  if (qrUnikey.value) resume();
};

watch(
  () => props.open,
  (open) => {
    if (open) {
      void startQrFlow();
    } else {
      pause();
      loading.value = false;
      qrUnikey.value = "";
      qrUrl.value = "";
      resetScanned();
    }
  },
  { immediate: true },
);

/** 自动获取：先弹安全提示，确认后才打开官方登录窗口 */
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
  pause();
  try {
    const res = await window.api.apis.openLoginWeb("netease");
    if (!res.ok) {
      if (res.error !== "canceled") toast.error(t("login.failed"));
      resume();
      return;
    }
    await finishLogin();
  } finally {
    loading.value = false;
  }
};

const openManualCookie = (): void => {
  pause();
  cookieDialogOpen.value = true;
};

/** cookie 弹窗关闭后恢复扫码轮询 */
const onCookieDialogOpen = (open: boolean): void => {
  cookieDialogOpen.value = open;
  if (!open && props.open) resume();
};

const onCookieSuccess = (): void => {
  emit("update:open", false);
};

const onOpenUpdate = (value: boolean): void => {
  emit("update:open", value);
};
</script>

<template>
  <SDialog :open="open" :closable="false" width="380px" @update:open="onOpenUpdate">
    <div class="flex flex-col items-center gap-4 py-3">
      <div class="flex flex-col items-center gap-2">
        <SLogo :size="48" />
        <div class="text-xl font-semibold text-on-surface">{{ REPO_NAME }}</div>
      </div>
      <!-- 二维码 -->
      <div
        class="relative size-40 mt-4 rounded-2xl bg-white p-3 border border-solid border-on-surface/12 shadow-sm overflow-hidden"
      >
        <img
          v-if="qrUrl"
          :src="qrUrl"
          alt="QR"
          :class="[
            'size-full',
            qrStatus === 802 && 'opacity-30 blur-4',
            qrStatus === 800 && 'opacity-40',
          ]"
        />
        <div v-else class="size-full flex items-center justify-center text-gray-400">
          <SLoading class="size-6" />
        </div>
        <div
          v-if="qrUrl && qrStatus !== 802 && qrStatus !== 800"
          class="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <div class="size-8 rounded-lg bg-white overflow-hidden">
            <img src="/icons/logo-icon.png" alt="logo" class="size-full object-contain" />
          </div>
        </div>
        <!-- 扫码后的预览 -->
        <Transition name="fade">
          <div
            v-if="qrStatus === 802 && scannedNickname"
            class="absolute inset-0 flex flex-col items-center justify-center gap-1.5"
          >
            <img
              v-if="scannedAvatar"
              :src="scannedAvatar"
              referrerpolicy="no-referrer"
              alt="avatar"
              class="size-12 rounded-full object-cover"
            />
            <div
              class="text-xs font-semibold text-gray-900 [text-shadow:0_0_4px_white,0_0_8px_white]"
            >
              {{ scannedNickname }}
            </div>
          </div>
        </Transition>
        <!-- 过期遮罩 -->
        <div
          v-if="qrStatus === 800"
          class="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-700 bg-white/70 cursor-pointer select-none"
          @click="refreshQr"
        >
          {{ t("login.qrRefresh") }}
        </div>
      </div>
      <div class="text-xs text-on-surface-variant">{{ qrTip }}</div>
      <!-- 辅助登录方式 -->
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
  <!-- 手动输入 -->
  <LoginCookieDialog
    :open="cookieDialogOpen"
    @update:open="onCookieDialogOpen"
    @success="onCookieSuccess"
  />
</template>
