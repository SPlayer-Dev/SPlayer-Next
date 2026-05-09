<script setup lang="ts">
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import type { SSelectOption } from "@/components/ui/SSelect.vue";
import { useStreamingStore } from "@/stores/streaming";
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import IconLucideServer from "~icons/lucide/server";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";
import IconLucideMoreHorizontal from "~icons/lucide/more-horizontal";
import IconLucideSettings from "~icons/lucide/settings";
import IconLucidePlugZap from "~icons/lucide/plug-zap";
import IconLucideUnplug from "~icons/lucide/unplug";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideDisc3 from "~icons/lucide/disc-3";
import IconLucideUser from "~icons/lucide/user";
import IconLucideListMusic from "~icons/lucide/list-music";

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const streaming = useStreamingStore();
const {
  servers,
  activeServerId,
  activeServer,
  isConnected,
  connectionStatus,
  loading,
  songs,
  albums,
  artists,
  playlists,
} = storeToRefs(streaming);
const settingsDialog = useSettingsDialog();

streaming.init();

/** 状态点颜色 */
const dotClass = computed(() => {
  if (isConnected.value) return "bg-green-500";
  if (connectionStatus.value.error) return "bg-red-500";
  return "bg-amber-500";
});

const tabs = computed(() => [
  { key: "/streaming/songs", label: t("streaming.tabs.songs") },
  { key: "/streaming/albums", label: t("streaming.tabs.albums") },
  { key: "/streaming/artists", label: t("streaming.tabs.artists") },
  { key: "/streaming/playlists", label: t("streaming.tabs.playlists") },
]);

const activeTab = computed(() => {
  for (const tab of tabs.value) {
    if (route.path.startsWith(tab.key)) return tab.key;
  }
  return "/streaming/songs";
});

const switchTab = (key: string): void => {
  router.push(key);
};

/** 当前 tab 的图标 + 数量 */
const countMeta = computed(() => {
  switch (activeTab.value) {
    case "/streaming/albums":
      return {
        icon: IconLucideDisc3,
        text: t("common.totalAlbums", { count: albums.value.length }),
      };
    case "/streaming/artists":
      return {
        icon: IconLucideUser,
        text: t("common.totalArtists", { count: artists.value.length }),
      };
    case "/streaming/playlists":
      return {
        icon: IconLucideListMusic,
        text: t("common.totalPlaylists", { count: playlists.value.length }),
      };
    case "/streaming/songs":
    default:
      return {
        icon: IconLucideMusic,
        text: t("common.totalSongs", { count: songs.value.length }),
      };
  }
});

/** 服务器选项 */
const serverOptions = computed<SSelectOption[]>(() =>
  servers.value.map((s) => ({ value: s.id, label: s.name })),
);

const handleServerSelect = async (value: string | number | boolean): Promise<void> => {
  const id = String(value);
  if (id !== activeServerId.value) await streaming.setActiveServer(id);
};

const goToSettings = (): void => {
  settingsDialog.show("mediaSource");
};

/** 重连当前激活服务器 */
const reconnecting = ref(false);
const handleReconnect = async (): Promise<void> => {
  if (!activeServerId.value || reconnecting.value) return;
  reconnecting.value = true;
  try {
    await streaming.connectToServer(activeServerId.value);
  } finally {
    reconnecting.value = false;
  }
};

/** 刷新当前 tab 数据 */
const refreshKey = ref(0);
const handleRefresh = (): void => {
  refreshKey.value++;
};

provide("streamingRefreshKey", refreshKey);

const moreMenuItems = computed<DropdownMenuItem[]>(() => [
  {
    key: "settings",
    label: t("streaming.actions.settings"),
    icon: IconLucideSettings,
  },
]);

const handleMoreMenu = (key: string): void => {
  if (key === "settings") goToSettings();
};
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pb-2">
      <div class="flex items-center justify-between mt-2 mb-4 gap-4">
        <!-- 标题 + 数量统计 -->
        <div class="flex items-baseline gap-4 min-w-0">
          <h1 class="text-3xl font-bold text-on-surface shrink-0">{{ t("nav.streaming") }}</h1>
          <Transition name="fade" mode="out-in">
            <span
              v-if="activeServer"
              :key="activeTab"
              class="flex items-center gap-1.5 text-sm text-on-surface-variant/50 truncate"
            >
              <component :is="countMeta.icon" class="size-3.5 shrink-0" />
              {{ countMeta.text }}
            </span>
          </Transition>
        </div>
        <div v-if="activeServer" class="flex items-center gap-2 shrink-0">
          <span class="size-2 rounded-full shrink-0" :class="dotClass" />
          <div class="w-44">
            <SSelect
              :model-value="activeServerId ?? ''"
              :options="serverOptions"
              round
              :disabled="loading || reconnecting || servers.length <= 1"
              @update:model-value="handleServerSelect"
            />
          </div>
          <SButton
            variant="secondary"
            circle
            :disabled="!isConnected || loading"
            @click="handleRefresh"
          >
            <template #icon>
              <IconLucideRefreshCw :class="{ 'animate-spin': loading }" />
            </template>
          </SButton>
          <SDropdownMenu :items="moreMenuItems" align="end" @select="handleMoreMenu">
            <template #trigger>
              <SButton variant="secondary" circle>
                <template #icon>
                  <IconLucideMoreHorizontal />
                </template>
              </SButton>
            </template>
          </SDropdownMenu>
        </div>
      </div>
      <!-- Tabs -->
      <STabs :model-value="activeTab" :tabs="tabs" @update:model-value="switchTab" />
    </div>
    <!-- 空状态：未配置服务器 -->
    <div v-if="servers.length === 0" class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/60">
        <IconLucideServer class="size-12 mx-auto mb-3 opacity-30" />
        <div class="text-sm mb-1">{{ t("streaming.empty.noServer") }}</div>
        <div class="text-xs mb-4 opacity-70">{{ t("streaming.empty.addHint") }}</div>
        <SButton type="primary" variant="secondary" @click="goToSettings">
          {{ t("streaming.empty.goToSettings") }}
        </SButton>
      </div>
    </div>
    <!-- 已配置服务器但未连接 -->
    <div v-else-if="!isConnected" class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/60 max-w-md px-6">
        <IconLucideUnplug class="size-12 mx-auto mb-3 opacity-30" />
        <div class="text-sm mb-1">{{ t("streaming.empty.notConnected") }}</div>
        <div
          v-if="connectionStatus.error"
          class="text-xs mb-4 px-3 py-2 rounded-md bg-red-500/10 text-red-500 break-all text-left"
        >
          <div v-if="connectionStatus.errorCode" class="font-medium mb-0.5">
            {{ t(`streaming.errorCode.${connectionStatus.errorCode}`) }}
          </div>
          {{ connectionStatus.error }}
        </div>
        <div v-else class="text-xs mb-4 opacity-70">
          {{ activeServer?.name }}
        </div>
        <SButton
          type="primary"
          variant="secondary"
          :loading="reconnecting"
          @click="handleReconnect"
        >
          <template #icon>
            <IconLucidePlugZap />
          </template>
          {{ t("streaming.server.connect") }}
        </SButton>
      </div>
    </div>
    <!-- 子路由 -->
    <div v-else class="flex-1 min-h-0">
      <router-view />
    </div>
  </div>
</template>
