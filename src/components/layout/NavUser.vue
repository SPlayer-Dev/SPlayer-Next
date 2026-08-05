<script setup lang="ts">
import { useUserStore } from "@/stores/user";
import { dialog } from "@/composables/useDialog";
import { toast } from "@/composables/useToast";
import { dailySignin, fetchSigninStatus } from "@/apis/user/netease";
import vipImg from "@/assets/images/vip.png";
import IconLucideListMusic from "~icons/lucide/list-music";
import IconLucideDisc3 from "~icons/lucide/disc-3";
import IconLucideUserRound from "~icons/lucide/user-round";
import IconLucideDatabase from "~icons/lucide/database";

const { t } = useI18n();
const router = useRouter();
const user = useUserStore();

const loginOpen = ref(false);
const popoverOpen = ref(false);
const signinLoading = ref(false);
/** 今日是否已签到 */
const signed = ref(false);
/** 连续签到天数（签到进度接口不可用时为 undefined，隐藏徽章） */
const signinDays = ref<number>();

/** 本地签到日期记录 key（值为 YYYY-MM-DD，跨天自动失效） */
const SIGNIN_DATE_KEY = "splayer/netease-signin-date";

/** 本地日期字符串（YYYY-MM-DD） */
const todayStr = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

/** 写入/清除本地签到记录 */
const persistSigned = (): void => {
  localStorage.setItem(SIGNIN_DATE_KEY, todayStr());
};

/** 本地记录今天已签到（接口拿不到状态时兜底） */
const locallySigned = (): boolean => localStorage.getItem(SIGNIN_DATE_KEY) === todayStr();

/** 拉取签到状态（今日签到 + 连续天数），失败时静默保留旧值 */
const refreshSigninStatus = async (): Promise<void> => {
  try {
    const status = await fetchSigninStatus();
    if (status.signed === true) signed.value = true;
    if (status.days !== undefined) signinDays.value = status.days;
  } catch {
    // 状态仅为展示性信息，失败不打扰用户
  }
};

/** 启动时校验登录态（cookie 仍有效就刷新 profile） */
onMounted(() => {
  if (user.profile) {
    user.fetchStatus().catch(() => undefined);
  }
});

/** 每次展开面板时重置签到状态，再以本地记录 + 接口为准 */
watch(popoverOpen, (open) => {
  if (!open || !user.isLoggedIn) return;
  signed.value = false;
  if (locallySigned()) signed.value = true;
  refreshSigninStatus();
});

const isVip = computed(() => !!user.profile?.vipType && user.profile.vipType !== 0);

/** 收藏计数 */
const stats = computed(() => [
  {
    key: "playlist" as const,
    label: t("collection.playlist"),
    icon: markRaw(IconLucideListMusic),
    value:
      (user.subcount.createdPlaylistCount || 0) + (user.subcount.subPlaylistCount || 0) ||
      user.playlists.length,
  },
  {
    key: "album" as const,
    label: t("collection.album"),
    icon: markRaw(IconLucideDisc3),
    value: user.albums.length,
  },
  {
    key: "artist" as const,
    label: t("artist.label"),
    icon: markRaw(IconLucideUserRound),
    value: user.subcount.artistCount ?? user.artists.length,
  },
]);

const onTriggerClick = (): void => {
  if (!user.isLoggedIn) loginOpen.value = true;
};

const handleStatClick = (key: "playlist" | "album" | "artist"): void => {
  popoverOpen.value = false;
  router.push({ path: "/favorites", query: { tab: key } });
};

const handleSignin = async (): Promise<void> => {
  if (signinLoading.value) return;
  signinLoading.value = true;
  try {
    const { point } = await dailySignin(1);
    toast.success(t("login.signinSuccess", { point }));
    signed.value = true;
    persistSigned();
    refreshSigninStatus();
  } catch (err) {
    const code = (err as Error & { code?: number }).code;
    if (code === -2) {
      // 服务端确认今日已签到
      toast.info(t("login.signinRepeat"));
      signed.value = true;
      persistSigned();
    } else if (code === 301) {
      toast.warning(t("login.signinNeedLogin"));
    } else {
      toast.error(t("login.signinFailed"));
    }
  } finally {
    signinLoading.value = false;
  }
};

const handleLogout = async (): Promise<void> => {
  popoverOpen.value = false;
  const ok = await dialog.confirm({
    title: t("login.logoutConfirmTitle"),
    content: t("login.logoutConfirmDesc"),
    type: "warning",
  });
  if (!ok) return;
  await user.logout();
  toast.success(t("login.logoutDone"));
};
</script>

<template>
  <SPopover
    v-if="user.isLoggedIn"
    v-model:open="popoverOpen"
    trigger="click"
    align="end"
    content-class="w-40"
  >
    <template #trigger>
      <div
        class="app-no-drag inline-flex items-center gap-2 h-10 pl-1 pr-3 rounded-full bg-on-surface/6 hover:bg-on-surface/10 transition-colors cursor-pointer select-none"
      >
        <span
          class="size-8 rounded-full overflow-hidden bg-on-surface/10 flex items-center justify-center"
        >
          <img
            v-if="user.profile?.avatarUrl"
            :src="user.profile.avatarUrl"
            alt="avatar"
            class="size-full object-cover"
            referrerpolicy="no-referrer"
          />
          <IconLucideUserRound v-else class="size-4 text-on-surface-variant" />
        </span>
        <span class="text-sm text-on-surface max-w-[7rem] truncate">
          {{ user.profile?.nickname || t("login.unknownUser") }}
        </span>
        <img v-if="isVip" :src="vipImg" alt="VIP" class="h-4 shrink-0" />
        <IconLucideChevronDown
          :class="[
            'size-3 text-on-surface-variant transition-transform duration-200',
            popoverOpen && 'rotate-180',
          ]"
        />
      </div>
    </template>

    <div class="flex flex-col items-center gap-2">
      <span
        class="size-12 rounded-full overflow-hidden bg-on-surface/10 flex items-center justify-center"
      >
        <img
          v-if="user.profile?.avatarUrl"
          :src="user.profile.avatarUrl"
          alt="avatar"
          class="size-full object-cover"
          referrerpolicy="no-referrer"
        />
        <IconLucideUserRound v-else class="size-5 text-on-surface-variant" />
      </span>
      <span class="w-full text-sm font-semibold text-on-surface text-center truncate">
        {{ user.profile?.nickname || t("login.unknownUser") }}
      </span>
      <div v-if="user.level !== undefined || isVip" class="flex items-center gap-1.5">
        <span
          v-if="user.level !== undefined"
          class="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none bg-amber-500/15 text-amber-600 dark:text-amber-400 tabular-nums"
        >
          Lv.{{ user.level }}
        </span>
        <img v-if="isVip" :src="vipImg" alt="VIP" class="h-4 shrink-0" />
      </div>
      <span
        v-if="user.profile?.signature"
        class="text-xs text-on-surface-variant text-center line-clamp-2"
      >
        {{ user.profile.signature }}
      </span>
      <SDivider class="w-full" />
      <!-- 收藏计数 -->
      <div class="w-full flex items-stretch justify-around gap-1">
        <div
          v-for="item in stats"
          :key="item.key"
          :title="item.label"
          class="group flex flex-1 flex-col items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors duration-200 hover:bg-on-surface/8 active:bg-on-surface/12"
          @click="handleStatClick(item.key)"
        >
          <component
            :is="item.icon"
            class="size-4 text-on-surface-variant/70 transition-colors duration-200 group-hover:text-primary"
          />
          <span
            class="text-sm font-semibold text-on-surface tabular-nums leading-none transition-colors duration-200 group-hover:text-primary"
          >
            {{ item.value }}
          </span>
        </div>
      </div>
      <SDivider class="w-full" />
      <SButton
        variant="secondary"
        size="small"
        block
        :loading="signinLoading"
        :disabled="signed"
        @click="handleSignin"
      >
        <template #icon><IconLucideDatabase /></template>
        {{ signed ? t("login.signed") : t("login.signin") }}
        <span
          v-if="signinDays !== undefined"
          class="ml-0.5 inline-flex items-center px-1 py-0.5 rounded-md bg-primary/15 text-primary text-[10px] font-semibold leading-none tabular-nums"
        >
          {{ signinDays }}
        </span>
      </SButton>
      <SButton variant="secondary" size="small" block @click="handleLogout">
        <template #icon><IconLucideLogOut /></template>
        {{ t("login.logout") }}
      </SButton>
    </div>
  </SPopover>

  <SButton v-else class="app-no-drag" variant="tertiary" :size="40" circle @click="onTriggerClick">
    <template #icon><IconLucideUserRound /></template>
  </SButton>

  <LoginDialog v-model:open="loginOpen" />
</template>
