<script setup lang="ts">
import { useWindowControls } from "@/composables/useWindowControls";
import IconMinus from "~icons/lucide/minus";
import IconSquare from "~icons/lucide/square";
import IconCopy from "~icons/lucide/copy";
import IconX from "~icons/lucide/x";

defineProps<{
  /** 使用 cover 主题色（全屏播放器等沉浸场景） */
  cover?: boolean;
}>();

const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();
</script>

<template>
  <div class="flex items-center gap-3 shrink-0">
    <SButton
      class="app-no-drag"
      :type="cover ? 'cover' : undefined"
      :variant="cover ? 'ghost' : 'tertiary'"
      circle
      :size="40"
      :icon-size="16"
      @click="minimize"
    >
      <template #icon><IconMinus /></template>
    </SButton>
    <SButton
      class="app-no-drag"
      :type="cover ? 'cover' : undefined"
      :variant="cover ? 'ghost' : 'tertiary'"
      circle
      :size="40"
      :icon-size="16"
      @click="toggleMaximize"
    >
      <template #icon>
        <component :is="isMaximized ? IconCopy : IconSquare" />
      </template>
    </SButton>
    <SButton
      class="app-no-drag"
      :type="cover ? 'cover' : undefined"
      :variant="cover ? 'ghost' : 'tertiary'"
      circle
      :size="40"
      @click="close"
    >
      <template #icon><IconX /></template>
    </SButton>
  </div>
</template>
