<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import artistFallback from "@/assets/images/artist.jpg";

export interface CoverCardProps {
  /** 卡片数据 */
  item: CoverItem;
  /** 类型：default / artist */
  type?: "default" | "artist";
  /** 封面圆角 class */
  rounded?: string;
  /** 封面占位图 */
  fallback?: string;
  /** 封面上的播放按钮是否可点击（未开启时仅作为悬浮装饰） */
  playable?: boolean;
}

const props = withDefaults(defineProps<CoverCardProps>(), {
  type: "default",
  rounded: "rounded-xl",
  playable: false,
});

const emit = defineEmits<{ click: []; play: [] }>();

/** 播放按钮是否可交互：歌手卡片中间是头像占位图，不做播放入口 */
const canPlay = computed(() => props.playable && props.type !== "artist");

/** 点击封面上的播放按钮：不触发卡片跳转 */
const handlePlay = (event: MouseEvent): void => {
  if (!canPlay.value) return;
  event.stopPropagation();
  emit("play");
};

const { t } = useI18n();

const coverRounded = computed(() => (props.type === "artist" ? "rounded-full" : props.rounded));
const actualFallback = computed(() => (props.type === "artist" ? artistFallback : props.fallback));
</script>

<template>
  <div
    class="cursor-pointer group rounded-xl transition-colors duration-300"
    :class="type !== 'artist' ? 'hover:bg-primary/10' : ''"
    @click="$emit('click')"
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
        class="absolute size-9 flex items-center justify-center rounded-full opacity-0 transition-[opacity,transform,background-color] duration-300 group-hover:opacity-100"
        :class="[
          type === 'artist'
            ? 'inset-0 m-auto'
            : 'right-2 bottom-2 bg-white/50 translate-y-1.5 group-hover:translate-y-0',
          canPlay ? 'hover:bg-white/75 hover:scale-105' : '',
        ]"
        :role="canPlay ? 'button' : undefined"
        :aria-label="canPlay ? t('songList.context.play') : undefined"
        @click="handlePlay"
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
