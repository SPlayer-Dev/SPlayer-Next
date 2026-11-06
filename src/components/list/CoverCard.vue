<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import artistFallback from "@/assets/images/artist.jpg";
import { captureCover } from "@/services/coverTransition";

export interface CoverCardProps {
  /** 卡片数据 */
  item: CoverItem;
  /** 类型：default / artist */
  type?: "default" | "artist";
  /** 封面圆角 class */
  rounded?: string;
  /** 封面占位图 */
  fallback?: string;
  /** 是否显示可点击的播放按钮 */
  playable?: boolean;
  /** 是否正在加载播放内容 */
  loading?: boolean;
}

const props = withDefaults(defineProps<CoverCardProps>(), {
  type: "default",
  rounded: "rounded-xl",
  playable: false,
  loading: false,
});

const emit = defineEmits<{ click: []; play: [] }>();

const { t } = useI18n();

/** 稳定的封面标识：页面重新挂载后仍能匹配，不能用组件实例 ID */
const coverKey = computed(() => `${props.type}:${props.item.id}`);

/** 记录封面后分发点击，由实际目标路由决定是否启用共享过渡 */
const handleClick = (): void => {
  captureCover(props.item, coverKey.value);
  emit("click");
};

/** 播放按钮：阻止冒泡，避免同时触发卡片跳转 */
const handlePlay = (): void => {
  emit("play");
};

const coverRounded = computed(() => (props.type === "artist" ? "rounded-full" : props.rounded));
const actualFallback = computed(() => (props.type === "artist" ? artistFallback : props.fallback));
</script>

<template>
  <div
    class="cursor-pointer group rounded-xl transition-colors duration-300"
    :class="type !== 'artist' ? 'hover:bg-primary/10' : ''"
    @click="handleClick"
  >
    <!-- 封面 -->
    <div class="relative overflow-hidden group-hover:will-change-transform" :class="coverRounded">
      <SImg
        :data-cover-key="coverKey"
        :src="item.cover"
        :fallback="actualFallback"
        :alt="item.title"
        class="cover-card-image w-full aspect-square transition-[transform,filter] duration-300 ease-out group-hover:scale-108 group-hover:brightness-80"
        :class="coverRounded"
      />
      <!-- 播放按钮 -->
      <button
        v-if="type !== 'artist' && playable"
        type="button"
        data-cover-action
        :aria-label="t('common.play')"
        :disabled="loading"
        class="absolute right-2 bottom-2 size-9 flex items-center justify-center rounded-full border-none bg-white/50 opacity-0 translate-y-1.5 transition-[opacity,transform,background-color] duration-300 cursor-pointer group-hover:opacity-100 group-hover:translate-y-0 hover:bg-white/75 focus-visible:opacity-100 focus-visible:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        :class="loading ? 'opacity-100 translate-y-0' : ''"
        @click.stop="handlePlay"
      >
        <SLoading v-if="loading" class="size-4 text-white" />
        <IconLucidePlay v-else class="size-4.5 text-white" />
      </button>
      <!-- 歌手头像角标 -->
      <div
        v-else-if="type === 'artist'"
        data-cover-action
        class="absolute inset-0 m-auto size-9 flex items-center justify-center rounded-full opacity-0 transition-[opacity,transform] duration-300 group-hover:opacity-100"
      >
        <IconLucideUser class="size-8 text-white" />
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

<style scoped>
[data-cover-shared] {
  transform: none !important;
  filter: none !important;
  transition: none;
}

[data-cover-shared] + [data-cover-action] {
  opacity: 0 !important;
  transition: none;
}
</style>
