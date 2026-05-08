<script setup lang="ts">
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { useStreamingStore } from "@/stores/streaming";
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import IconLucideServer from "~icons/lucide/server";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";
import IconLucideChevronDown from "~icons/lucide/chevron-down";
import IconLucidePlugZap from "~icons/lucide/plug-zap";
import IconLucideCog from "~icons/lucide/cog";
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

/** 状态点颜色：已连接=绿；连接出错=红；其它（初始/连接中）=橙 */
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

/** 服务器切换菜单 */
const serverMenuItems = computed<DropdownMenuItem[]>(() => {
  const items: DropdownMenuItem[] = servers.value.map((s) => ({
    key: `server:${s.id}`,
    label: s.name,
    icon: s.id === activeServerId.value ? IconLucidePlugZap : undefined,
    disabled: s.id === activeServerId.value,
  }));
  items.push({
    key: "manage",
    label: t("streaming.server.add"),
    icon: IconLucideCog,
    separator: true,
  });
  return items;
});

const handleServerMenu = async (key: string): Promise<void> => {
  if (key === "manage") {
    settingsDialog.show("streaming");
    return;
  }
  if (key.startsWith("server:")) {
    const id = key.slice("server:".length);
    if (id !== activeServerId.value) await streaming.setActiveServer(id);
  }
};

const goToSettings = (): void => {
  settingsDialog.show("streaming");
};

/** 重连当前激活服务器（未连接占位的"重新连接"按钮） */
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

/** 刷新当前 tab 数据；子页面通过 inject 监听该 key 触发自身 fetch */
const refreshKey = ref(0);
const handleRefresh = (): void => {
  refreshKey.value++;
};

provide("streamingRefreshKey", refreshKey);
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pb-2">
      <div class="flex items-center justify-between mt-2 mb-4 gap-4">
        <!-- 左：标题 + 数量统计 -->
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

        <!-- 右：服务器选择 + 刷新 -->
        <div v-if="activeServer" class="flex items-center gap-2 shrink-0">
          <SDropdownMenu :items="serverMenuItems" align="end" @select="handleServerMenu">
            <template #trigger>
              <button
                type="button"
                class="flex items-center gap-2 px-3 h-9 rounded-full bg-on-surface/4 hover:bg-on-surface/8 transition-colors text-sm cursor-pointer border-none outline-none"
              >
                <span class="size-2 rounded-full shrink-0" :class="dotClass" />
                <span class="truncate max-w-30 text-on-surface">{{ activeServer.name }}</span>
                <IconLucideChevronDown class="size-4 text-on-surface-variant/60 shrink-0" />
              </button>
            </template>
          </SDropdownMenu>
          <SButton variant="secondary" circle :disabled="!isConnected" @click="handleRefresh">
            <template #icon>
              <IconLucideRefreshCw :class="{ 'animate-spin': loading }" />
            </template>
          </SButton>
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

    <!-- 占位：已配置服务器但未连接 -->
    <div
      v-else-if="!isConnected"
      class="flex-1 flex items-center justify-center"
    >
      <div class="text-center text-on-surface-variant/60 max-w-md px-6">
        <IconLucideUnplug class="size-12 mx-auto mb-3 opacity-30" />
        <div class="text-sm mb-1">{{ t("streaming.empty.notConnected") }}</div>
        <div
          v-if="connectionStatus.error"
          class="text-xs mb-4 px-3 py-2 rounded-md bg-red-500/10 text-red-500 break-all"
        >
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

    <!-- 子路由（不用 keep-alive，每次切换重新挂载；store 缓存让 UI 不空白） -->
    <div v-else class="flex-1 min-h-0">
      <router-view />
    </div>
  </div>
</template>
