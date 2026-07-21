<script setup lang="ts">
import { useUserStore } from "@/stores/user";
import LoginDialog from "@/components/modals/LoginDialog.vue";
import IconUserRound from "~icons/lucide/user-round";
import IconChevronLeft from "~icons/lucide/chevron-left";
import IconArrowRight from "~icons/lucide/arrow-right";
import IconLogIn from "~icons/lucide/log-in";

const { t } = useI18n();
const emit = defineEmits<{ (e: "next"): void; (e: "back"): void }>();
const user = useUserStore();
const { profile, isLoggedIn } = storeToRefs(user);

const loginOpen = ref(false);

onMounted(() => {
  void user.fetchStatus();
});
</script>

<template>
  <div class="flex flex-col h-full max-w-2xl w-full mx-auto">
    <div class="shrink-0 flex items-center gap-3 mb-2">
      <IconUserRound class="size-6 text-primary" />
      <h2 class="text-2xl font-bold">{{ t("onboarding.netease.title") }}</h2>
    </div>
    <p class="shrink-0 text-on-surface-variant/70 mb-6 leading-relaxed">
      {{ t("onboarding.netease.subtitle") }}
    </p>

    <div class="flex-1 min-h-0 flex items-center justify-center">
      <!-- 已登录 -->
      <div
        v-if="isLoggedIn && profile"
        class="flex flex-col items-center gap-3 text-center w-full max-w-sm"
      >
        <img
          v-if="profile.avatarUrl"
          :src="profile.avatarUrl"
          referrerpolicy="no-referrer"
          alt="avatar"
          class="size-20 rounded-full object-cover border border-solid border-outline-variant/20"
        />
        <div v-else class="size-20 rounded-full bg-primary/15 flex items-center justify-center">
          <IconUserRound class="size-10 text-primary" />
        </div>
        <div class="text-lg font-semibold">{{ profile.nickname }}</div>
        <div class="text-sm text-on-surface-variant/70">
          {{ t("onboarding.netease.loggedInHint") }}
        </div>
      </div>

      <!-- 未登录 -->
      <div v-else class="flex flex-col items-center gap-5 text-center w-full max-w-sm">
        <div class="text-sm text-on-surface-variant/70 leading-relaxed">
          {{ t("onboarding.netease.guestHint") }}
        </div>
        <div class="flex items-center gap-3">
          <SButton type="primary" round @click="loginOpen = true">
            <template #icon><IconLogIn /></template>
            {{ t("onboarding.netease.loginButton") }}
          </SButton>
          <SButton variant="ghost" round @click="emit('next')">
            {{ t("onboarding.netease.skipButton") }}
          </SButton>
        </div>
      </div>
    </div>

    <div class="shrink-0 flex items-center gap-3 mt-4">
      <SButton variant="ghost" round @click="emit('back')">
        <template #icon><IconChevronLeft /></template>
        {{ t("onboarding.back") }}
      </SButton>
      <div class="flex-1" />
      <SButton type="primary" round @click="emit('next')">
        {{ t("onboarding.next") }}
        <template #icon><IconArrowRight /></template>
      </SButton>
    </div>

    <LoginDialog v-model:open="loginOpen" />
  </div>
</template>
