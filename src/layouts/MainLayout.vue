<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useOrpheusProtocol } from "@/composables/useOrpheusProtocol";
import { useExternalFileHandler } from "@/composables/useExternalFileHandler";
import { useResponsiveLayout } from "@/composables/useResponsiveLayout";
import { coverTransitionActive, installCoverTransitions } from "@/services/coverTransition";
import {
  fullPlayerReady,
  playerTransitionActive,
  cancelPlayerTransition,
} from "@/services/playerTransition";

const route = useRoute();
const router = useRouter();
const status = useStatusStore();
const settings = useSettingsStore();
const { sidebarCollapsed } = useResponsiveLayout();

// 接入 orpheus 协议唤起与外部音频文件播放
useOrpheusProtocol();
useExternalFileHandler();

/** 有歌曲信息时显示播放栏 */
const showPlayerBar = computed(() => !!useMediaStore().track);
const { isPlayerExpanded } = storeToRefs(status);

/** 播放页展开状态同步与懒加载 */
const FullPlayer = defineAsyncComponent(() => import("@/components/player/FullPlayer/index.vue"));
const fullPlayerLoaded = ref(isPlayerExpanded.value);
watch(
  isPlayerExpanded,
  (expanded) => {
    if (expanded) fullPlayerLoaded.value = true;
    window.api.window.setPlayerExpanded(expanded);
  },
  { immediate: true },
);

const { appearance } = settings;

/** 路由切换动效 */
const routeTransitionName = computed(() => {
  const transition = appearance.routeTransition;
  return transition === "none" ? "" : `route-${transition}`;
});

/** 详情按路径和服务器隔离实例，列表沿用父路由缓存 */
const routeKey = computed(() => {
  const hasParam = route.matched.some((m) => m.path.includes(":"));
  return hasParam
    ? `${route.path}:${route.query.serverId ?? ""}`
    : (route.matched[1]?.path ?? route.path);
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
      if (mainScrollMap.size > 10) {
        mainScrollMap.delete(mainScrollMap.keys().next().value!);
      }
    }
  },
);

/** 路由切换完成后恢复主内容区滚动位置 */
const handleAfterEnter = (): void => {
  if (!mainContainerRef.value) return;
  const saved = mainScrollMap.get(route.fullPath) ?? 0;
  mainContainerRef.value.scrollTop = saved;
};

let disposeCoverTransitions: (() => void) | undefined;
watch(
  () => appearance.seamlessTransition && !settings.reducedMotion,
  (enabled) => {
    if (!enabled) cancelPlayerTransition();
    disposeCoverTransitions?.();
    disposeCoverTransitions = enabled
      ? installCoverTransitions(router, () => mainContainerRef.value, handleAfterEnter)
      : undefined;
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  window.api.window.setPlayerExpanded(false);
  disposeCoverTransitions?.();
  cancelPlayerTransition();
  fullPlayerReady.value = false;
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
  const collapsed = sidebarCollapsed.value;
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
    class="player-shell h-screen flex overflow-hidden bg-app text-on-surface transition-[transform,opacity] duration-360 ease-[cubic-bezier(0.25,1,0.35,1)] origin-center"
    :style="playerTransitionActive ? { transition: 'none' } : undefined"
    :class="isPlayerExpanded && fullPlayerReady ? 'scale-95 opacity-0 pointer-events-none' : ''"
  >
    <!-- 侧边栏 -->
    <aside
      class="shrink-0 bg-surface-panel overflow-y-auto z-10 transition-[width,margin] duration-300"
      :class="[sidebarCollapsed ? 'w-16' : 'w-60', sidebarClass]"
    >
      <SideBar />
    </aside>

    <!-- 右侧主区域 -->
    <div class="flex-1 flex flex-col min-w-0 min-h-0" :class="mainMarginClass">
      <!-- 顶部导航 -->
      <header class="h-16 shrink-0 flex items-center px-3">
        <NavHeader />
      </header>

      <!-- 主内容区 -->
      <main ref="mainContainerRef" class="flex-1 overflow-y-auto overflow-x-hidden">
        <RouterView v-slot="{ Component }">
          <Transition
            :name="routeTransitionName"
            :css="!coverTransitionActive"
            :mode="coverTransitionActive ? undefined : 'out-in'"
            @after-enter="handleAfterEnter"
          >
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
  <FullPlayer v-if="fullPlayerLoaded" @vue:mounted="fullPlayerReady = true" />
  <!-- 全局设置 -->
  <SettingsDialog />
  <!-- 更新弹窗 -->
  <UpdateDialog />
  <!-- 评论弹窗 -->
  <MusicCommentsDialog />
  <!-- 输出信息弹窗 -->
  <AudioInfoDialog />
</template>

<style>
html[data-cover-transition] {
  [data-cover-shared] {
    view-transition-name: detail-cover;
  }

  &::view-transition-group(detail-cover) {
    animation-duration: 260ms;
    animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
    overflow: clip;
    border-radius: var(--cover-transition-radius);
  }

  &::view-transition-old(detail-cover),
  &::view-transition-new(detail-cover) {
    height: 100%;
    object-fit: cover;
  }

  &::view-transition-old(root),
  &::view-transition-new(root) {
    animation: none;
  }
}

html[data-player-transition] {
  [data-player-shared] {
    view-transition-name: player-cover;
  }

  [data-player-cover-overlay] {
    visibility: hidden;
  }

  [data-player-cover="full"] {
    box-shadow: none;
  }

  &::view-transition-image-pair(player-cover) {
    overflow: clip;
  }

  &::view-transition-old(player-cover),
  &::view-transition-new(player-cover) {
    height: 100%;
    object-fit: cover;
  }
}

html[data-player-transition="expand"] {
  &::view-transition-group(*) {
    animation-duration: 360ms;
    animation-timing-function: cubic-bezier(0.25, 1, 0.35, 1);
  }

  &::view-transition-image-pair(player-cover) {
    animation: player-cover-radius 360ms cubic-bezier(0.25, 1, 0.35, 1) both;
  }
}

html[data-player-transition="collapse"] {
  &::view-transition-group(*) {
    animation-duration: 340ms;
    animation-timing-function: cubic-bezier(0.2, 0.9, 0.3, 1);
  }

  &::view-transition-image-pair(player-cover) {
    animation: player-cover-radius 340ms cubic-bezier(0.2, 0.9, 0.3, 1) both;
  }
}

@keyframes player-cover-radius {
  from {
    border-radius: var(--player-cover-from-radius);
  }
  to {
    border-radius: var(--player-cover-to-radius);
  }
}
</style>
