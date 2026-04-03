<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { queueLength } from "@/stores/queue";

const { t } = useI18n();
const status = useStatusStore();
const settings = useSettingsStore();

/** 有歌曲信息时显示播放栏 */
const showPlayerBar = computed(() => !!useMediaStore().track);
const { isExpanded, sidebarCollapsed } = storeToRefs(status);
const layoutMode = computed(() => settings.player.layoutMode);

/** 路由切换动效 */
const routeTransitionName = computed(() => {
  const transition = settings.player.routeTransition;
  return transition === "none" ? "" : `route-${transition}`;
});

/** 侧边栏：仅 default 模式在有播放栏时加底部间距 */
const sidebarClass = computed(() => {
  if (showPlayerBar.value && layoutMode.value === "default") return "mb-20";
  return "";
});

/** 主内容区底部间距 */
const mainPaddingClass = computed(() => {
  if (!showPlayerBar.value) return "";
  if (layoutMode.value === "floating") return "pb-24";
  return "pb-20";
});

/** 播放栏样式 */
const playerBarClass = computed(() => {
  const base = "fixed bottom-0 h-20 bg-surface-panel/90 backdrop-blur-lg z-50 overflow-visible transition-[left] duration-300";
  switch (layoutMode.value) {
    case "sidebar-full":
      return `${base} ${sidebarCollapsed.value ? "left-16" : "left-60"} right-0 border-t border-t-solid border-t-primary/10`;
    case "floating":
      return `${base} left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-4xl rounded-2xl mb-2 shadow-lg border border-solid border-primary/10`;
    default:
      return `${base} left-0 right-0 border-t border-t-solid border-t-primary/10`;
  }
});
</script>

<template>
  <!-- 主界面 -->
  <div
    class="h-screen flex bg-surface text-on-surface transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.7,0,0.3,1)] origin-center"
    :class="isExpanded ? 'scale-95 opacity-0 pointer-events-none' : ''"
  >
    <!-- 侧边栏 -->
    <aside
      class="shrink-0 border-r border-r-solid border-r-primary/10 bg-surface-panel/90 backdrop-blur-lg overflow-y-auto scroll-trim z-10 transition-[width,margin] duration-300"
      :class="[sidebarCollapsed ? 'w-16' : 'w-60', sidebarClass]"
    >
      <SideBar />
    </aside>

    <!-- 右侧主区域 -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- 顶部导航 -->
      <header class="h-16 shrink-0 flex items-center px-3">
        <NavHeader />
      </header>

      <!-- 主内容区 -->
      <main class="flex-1 overflow-y-auto scroll-trim" :class="mainPaddingClass">
        <RouterView v-slot="{ Component }">
          <Transition :name="routeTransitionName" mode="out-in">
            <KeepAlive :max="5">
              <component :is="Component" :key="$route.path" />
            </KeepAlive>
          </Transition>
        </RouterView>
      </main>
    </div>

    <!-- 底部播放栏 -->
    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      leave-active-class="transition-transform duration-300 ease-in"
      enter-from-class="translate-y-full"
      leave-to-class="translate-y-full"
    >
      <footer v-if="showPlayerBar" :class="playerBarClass">
        <PlayerBar />
      </footer>
    </Transition>
    <!-- Toast -->
    <SToast :max="5" />
  </div>
  <!-- 全屏播放器 -->
  <FullPlayer />
  <!-- 播放列表抽屉 -->
  <SDrawer v-model:open="status.playlistOpen" :cover="status.isExpanded" width="380px">
    <template #header>
      <div class="flex flex-col">
        <span class="text-base font-semibold">{{ t("playlist.title") }}</span>
        <span class="text-xs" :class="status.isExpanded ? 'text-cover/50' : 'text-on-surface-variant'">
          {{ t("playlist.totalSongs", { count: queueLength }) }}
        </span>
      </div>
    </template>
    <PlaylistPanel :cover="status.isExpanded" />
  </SDrawer>
  <!-- 全局设置 -->
  <SettingsDialog />
</template>
