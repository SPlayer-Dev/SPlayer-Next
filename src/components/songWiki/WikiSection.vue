<script setup lang="ts">
defineProps<{
  /** 区块标题 */
  title: string;
}>();
</script>

<template>
  <section class="flex flex-col gap-3">
    <h2 class="flex items-center gap-2 text-lg font-semibold text-on-surface">
      <span class="h-4 w-1 shrink-0 rounded-full bg-primary" />
      {{ title }}
    </h2>
    <slot />
  </section>
</template>
