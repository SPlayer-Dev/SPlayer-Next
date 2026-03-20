<script setup lang="ts">
import { useStatusStore } from "@/stores/status";

const status = useStatusStore();

/** 非 idle 状态时显示播放栏 */
const showPlayerBar = computed(() => status.state !== "idle");
</script>

<template>
  <div class="h-screen flex bg-surface text-on-surface">
    <!-- 侧边栏 -->
    <aside
      class="w-60 shrink-0 border-r-1 border-r-solid border-r-primary/10 bg-on-surface/4 overflow-y-auto scroll-trim"
      :class="showPlayerBar ? 'pb-18' : ''"
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
      <main
        class="flex-1 overflow-y-auto scroll-trim"
        :class="showPlayerBar ? 'pb-18' : ''"
      >
        <RouterView />
      </main>
    </div>

    <!-- 底部播放栏 — 固定定位，transform 动画 -->
    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      leave-active-class="transition-transform duration-300 ease-in"
      enter-from-class="translate-y-full"
      leave-to-class="translate-y-full"
    >
      <footer
        v-if="showPlayerBar"
        class="fixed bottom-0 left-0 right-0 h-18 border-t-1 border-t-solid border-t-primary/10 bg-surface/80 backdrop-blur-lg z-50"
      >
        <PlayerBar />
      </footer>
    </Transition>
  </div>
</template>
