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
const { isExpanded } = storeToRefs(status);
const { appearance } = settings;

/** 路由切换动效 */
const routeTransitionName = computed(() => {
  const transition = appearance.routeTransition;
  return transition === "none" ? "" : `route-${transition}`;
});

/**
 * 顶级路由组件的 key：
 * - 路由链含 :param（如 /collection/:source/:type/:id）→ 按 fullPath，让参数变化触发重建
 * - 全静态路由（如 /streaming/songs）→ 按顶级 children path，让嵌套子路由切换时外层不重建
 */
const route = useRoute();
const routeKey = computed(() => {
  const hasParam = route.matched.some((m) => m.path.includes(":"));
  return hasParam ? route.fullPath : (route.matched[1]?.path ?? route.fullPath);
});

/** 侧边栏样式 */
const sidebarClass = computed(() => {
  const classes: string[] = [];
  if (appearance.layoutMode === "floating") {
    classes.push("ml-3 mt-3 mb-3 rounded-xl border border-solid border-primary/10");
  } else {
    classes.push("border-r border-r-solid border-r-primary/10");
    if (showPlayerBar.value && appearance.layoutMode === "default") classes.push("mb-20");
  }
  return classes.join(" ");
});

/** 主界面底部边距 */
const mainMarginClass = computed(() =>
  showPlayerBar.value && appearance.layoutMode !== "floating" ? "mb-20" : "",
);

/** 外层播放条样式 */
const playerBarWrapperClass = computed(() => {
  const base = "fixed bottom-0 z-50 transition-[left] duration-300 pointer-events-none";
  const collapsed = appearance.sidebarCollapsed;
  switch (appearance.layoutMode) {
    case "sidebar-full":
      return `${base} ${collapsed ? "left-16" : "left-60"} right-0`;
    case "floating":
      return `${base} ${collapsed ? "left-[76px]" : "left-[252px]"} right-0 px-4 pb-6`;
    default:
      return `${base} left-0 right-0`;
  }
});

/** 内层播放条样式 */
const playerBarInnerClass = computed(() => {
  // 禁用底部播放栏交互
  const base = isExpanded.value ? "pointer-events-none" : "pointer-events-auto";
  switch (appearance.layoutMode) {
    case "floating":
      return `${base} mx-auto max-w-4xl glass-panel rounded-full shadow-xl border border-solid border-primary/10`;
    default:
      return `${base} h-20 bg-surface-panel border-t border-t-solid border-t-primary/10`;
  }
});
</script>

<template>
  <!-- 主界面 -->
  <div
    class="h-screen flex bg-app text-on-surface transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.7,0,0.3,1)] origin-center"
    :class="isExpanded ? 'scale-95 opacity-0 pointer-events-none' : ''"
  >
    <!-- 侧边栏 -->
    <aside
      class="shrink-0 bg-surface-panel overflow-y-auto z-10 transition-[width,margin] duration-300"
      :class="[appearance.sidebarCollapsed ? 'w-16' : 'w-60', sidebarClass]"
    >
      <SideBar />
    </aside>

    <!-- 右侧主区域 -->
    <div class="flex-1 flex flex-col min-w-0" :class="mainMarginClass">
      <!-- 顶部导航 -->
      <header class="h-16 shrink-0 flex items-center px-3">
        <NavHeader />
      </header>

      <!-- 主内容区 -->
      <main class="flex-1 overflow-y-auto overflow-x-hidden">
        <RouterView v-slot="{ Component }">
          <Transition :name="routeTransitionName" mode="out-in">
            <component :is="Component" :key="routeKey" />
          </Transition>
        </RouterView>
      </main>
    </div>
  </div>

  <!-- 底部播放栏 -->
  <Transition
    enter-active-class="transition-transform duration-300 ease-out"
    leave-active-class="transition-transform duration-300 ease-in"
    enter-from-class="translate-y-full"
    leave-to-class="translate-y-full"
  >
    <div v-if="showPlayerBar" :class="playerBarWrapperClass">
      <footer :class="playerBarInnerClass">
        <PlayerBar />
      </footer>
    </div>
  </Transition>

  <!-- Toast -->
  <SToast :max="5" />
  <!-- Dialog -->
  <SDialogProvider />
  <!-- 全屏播放器 -->
  <FullPlayer />
  <!-- 播放列表抽屉 -->
  <SDrawer v-model:open="status.playlistOpen" :cover="status.isExpanded" width="380px">
    <template #header>
      <div class="flex flex-col">
        <span class="text-base font-semibold">{{ t("playlist.title") }}</span>
        <span
          class="text-xs"
          :class="status.isExpanded ? 'text-cover/50' : 'text-on-surface-variant'"
        >
          {{ t("common.totalSongs", { count: queueLength }) }}
        </span>
      </div>
    </template>
    <PlaylistPanel :cover="status.isExpanded" />
  </SDrawer>
  <!-- 全局设置 -->
  <SettingsDialog />
</template>
