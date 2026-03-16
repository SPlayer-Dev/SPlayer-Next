<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { usePlayerStore } from './stores/player'

const player = usePlayerStore()

/** 网络地址输入 */
const urlInput = ref('')
/** 当前加载的文件名 */
const fileName = ref('')

/** 从网络地址加载 */
const loadFromUrl = async (): Promise<void> => {
  const url = urlInput.value.trim()
  if (!url) return
  fileName.value = url.split('/').pop() ?? url
  await player.load(url)
}

/** 打开本地文件对话框并加载 */
const loadFromFile = async (): Promise<void> => {
  const result = await window.api.player.openFile()
  if (!result.success || !result.data) return
  const filePath = result.data
  fileName.value = filePath.split(/[/\\]/).pop() ?? filePath
  await player.load(filePath)
}

/** 切换播放/暂停 */
const togglePlay = (): void => {
  if (player.isPlaying) {
    player.pause()
  } else {
    player.play()
  }
}

/** 格式化秒数为 mm:ss */
const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** 进度条拖动 */
const onSeek = (e: Event): void => {
  const value = Number((e.target as HTMLInputElement).value)
  player.seek(value)
}

/** 音量条拖动 */
const onVolumeChange = (e: Event): void => {
  const value = Number((e.target as HTMLInputElement).value)
  player.setVolume(value)
}

onMounted(() => {
  player.init()
})

onBeforeUnmount(() => {
  player.dispose()
})
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
    <div v-if="player.error" class="error">{{ player.error }}</div>

    <!-- 当前播放信息 -->
    <div v-if="player.metadata" class="metadata">
      <div class="now-playing">{{ fileName }}</div>
      <div v-if="player.metadata.title" class="meta-item">
        {{ player.metadata.title }}
        <span v-if="player.metadata.artist"> - {{ player.metadata.artist }}</span>
      </div>
      <div v-if="player.metadata.album" class="meta-item album">{{ player.metadata.album }}</div>
    </div>

    <!-- 播放控制 -->
    <div class="controls">
      <button @click="player.stop()">Stop</button>
      <button class="play-btn" @click="togglePlay">
        {{ player.isPlaying ? 'Pause' : 'Play' }}
      </button>
    </div>

    <!-- 进度条 -->
    <div class="progress-bar">
      <span class="time">{{ formatTime(player.position) }}</span>
      <input
        type="range"
        min="0"
        :max="player.duration"
        step="0.1"
        :value="player.position"
        @input="onSeek"
      />
      <span class="time">{{ formatTime(player.duration) }}</span>
    </div>

    <!-- 音量控制 -->
    <div class="volume-bar">
      <span class="label">VOL</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="player.volume"
        @input="onVolumeChange"
      />
      <span class="value">{{ Math.round(player.volume * 100) }}%</span>
    </div>

    <!-- 状态信息 -->
    <div class="status">
      状态: {{ player.state }} | 进度: {{ Math.round(player.progress * 100) }}%
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

.metadata {
  text-align: center;
  font-size: 13px;
}

.now-playing {
  font-weight: 600;
  color: #fff;
  margin-bottom: 4px;
}

.meta-item {
  color: #aaa;
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

.status {
  font-size: 12px;
  color: #666;
}
</style>
