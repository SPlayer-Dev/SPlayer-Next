<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useOrpheusProtocol } from "@/composables/useOrpheusProtocol";
import { useExternalFileHandler } from "@/composables/useExternalFileHandler";

const route = useRoute();
const status = useStatusStore();
const settings = useSettingsStore();

// 接入 orpheus 协议唤起与外部音频文件播放
useOrpheusProtocol();
useExternalFileHandler();

/** 有歌曲信息时显示播放栏 */
const showPlayerBar = computed(() => !!useMediaStore().track);
const { isPlayerExpanded } = storeToRefs(status);
const { appearance } = settings;

/** 路由切换动效 */
const routeTransitionName = computed(() => {
  const transition = appearance.routeTransition;
  return transition === "none" ? "" : `route-${transition}`;
});

/** 路由 key */
const routeKey = computed(() => {
  const hasParam = route.matched.some((m) => m.path.includes(":"));
  return hasParam ? route.path : (route.matched[1]?.path ?? route.path);
});

/** 需要受控缓存的页面组件白名单 */
const cachedViews = [
  "Home",
  "Library",
  "Liked",
  "History",
  "Download",
  "Daily",
  "Favorites",
  "Cloud",
  "LocalList",
  "Folders",
  "SearchPage",
  "Stats",
  "StreamingIndex",
];

const mainContainerRef = shallowRef<HTMLElement | null>(null);
const mainScrollMap = new Map<string, number>();

// 路由离开前记录滚动位置
watch(
  () => route.fullPath,
  (_newPath, oldPath) => {
    if (oldPath && mainContainerRef.value) {
      mainScrollMap.set(oldPath, mainContainerRef.value.scrollTop);
    }
  },
);

// 路由切换完成后恢复滚动位置
const handleAfterEnter = (): void => {
  if (!mainContainerRef.value) return;
  const saved = mainScrollMap.get(route.fullPath) ?? 0;
  mainContainerRef.value.scrollTop = saved;
};

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
  const base = isPlayerExpanded.value ? "pointer-events-none" : "pointer-events-auto";
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
    class="h-screen flex overflow-hidden bg-app text-on-surface transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.7,0,0.3,1)] origin-center"
    :class="isPlayerExpanded ? 'scale-95 opacity-0 pointer-events-none' : ''"
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
      <main ref="mainContainerRef" class="flex-1 overflow-y-auto overflow-x-hidden">
        <RouterView v-slot="{ Component }">
          <Transition :name="routeTransitionName" mode="out-in" @after-enter="handleAfterEnter">
            <KeepAlive :max="10" :include="cachedViews">
              <component :is="Component" :key="routeKey" />
            </KeepAlive>
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
  <SToast :max="1" />
  <!-- 性能监视器 -->
  <SPerformanceMonitor v-if="appearance.showPerformanceMonitor" />
  <!-- Dialog -->
  <SDialogProvider />
  <!-- 全屏播放器 -->
  <FullPlayer />
  <!-- 全局设置 -->
  <SettingsDialog />
  <!-- 更新弹窗 -->
  <UpdateDialog />
  <!-- 评论弹窗 -->
  <MusicCommentsDialog />
</template>
