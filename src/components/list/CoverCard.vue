<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import artistFallback from "@/assets/images/artist.jpg";
import { formatPlayCount } from "@/utils/format/playCount";

export interface CoverCardProps {
  /** 卡片数据 */
  item: CoverItem;
  /** 类型：default / artist */
  type?: "default" | "artist";
  /** 封面圆角 class */
  rounded?: string;
  /** 封面占位图 */
  fallback?: string;
}

const props = withDefaults(defineProps<CoverCardProps>(), {
  type: "default",
  rounded: "rounded-xl",
});

const { locale } = useI18n();

defineEmits<{ click: [] }>();

const coverRounded = computed(() => (props.type === "artist" ? "rounded-full" : props.rounded));
const actualFallback = computed(() => (props.type === "artist" ? artistFallback : props.fallback));
const showPlayBadge = computed(() => (props.item.playCount ?? 0) > 0);
const displayPlayCount = computed(() =>
  props.item.playCount != null ? formatPlayCount(props.item.playCount, locale.value) : "",
);
</script>

<template>
  <div
    class="cursor-pointer group rounded-xl transition-colors duration-300 relative"
    :class="type !== 'artist' ? 'hover:bg-primary/10' : ''"
    @click="$emit('click')"
  >
    <!-- 播放次数徽标（放在 SImg 外面，避免 overflow-hidden 裁剪） -->
    <div
      v-if="showPlayBadge"
      class="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg bg-black/60 px-1.5 py-1 pointer-events-none"
    >
      <IconLucidePlay class="size-3 fill-current text-white" />
      <span class="text-xs font-medium text-white tabular-nums">
        {{ displayPlayCount }}
      </span>
    </div>
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
    <div
      class="flex flex-col gap-0.5 px-2.5 py-2.5"
      :class="type === 'artist' ? 'items-center' : ''"
    >
      <div
        class="text-sm text-on-surface line-clamp-2 leading-snug text-pretty"
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
</template>
