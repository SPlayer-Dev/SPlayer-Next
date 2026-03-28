<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";

const status = useStatusStore();

/** 有歌曲信息时显示播放栏 */
const showPlayerBar = computed(() => !!useMediaStore().track);
const { isExpanded } = storeToRefs(status);
</script>

<template>
  <!-- 主界面：展开时缩小淡出 -->
  <div
    class="h-screen flex bg-surface text-on-surface transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.7,0,0.3,1)] origin-center"
    :class="isExpanded ? 'scale-95 opacity-0 pointer-events-none' : ''"
  >
    <!-- 侧边栏 -->
    <aside
      class="w-60 shrink-0 border-r-1 border-r-solid border-r-primary/10 bg-surface-panel/90 backdrop-blur-lg overflow-y-auto scroll-trim z-10 transition-[margin] duration-300"
      :class="showPlayerBar ? 'mb-20' : ''"
    >
      <SideBar />
    </aside>

    <!-- 右侧主区域 -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- 顶部导航 -->
      <header class="h-14 shrink-0 flex items-center px-4 border-b border-primary/10">
        <NavHeader />
      </header>

      <!-- 主内容区 -->
      <main class="flex-1 overflow-y-auto scroll-trim" :class="showPlayerBar ? 'pb-20' : ''">
        <RouterView />
      </main>
    </div>

    <!-- 底部播放栏 -->
    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      leave-active-class="transition-transform duration-300 ease-in"
      enter-from-class="translate-y-full"
      leave-to-class="translate-y-full"
    >
      <footer
        v-if="showPlayerBar"
        class="fixed bottom-0 left-0 right-0 h-20 border-t-1 border-t-solid border-t-primary/10 bg-surface-panel/90 backdrop-blur-lg z-50 overflow-visible"
      >
        <PlayerBar />
      </footer>
    </Transition>

    <!-- 全局 Toast -->
    <SToast :max="5" />
  </div>

  <!-- 全屏播放器：Teleport 到 body，独立层级 -->
  <FullscreenPlayer />
</template>
