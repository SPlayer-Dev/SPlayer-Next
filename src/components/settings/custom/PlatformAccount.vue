<script setup lang="ts">
import { useDataStore } from "@/stores/data";
import { toast } from "@/composables/useToast";
import { getPlatformAccountAdapter } from "@/apis/login/platform";
import { REPO_NAME } from "@/utils/config";
import type { Platform } from "@shared/types/platform";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const dataStore = useDataStore();

const props = defineProps<{ platform: Platform }>();
const adapter = computed(() => getPlatformAccountAdapter(props.platform));
const platformName = computed(() => adapter.value.displayName);

const profile = computed(() => dataStore.getPlatformProfile(props.platform));
const loggingIn = ref(false);
const confirmOpen = ref(false);
const cookieModalOpen = ref(false);
const qrModalOpen = ref(false);
const cookieSubmitting = ref(false);
const manualCookie = ref("");
const selectedQrKey = ref<string>("");

const qrDropdownItems = computed<DropdownMenuItem[]>(() => {
  if (!adapter.value.qrLoginOptions) return [];
  return adapter.value.qrLoginOptions.map((opt) => ({
    key: opt.key,
    label: t(opt.labelKey),
  }));
});

const activeQrAdapter = computed(() => {
  if (adapter.value.qrLoginOptions?.length) {
    const target = adapter.value.qrLoginOptions.find((o) => o.key === selectedQrKey.value);
    return target?.adapter ?? adapter.value.qrLoginOptions[0].adapter;
  }
  return adapter.value.qrLogin;
});

const currentQrTitle = computed(() => {
  if (adapter.value.qrLoginOptions?.length) {
    const target = adapter.value.qrLoginOptions.find((o) => o.key === selectedQrKey.value);
    return target ? t(target.labelKey) : "";
  }
  return "";
});

const handleQrOptionSelect = (key: string): void => {
  selectedQrKey.value = key;
  qrModalOpen.value = true;
};

const openSingleQrModal = (): void => {
  if (adapter.value.qrLoginOptions?.length) {
    selectedQrKey.value = adapter.value.qrLoginOptions[0].key;
  }
  qrModalOpen.value = true;
};

watch(cookieModalOpen, (val) => {
  if (!val) {
    manualCookie.value = "";
    cookieSubmitting.value = false;
  }
});

/** 刷新登录状态并同步 Store */
const refresh = async (): Promise<void> => {
  const latest = await adapter.value.fetchProfile();
  dataStore.setPlatformProfile(props.platform, latest);
};

onMounted(refresh);

/** 发起网页登录 */
const handleLogin = async (): Promise<void> => {
  loggingIn.value = true;
  try {
    const ok = await adapter.value.openWebLogin?.();
    if (ok) {
      await refresh();
      if (profile.value) {
        toast.success(
          t("settings.platformLogin.toast.loginSuccess", {
            name: platformName.value,
            user: profile.value.nickname,
          }),
        );
      } else {
        toast.error(t("settings.platformLogin.toast.loginFailed", { name: platformName.value }));
      }
    }
  } catch (err) {
    toast.error(t("settings.platformLogin.toast.loginFailed", { name: platformName.value }));
    console.error(err);
  } finally {
    loggingIn.value = false;
  }
};

/** 断开连接 / 登出 */
const handleDisconnect = async (): Promise<void> => {
  confirmOpen.value = false;
  await adapter.value.logout();
  dataStore.clearPlatformProfile(props.platform);
  toast.success(t("settings.platformLogin.toast.logoutDone", { name: platformName.value }));
};

/** 手动输入 Cookie 提交 */
const handleManualCookieSubmit = async (): Promise<void> => {
  const cookieStr = manualCookie.value.trim();
  if (!cookieStr || cookieSubmitting.value) return;

  cookieSubmitting.value = true;
  try {
    const ok = await adapter.value.setCookie?.(cookieStr);
    if (!ok) {
      toast.error(t("settings.platformLogin.toast.cookieInvalid"));
      return;
    }

    const latest = await adapter.value.fetchProfile();
    if (latest) {
      dataStore.setPlatformProfile(props.platform, latest);
      cookieModalOpen.value = false;
      manualCookie.value = "";
      toast.success(t("settings.platformLogin.toast.cookieSuccess", { name: platformName.value }));
    } else {
      await adapter.value.logout();
      dataStore.clearPlatformProfile(props.platform);
      toast.error(t("settings.platformLogin.toast.cookieInvalid"));
    }
  } catch (err) {
    toast.error(t("settings.platformLogin.toast.cookieInvalid"));
    console.error(err);
  } finally {
    cookieSubmitting.value = false;
  }
};

/**
 * 二维码登录成功回调
 */
const handleQrSuccess = async (): Promise<void> => {
  await refresh();
  if (!profile.value) {
    toast.error(t("settings.platformLogin.toast.loginFailed", { name: platformName.value }));
    return;
  }
  qrModalOpen.value = false;
  toast.success(
    t("settings.platformLogin.toast.loginSuccess", {
      name: platformName.value,
      user: profile.value.nickname,
    }),
  );
};
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      class="flex items-center justify-between gap-4 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
    >
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <span
          v-if="profile?.avatarUrl"
          class="size-10 rounded-full overflow-hidden bg-on-surface/10 flex items-center justify-center shrink-0 border border-solid border-outline-variant/20"
        >
          <img
            :src="profile.avatarUrl"
            alt="avatar"
            class="size-full object-cover"
            referrerpolicy="no-referrer"
          />
        </span>
        <div
          v-else
          class="size-10 rounded-xl bg-on-surface/6 flex items-center justify-center text-on-surface-variant shrink-0"
        >
          <IconLucideMusic class="size-5" />
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2 text-base">
            <STag size="small">{{ platformName }}</STag>
            <span class="truncate">
              {{
                profile
                  ? profile.nickname
                  : t("settings.platformLogin.title", { name: platformName })
              }}
            </span>
            <STag v-if="profile?.isVip" size="small" round>VIP</STag>
          </div>
          <div class="text-sm text-on-surface-variant/70 mt-0.5 truncate">
            {{
              profile
                ? `${adapter.userIdLabel}: ${profile.userId}`
                : t("settings.platformLogin.desc")
            }}
          </div>
        </div>
      </div>

      <div class="shrink-0 flex items-center gap-2">
        <template v-if="profile">
          <SButton variant="secondary" size="small" type="error" @click="confirmOpen = true">
            <template #icon>
              <IconLucideUnplug class="size-4" />
            </template>
            {{ t("settings.platformLogin.logout") }}
          </SButton>
        </template>
        <template v-else>
          <SButton
            v-if="adapter.setCookie"
            variant="secondary"
            size="small"
            @click="cookieModalOpen = true"
          >
            <template #icon>
              <IconLucideKey class="size-3.5" />
            </template>
            {{ t("settings.platformLogin.manualCookie") }}
          </SButton>

          <!-- 多扫码方式下拉菜单 -->
          <SDropdownMenu
            v-if="adapter.qrLoginOptions && adapter.qrLoginOptions.length > 1"
            :items="qrDropdownItems"
            @select="handleQrOptionSelect"
          >
            <template #trigger>
              <SButton variant="secondary" size="small" type="primary">
                <template #icon><IconLucideQrCode class="size-4" /></template>
                {{ t("settings.platformLogin.loginQr") }}
                <template #extra>
                  <IconLucideChevronDown class="size-3.5 ml-0.5 opacity-70" />
                </template>
              </SButton>
            </template>
          </SDropdownMenu>

          <!-- 单扫码方式按钮 -->
          <SButton
            v-else-if="adapter.qrLogin"
            variant="secondary"
            size="small"
            type="primary"
            @click="openSingleQrModal"
          >
            <template #icon><IconLucideQrCode class="size-4" /></template>
            {{ t("settings.platformLogin.loginQr") }}
          </SButton>

          <SButton
            v-if="adapter.openWebLogin"
            variant="secondary"
            size="small"
            type="primary"
            :loading="loggingIn"
            @click="handleLogin"
          >
            <template #icon>
              <IconLucideLogIn class="size-4" />
            </template>
            {{ t("settings.platformLogin.loginWeb") }}
          </SButton>
        </template>
      </div>
    </div>

    <!-- 退出确认弹窗 -->
    <SDialog
      v-model:open="confirmOpen"
      :title="t('settings.platformLogin.logoutTitle', { name: platformName })"
      width="400px"
    >
      <p class="text-sm text-on-surface-variant">
        {{
          t("settings.platformLogin.logoutConfirm", {
            name: platformName,
            user: profile?.nickname || "",
          })
        }}
      </p>
      <template #footer="{ close }">
        <SButton variant="tertiary" @click="close">{{ t("common.cancel") }}</SButton>
        <SButton variant="secondary" type="error" @click="handleDisconnect">
          {{ t("common.confirm") }}
        </SButton>
      </template>
    </SDialog>

    <!-- 二维码登录弹窗 -->
    <SDialog v-if="activeQrAdapter" v-model:open="qrModalOpen" :closable="false" width="380px">
      <div class="flex flex-col items-center gap-4 py-3">
        <div class="flex flex-col items-center gap-2">
          <SLogo :size="48" />
          <div class="text-xl font-semibold text-on-surface">{{ REPO_NAME }}</div>
          <div v-if="currentQrTitle" class="text-xs text-on-surface-variant font-medium">
            {{ currentQrTitle }}
          </div>
        </div>
        <QrLoginPanel
          :key="selectedQrKey"
          class="mt-2"
          :active="qrModalOpen"
          :adapter="activeQrAdapter"
          @success="handleQrSuccess"
        />
      </div>
      <template #footer="{ close }">
        <SButton variant="tertiary" class="mx-auto" @click="close">
          <template #icon><IconLucideX /></template>
          {{ t("common.cancel") }}
        </SButton>
      </template>
    </SDialog>

    <!-- 手动输入 Cookie -->
    <SDialog
      v-model:open="cookieModalOpen"
      :title="t('settings.platformLogin.cookieTitle', { name: platformName })"
      width="450px"
    >
      <div class="flex flex-col gap-3 py-1">
        <SInput
          v-model="manualCookie"
          type="textarea"
          :rows="4"
          clearable
          :disabled="cookieSubmitting"
          :placeholder="t('settings.platformLogin.cookiePlaceholder')"
        />
      </div>
      <template #footer="{ close }">
        <SButton variant="tertiary" :disabled="cookieSubmitting" @click="close">
          {{ t("common.cancel") }}
        </SButton>
        <SButton type="primary" :loading="cookieSubmitting" @click="handleManualCookieSubmit">
          {{ t("common.confirm") }}
        </SButton>
      </template>
    </SDialog>
  </div>
</template>
