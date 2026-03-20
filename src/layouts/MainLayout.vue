<script setup lang="ts">
// TODO: 从 status store 读取播放栏是否显示
const showPlayerBar = ref(true);
</script>

<template>
  <div
    class="h-screen grid grid-cols-[auto_1fr] grid-rows-[auto_1fr_auto] bg-surface text-on-surface"
  >
    <!-- 侧边栏 -->
    <aside
      class="row-span-full w-60 border-r-1 border-r-solid border-r-primary/10 bg-on-surface/4 overflow-y-auto"
    >
      <SideBar />
    </aside>

    <!-- 顶部导航 -->
    <header class="h-14 flex items-center px-4 border-b border-primary/10">
      <NavHeader />
    </header>

    <!-- 主内容区 -->
    <main class="overflow-y-auto">
      <RouterView />
    </main>

    <!-- 底部播放栏 -->
    <footer
      v-if="showPlayerBar"
      class="col-span-full h-18 border-t-1 border-t-solid border-t-primary/10 bg-on-surface/4"
    >
      <PlayerBar />
    </footer>
  </div>
</template>
