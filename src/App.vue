<script setup lang="ts">
import { ref, computed } from "vue";
import { storeToRefs } from "pinia";
import { useStatusStore } from "./stores/status";
import { useMediaStore } from "./stores/media";

const status = useStatusStore();
const media = useMediaStore();

const { state, position, duration, volume, error, isPlaying, isLoading, progress } =
  storeToRefs(status);

/** 网络地址输入 */
const urlInput = ref("");

/** 封面缩略图 URL */
const coverUrl = computed(() => media.track?.cover ?? null);

/** 歌手名拼接 */
const artistName = computed(() =>
  media.track?.artists.map((a) => a.name).join(" / ") ?? "",
);

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
  <div class="player-test">
    <h2>SPlayer Audio Test</h2>

    <!-- 网络地址输入 -->
    <div class="input-group">
      <input
        v-model="urlInput"
        type="text"
        placeholder="输入网络音频地址..."
        @keydown.enter="loadFromUrl"
      />
      <button @click="loadFromUrl">加载网络音频</button>
    </div>

    <!-- 本地文件选择 -->
    <div class="input-group">
      <button @click="loadFromFile">选择本地文件</button>
    </div>

    <!-- 错误信息 -->
    <div v-if="error" class="error">{{ error }}</div>

    <!-- 封面 + 元信息 -->
    <div v-if="media.track" class="song-info">
      <div v-if="coverUrl" class="cover-wrap">
        <img :src="coverUrl" alt="cover" class="cover-img" />
      </div>
      <div class="metadata">
        <div class="now-playing">{{ media.track.title }}</div>
        <div v-if="artistName" class="meta-item">{{ artistName }}</div>
        <div v-if="media.track.album" class="meta-item album">{{ media.track.album.name }}</div>
      </div>
    </div>

    <!-- 播放控制 -->
    <div class="controls">
      <button @click="status.stop()">Stop</button>
      <button class="play-btn" :disabled="isLoading" @click="togglePlay">
        {{ isLoading ? "Loading..." : isPlaying ? "Pause" : "Play" }}
      </button>
    </div>

    <!-- 进度条 -->
    <div class="progress-bar">
      <span class="time">{{ formatTime(position) }}</span>
      <input
        type="range"
        min="0"
        :max="duration"
        step="100"
        :value="position"
        @input="onSeek"
      />
      <span class="time">{{ formatTime(duration) }}</span>
    </div>

    <!-- 音量控制 -->
    <div class="volume-bar">
      <span class="label">VOL</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="volume"
        @input="onVolumeChange"
      />
      <span class="value">{{ Math.round(volume * 100) }}%</span>
    </div>

    <!-- 歌词区域 -->
    <div v-if="currentLyric" class="lyric-section">
      <div class="lyric-header">
        歌词
        <span class="lyric-format">[{{ currentLyric.format }}]</span>
        <!-- 显示所有可用的歌词源 -->
        <span v-if="media.detail && media.detail.externalLyrics.length > 1" class="lyric-sources">
          ({{ media.detail.externalLyrics.map((l) => l.format).join(", ") }})
        </span>
      </div>
      <pre class="lyric-content">{{ currentLyric.content }}</pre>
    </div>

    <!-- 状态信息 -->
    <div class="status">
      状态: {{ state }} | 进度: {{ Math.round(progress * 100) }}%
    </div>
  </div>
</template>

<style scoped>
.player-test {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 32px;
  max-width: 500px;
  margin: 0 auto;
  color: #e0e0e0;
}

h2 {
  margin: 0;
  font-size: 20px;
  color: #fff;
}

.input-group {
  display: flex;
  gap: 8px;
  width: 100%;
}

.input-group input {
  flex: 1;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid #444;
  background: #2a2a2e;
  color: #e0e0e0;
  font-size: 13px;
  outline: none;
}

.input-group input:focus {
  border-color: #5b7ee5;
}

button {
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid #555;
  background: #3a3a3e;
  color: #e0e0e0;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
  transition: background 0.15s;
}

button:hover {
  background: #4a4a4e;
}

.play-btn {
  min-width: 80px;
  background: #5b7ee5;
  border-color: #5b7ee5;
  color: #fff;
  font-weight: 600;
}

.play-btn:hover {
  background: #4a6ed4;
}

.error {
  color: #ef4444;
  font-size: 13px;
  text-align: center;
}

.song-info {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
}

.cover-wrap {
  flex-shrink: 0;
}

.cover-img {
  width: 80px;
  height: 80px;
  border-radius: 8px;
  object-fit: cover;
  background: #2a2a2e;
}

.metadata {
  flex: 1;
  min-width: 0;
  font-size: 13px;
}

.now-playing {
  font-weight: 600;
  color: #fff;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-item {
  color: #aaa;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.album {
  font-style: italic;
}

.controls {
  display: flex;
  gap: 12px;
}

.progress-bar,
.volume-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.progress-bar input,
.volume-bar input {
  flex: 1;
  accent-color: #5b7ee5;
}

.time,
.label,
.value {
  font-size: 12px;
  color: #888;
  min-width: 36px;
  text-align: center;
}

.lyric-section {
  width: 100%;
  margin-top: 8px;
}

.lyric-header {
  font-size: 13px;
  color: #aaa;
  margin-bottom: 8px;
}

.lyric-format {
  color: #5b7ee5;
  font-size: 12px;
  margin-left: 4px;
}

.lyric-sources {
  color: #666;
  font-size: 11px;
  margin-left: 4px;
}

.lyric-content {
  max-height: 200px;
  overflow-y: auto;
  padding: 12px;
  background: #1e1e22;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.8;
  color: #ccc;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}

.status {
  font-size: 12px;
  color: #666;
}
</style>
