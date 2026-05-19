<script setup lang="ts">
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { useUserStore } from "@/stores/user";
import SongList from "@/components/list/SongList.vue";
import { formatFileSize } from "@/utils/format";
import * as player from "@/core/player";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";
import IconLucideListChecks from "~icons/lucide/list-checks";
import IconLucideCloud from "~icons/lucide/cloud";
import IconLucideHardDrive from "~icons/lucide/hard-drive";

const { t } = useI18n();
const router = useRouter();
const user = useUserStore();

const searchQuery = ref("");

/** 已用容量百分比 */
const usagePercent = computed(() => {
  if (user.cloudMaxSize <= 0) return 0;
  return Math.min(100, Math.round((user.cloudSize / user.cloudMaxSize) * 100));
});

const usageText = computed(() => {
  if (user.cloudMaxSize <= 0) return "";
  return `${formatFileSize(user.cloudSize)} / ${formatFileSize(user.cloudMaxSize)}`;
});

/** 当前曲目数 */
const trackCount = computed(() => user.cloudCount || user.cloudTracks.length);

const handlePlayAll = (): void => {
  if (user.cloudTracks.length === 0) return;
  player.playFrom(user.cloudTracks, 0);
};

const songListRef = shallowRef<InstanceType<typeof SongList> | null>(null);

const moreMenuItems = computed<DropdownMenuItem[]>(() => [
  { key: "refresh", label: t("common.refreshCache"), icon: markRaw(IconLucideRefreshCw) },
  { key: "batch", label: t("songList.batch.manage"), icon: markRaw(IconLucideListChecks) },
]);

const handleMoreMenu = (key: string): void => {
  if (key === "refresh") user.ensureCloud(true);
  else if (key === "batch") songListRef.value?.enterBatch();
};

const goToLogin = (): void => {
  router.push("/library");
};

watch(
  () => user.isLoggedIn,
  (loggedIn) => {
    if (loggedIn) user.ensureCloud();
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pb-2">
      <div class="flex items-center justify-between mt-2 mb-4">
        <div class="flex items-baseline gap-4 min-w-0">
          <h1 class="text-3xl font-bold text-on-surface shrink-0">{{ t("cloud.title") }}</h1>
          <div
            v-if="user.isLoggedIn && trackCount > 0"
            class="flex items-center gap-4 text-sm text-on-surface-variant/50 truncate"
          >
            <span class="flex items-center gap-1">
              <IconLucideCloud class="size-3.5" />
              {{ t("common.totalSongs", { count: trackCount }) }}
            </span>
            <span v-if="usageText" class="flex items-center gap-2 min-w-0">
              <IconLucideHardDrive class="size-3.5 shrink-0" />
              <span
                class="relative h-1.5 w-20 rounded-full bg-on-surface/10 overflow-hidden shrink-0"
              >
                <span
                  class="absolute inset-y-0 left-0 bg-primary rounded-full transition-[width] duration-300"
                  :style="{ width: `${usagePercent}%` }"
                />
              </span>
              <span class="text-xs truncate">{{ usageText }}</span>
            </span>
          </div>
        </div>
      </div>
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <SButton
            type="primary"
            variant="secondary"
            round
            :disabled="user.cloudTracks.length === 0"
            @click="handlePlayAll"
          >
            <template #icon>
              <IconLucidePlay />
            </template>
            {{ t("common.playAll") }}
          </SButton>
          <SDropdownMenu :items="moreMenuItems" align="start" @select="handleMoreMenu">
            <template #trigger>
              <SButton variant="secondary" circle :disabled="!user.isLoggedIn">
                <template #icon>
                  <IconLucideEllipsis />
                </template>
              </SButton>
            </template>
          </SDropdownMenu>
        </div>
        <SInput
          v-model="searchQuery"
          :placeholder="t('common.search')"
          clearable
          round
          class="w-40 focus-within:w-56"
        >
          <template #prefix>
            <IconLucideSearch class="size-4 text-on-surface-variant/40 shrink-0" />
          </template>
        </SInput>
      </div>
    </div>
    <!-- 列表 -->
    <Transition name="fade" mode="out-in" :duration="150">
      <!-- 未登录 -->
      <div v-if="!user.isLoggedIn" key="login" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideCloud class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm mb-4">{{ t("cloud.needLogin") }}</div>
          <SButton type="primary" variant="secondary" @click="goToLogin">
            {{ t("login.netease") }}
          </SButton>
        </div>
      </div>
      <!-- 列表 -->
      <div v-else-if="user.cloudTracks.length > 0" key="list" class="flex-1 min-h-0">
        <SongList
          ref="songListRef"
          :items="user.cloudTracks"
          :search-query="searchQuery"
          source="netease"
          collection-type="cloud"
          enable-sort
        />
      </div>
      <!-- 加载中 -->
      <div
        v-else-if="user.cloudLoading"
        key="loading"
        class="flex-1 flex items-center justify-center"
      >
        <div class="text-center text-on-surface-variant/60">
          <SLoading class="text-4xl text-primary/70 mb-4 mx-auto block" />
          <div class="text-sm">{{ t("common.loading") }}</div>
        </div>
      </div>
      <!-- 空 -->
      <div v-else key="empty" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideCloud class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm">{{ t("cloud.empty") }}</div>
        </div>
      </div>
    </Transition>
  </div>
</template>
