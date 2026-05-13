<script setup lang="ts">
defineProps<{
  collapsed: boolean;
}>();
</script>

<template>
  <RouterLink
    to="/"
    class="flex items-center justify-center h-16 shrink-0 px-4 no-underline cursor-pointer transition-transform duration-300 hover:scale-105 active:scale-100"
  >
    <SLogo :size="30" class="shrink-0" />
    <span
      class="text-[22px] text-primary mt-0.5 leading-10 overflow-hidden whitespace-nowrap font-logo transition-[width,opacity,margin] duration-300"
      :class="collapsed ? 'w-0 opacity-0 ml-0' : 'w-[90px] ml-2'"
    >
      SPlayer
    </span>
  </RouterLink>
</template>
