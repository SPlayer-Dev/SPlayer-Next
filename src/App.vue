<script setup lang="ts">
import { useStatusStore } from "./stores/status";
import { useMediaStore } from "./stores/media";
import { useThemeStore } from "./stores/theme";
import type { ThemeSource } from "./types/theme";

const status = useStatusStore();
const media = useMediaStore();
const theme = useThemeStore();

const { state, position, duration, volume, error, isPlaying, isLoading, progress } =
  storeToRefs(status);

/** 网络地址输入 */
const urlInput = ref("");

/** 封面图片元素 */
const coverImg = ref<HTMLImageElement>();

/** 封面缩略图 URL */
const coverUrl = computed(() => media.track?.cover ?? null);

/** 歌手名拼接 */
const artistName = computed(() => media.track?.artists.map((a) => a.name).join(" / ") ?? "");

/** 当前使用的歌词 */
const currentLyric = computed(() => {
  const det = media.detail;
  const active = media.activeLyric;
  if (!det || !active) return null;
  if (active.type === "external") {
    const lyric = det.externalLyrics.find((l) => l.format === active.format);
    return lyric ? { format: lyric.format, content: lyric.content } : null;
  }
  if (active.type === "embedded" && det.embeddedLyric) {
    return { format: "embedded" as const, content: det.embeddedLyric };
  }
  return null;
});

/** 从网络地址加载 */
const loadFromUrl = async (): Promise<void> => {
  const url = urlInput.value.trim();
  if (!url) return;
  await status.load(url);
};

/** 打开本地文件对话框并加载 */
const loadFromFile = async (): Promise<void> => {
  const result = await window.api.player.openFile();
  if (!result.success || !result.data) return;
  await status.load(result.data);
};

/** 切换播放/暂停 */
const togglePlay = (): void => {
  if (isPlaying.value) {
    status.pause();
  } else {
    status.play();
  }
};

/** 主题模式显示 */
const modeLabel: Record<string, string> = { light: "浅色", dark: "深色", system: "系统" };

/** 主题类型选项 */
const sourceOptions: { value: ThemeSource; label: string }[] = [
  { value: "default", label: "默认" },
  { value: "custom", label: "自定义" },
  { value: "cover", label: "跟随封面" },
  { value: "solid", label: "纯色" },
];

/** v-model 绑定的颜色字符串 */
const colorHex = ref(theme.customColor);

/** 监听颜色变化，同步到主题 */
watch(colorHex, (hex) => {
  theme.setCustomColor(hex);
});

/** 格式化毫秒为 mm:ss */
const formatTime = (ms: number): string => {
  const totalSecs = Math.floor(ms / 1000);
  const min = Math.floor(totalSecs / 60);
  const sec = totalSecs % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
};

/** 进度条拖动 */
const onSeek = (e: Event): void => {
  const value = Number((e.target as HTMLInputElement).value);
  status.seek(value);
};

/** 音量条拖动 */
const onVolumeChange = (e: Event): void => {
  const value = Number((e.target as HTMLInputElement).value);
  status.setVolume(value);
};
</script>

<template>
  <div class="min-h-screen bg-surface text-on-surface flex flex-col items-center gap-4 p-8 max-w-xl mx-auto">
    <div class="flex items-center gap-3 w-full">
      <h2 class="text-lg font-semibold flex-1">SPlayer Audio Test</h2>
      <!-- 主题类型 -->
      <select
        class="px-2 py-1.5 rounded-lg text-sm border border-outline-variant bg-surface-alt text-on-surface outline-none"
        :value="theme.source"
        @change="theme.setSource(($event.target as HTMLSelectElement).value as ThemeSource)"
      >
        <option v-for="opt in sourceOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <!-- 主色预览 -->
      <span
        class="block w-6 h-6 rounded-full border-2 border-outline-variant shrink-0"
        :style="{ backgroundColor: theme.activeColor }"
      />
      <!-- 明暗切换 -->
      <button
        class="px-3 py-1.5 rounded-lg bg-surface-alt text-on-surface-variant text-sm border border-outline-variant"
        @click="theme.cycleMode()"
      >
        {{ modeLabel[theme.mode] }}
      </button>
    </div>

    <!-- 网络地址输入 -->
    <div class="flex gap-2 w-full">
      <input
        v-model="urlInput"
        type="text"
        placeholder="输入网络音频地址..."
        class="flex-1 px-3 py-2 rounded-lg border border-outline-variant bg-surface-alt text-on-surface text-sm outline-none focus:border-primary"
        @keydown.enter="loadFromUrl"
      />
      <button
        class="px-4 py-2 rounded-lg border border-outline-variant bg-surface-alt text-on-surface text-sm whitespace-nowrap hover:bg-secondary-container"
        @click="loadFromUrl"
      >
        加载网络音频
      </button>
    </div>

    <!-- 本地文件选择 -->
    <div class="flex gap-2 w-full">
      <button
        class="px-4 py-2 rounded-lg border border-outline-variant bg-surface-alt text-on-surface text-sm hover:bg-secondary-container"
        @click="loadFromFile"
      >
        选择本地文件
      </button>
    </div>

    <!-- 错误信息 -->
    <div v-if="error" class="text-error text-sm text-center">{{ error }}</div>

    <!-- 封面 + 元信息 -->
    <div v-if="media.track" class="flex items-center gap-4 w-full">
      <div v-if="coverUrl" class="shrink-0">
        <img
          ref="coverImg"
          :src="coverUrl"
          alt="cover"
          class="w-20 h-20 rounded-lg object-cover bg-surface-alt"
          @load="theme.updateCoverColor(coverImg ?? null)"
        />
      </div>
      <div class="flex-1 min-w-0 text-sm">
        <div class="font-semibold text-on-surface truncate">{{ media.track.title }}</div>
        <div v-if="artistName" class="text-on-surface-variant truncate">{{ artistName }}</div>
        <div v-if="media.track.album" class="text-on-surface-variant truncate italic">
          {{ media.track.album.name }}
        </div>
      </div>
    </div>

    <!-- 播放控制 -->
    <div class="flex gap-3">
      <button
        class="px-4 py-2 rounded-lg border border-outline-variant bg-surface-alt text-on-surface text-sm hover:bg-secondary-container"
        @click="status.stop()"
      >
        Stop
      </button>
      <button
        class="px-6 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold min-w-20 hover:opacity-90 disabled:opacity-50"
        :disabled="isLoading"
        @click="togglePlay"
      >
        {{ isLoading ? "Loading..." : isPlaying ? "Pause" : "Play" }}
      </button>
    </div>

    <!-- 进度条 -->
    <div class="flex items-center gap-2 w-full">
      <span class="text-xs text-on-surface-variant min-w-9 text-center">{{ formatTime(position) }}</span>
      <input
        type="range"
        min="0"
        :max="duration"
        step="100"
        :value="position"
        class="flex-1 accent-primary"
        @input="onSeek"
      />
      <span class="text-xs text-on-surface-variant min-w-9 text-center">{{ formatTime(duration) }}</span>
    </div>

    <!-- 音量控制 -->
    <div class="flex items-center gap-2 w-full">
      <span class="text-xs text-on-surface-variant min-w-9 text-center">VOL</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="volume"
        class="flex-1 accent-primary"
        @input="onVolumeChange"
      />
      <span class="text-xs text-on-surface-variant min-w-9 text-center">
        {{ Math.round(volume * 100) }}%
      </span>
    </div>

    <!-- 歌词区域 -->
    <div v-if="currentLyric" class="w-full mt-2">
      <div class="text-sm text-on-surface-variant mb-2">
        歌词
        <span class="text-primary text-xs ml-1">[{{ currentLyric.format }}]</span>
        <span
          v-if="media.detail && media.detail.externalLyrics.length > 1"
          class="text-outline text-xs ml-1"
        >
          ({{ media.detail.externalLyrics.map((l) => l.format).join(", ") }})
        </span>
      </div>
      <pre class="max-h-50 overflow-y-auto p-3 bg-surface-alt rounded-lg text-xs leading-relaxed text-on-surface-variant whitespace-pre-wrap break-words m-0">{{ currentLyric.content }}</pre>
    </div>

    <!-- 状态信息 -->
    <div class="text-xs text-outline">
      状态: {{ state }} | 进度: {{ Math.round(progress * 100) }}%
    </div>

    <!-- 颜色选择器（仅自定义时显示） -->
    <div v-if="theme.source === 'custom'" class="w-full mt-4 flex items-center gap-3">
      <span class="text-xs text-on-surface-variant shrink-0">主题色</span>
      <ColorSliderRoot
        v-model="colorHex"
        channel="hue"
        class="relative flex items-center flex-1 h-5 select-none touch-none"
      >
        <ColorSliderTrack class="relative flex-1 rounded-full h-3" />
        <ColorSliderThumb class="block w-5 h-5 rounded-full bg-white border-2 border-outline-variant shadow cursor-pointer" />
      </ColorSliderRoot>
      <span class="text-xs text-on-surface-variant font-mono shrink-0">{{ theme.activeColor }}</span>
    </div>
  </div>
</template>
