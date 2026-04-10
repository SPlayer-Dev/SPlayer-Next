<script setup lang="ts">
import type { CoverItem } from "@/types/artist";

export interface CoverListProps {
  /** 列表数据 */
  items: CoverItem[];
  /** 单项最小宽度（px） */
  minSize?: number;
  /** 项间距（px） */
  gap?: number;
  /** 封面圆角 class */
  rounded?: string;
  /** 封面占位图 */
  fallback?: string;
}

withDefaults(defineProps<CoverListProps>(), {
  minSize: 140,
  gap: 16,
  rounded: "rounded-xl",
});

const emit = defineEmits<{
  click: [item: CoverItem];
}>();
</script>

<template>
  <div
    class="grid"
    :style="{
      gridTemplateColumns: `repeat(auto-fill, minmax(${minSize}px, 1fr))`,
      gap: `${gap}px`,
    }"
  >
    <div
      v-for="item in items"
      :key="item.id"
      class="cursor-pointer group rounded-xl transition-colors duration-300 hover:bg-primary/10"
      @click="emit('click', item)"
    >
      <!-- 封面 -->
      <div class="relative overflow-hidden will-change-transform" :class="rounded">
        <SImg
          :src="item.cover"
          :fallback="fallback"
          :alt="item.title"
          class="w-full aspect-square transition-[transform,filter] duration-300 ease-out will-change-transform group-hover:scale-108 group-hover:brightness-80"
        />
        <!-- 播放按钮 -->
        <div
          class="absolute right-2 bottom-2 size-9 flex items-center justify-center rounded-full bg-white/50 opacity-0 translate-y-1.5 transition-[opacity,transform] duration-300 group-hover:opacity-100 group-hover:translate-y-0"
        >
          <IconLucidePlay class="size-4.5 text-white" />
        </div>
      </div>
      <!-- 信息 -->
      <div class="flex flex-col gap-0.5 px-2.5 py-2.5">
        <div class="text-sm text-on-surface line-clamp-2 leading-snug">
          {{ item.title }}
        </div>
        <div v-if="item.subtitle" class="text-xs text-on-surface-variant/50">
          {{ item.subtitle }}
        </div>
      </div>
    </div>
  </div>
</template>
