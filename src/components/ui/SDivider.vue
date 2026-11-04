<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 方向 */
    vertical?: boolean;
    /** 封面取色主题 */
    cover?: boolean;
  }>(),
  { vertical: false },
);
</script>

<template>
  <div
    role="separator"
    class="transition-background-color duration-300"
    :class="[vertical ? 'w-px h-4' : 'h-px', cover ? 'bg-cover/15' : 'bg-on-surface/10']"
  />
</template>
