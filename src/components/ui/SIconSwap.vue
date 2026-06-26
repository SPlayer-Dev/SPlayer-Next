<script setup lang="ts">
defineProps<{
  /** 为真显示 on 槽图标，否则显示 off 槽 */
  active: boolean;
}>();
</script>

<template>
  <span class="relative inline-flex items-center justify-center">
    <span
      class="s-icon-swap absolute inset-0 inline-flex items-center justify-center *:size-full"
      :class="{ 's-icon-swap-hidden': !active }"
    >
      <slot name="on" />
    </span>
    <span
      class="s-icon-swap absolute inset-0 inline-flex items-center justify-center *:size-full"
      :class="{ 's-icon-swap-hidden': active }"
    >
      <slot name="off" />
    </span>
  </span>
</template>

<style scoped>
.s-icon-swap {
  transition:
    opacity 0.3s cubic-bezier(0.2, 0, 0, 1),
    transform 0.3s cubic-bezier(0.2, 0, 0, 1);
}

.s-icon-swap-hidden {
  opacity: 0;
  transform: scale(0.25);
  pointer-events: none;
}
</style>
