<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import artistFallback from "@/assets/images/artist.jpg";

export interface CoverListProps {
  /** 列表数据 */
  items: CoverItem[];
  /** 列表类型 */
  type?: "default" | "artist";
  /** 单项最小宽度（px） */
  minSize?: number;
  /** 项间距（px） */
  gap?: number;
  /** 封面圆角 class */
  rounded?: string;
  /** 封面占位图 */
  fallback?: string;
}

const props = withDefaults(defineProps<CoverListProps>(), {
  type: "default",
  minSize: 140,
  gap: 20,
  rounded: "rounded-xl",
});

const coverRounded = computed(() => {
  if (props.type === "artist") return "rounded-full";
  return props.rounded;
});

const actualFallback = computed(() => {
  if (props.type === "artist") return artistFallback;
  return props.fallback;
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
      class="cursor-pointer group rounded-xl transition-colors duration-300"
      :class="type !== 'artist' ? 'hover:bg-primary/10' : ''"
      @click="emit('click', item)"
    >
      <!-- 封面 -->
      <div class="relative overflow-hidden group-hover:will-change-transform" :class="coverRounded">
        <SImg
          :src="item.cover"
          :fallback="actualFallback"
          :alt="item.title"
          class="w-full aspect-square transition-[transform,filter] duration-300 ease-out group-hover:scale-108 group-hover:brightness-80"
        />
        <!-- 播放按钮 -->
        <div
          class="absolute size-9 flex items-center justify-center rounded-full opacity-0 transition-[opacity,transform] duration-300 group-hover:opacity-100"
          :class="
            type === 'artist'
              ? 'inset-0 m-auto'
              : 'right-2 bottom-2 bg-white/50 translate-y-1.5 group-hover:translate-y-0'
          "
        >
          <IconLucidePlay v-if="type !== 'artist'" class="size-4.5 text-white" />
          <IconLucideUser v-else class="size-8 text-white" />
        </div>
      </div>
      <!-- 信息 -->
      <div class="flex flex-col gap-0.5 px-2.5 py-2.5" :class="type === 'artist' ? 'items-center' : ''">
        <div
          class="text-sm text-on-surface line-clamp-2 leading-snug"
          :class="type === 'artist' ? 'text-center w-full' : ''"
        >
          {{ item.title }}
        </div>
        <div
          v-if="item.subtitle"
          class="text-xs text-on-surface-variant/50 truncate"
          :class="type === 'artist' ? 'text-center w-full' : ''"
        >
          {{ item.subtitle }}
        </div>
      </div>
    </div>
  </div>
</template>
