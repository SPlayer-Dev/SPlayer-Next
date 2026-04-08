<script setup lang="ts">
defineProps<{
  /** 标签文本 */
  label: string;
  /** 描述文本 */
  description?: string;
}>();
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label class="text-sm text-on-surface ml-1">{{ label }}</label>
    <slot />
    <span v-if="description" class="text-xs text-on-surface-variant/50">{{ description }}</span>
  </div>
</template>
