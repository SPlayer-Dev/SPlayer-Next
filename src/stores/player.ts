import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AudioMetadata, PlayerStatus, PlayerEvent } from '@/types/player'

export const usePlayerStore = defineStore('player', () => {
  // --- State ---
  const state = ref<PlayerStatus['state']>('idle')
  const position = ref(0)
  const duration = ref(0)
  const volume = ref(1)
  const metadata = ref<AudioMetadata | null>(null)
  const fftData = ref<number[]>([])
  const error = ref<string | null>(null)
  const currentSource = ref<string | null>(null)

  // --- Computed ---
  const isPlaying = computed(() => state.value === 'playing')
  const isPaused = computed(() => state.value === 'paused')
  const progress = computed(() => (duration.value > 0 ? position.value / duration.value : 0))

  // --- Actions ---
  async function load(source: string): Promise<void> {
    error.value = null
    const result = await window.api.player.load(source)
    if (result.success && result.data) {
      metadata.value = result.data
      duration.value = result.data.duration
      position.value = 0
      state.value = 'playing'
      currentSource.value = source
    } else {
      error.value = result.error ?? 'Failed to load'
    }
  }

  async function play(): Promise<void> {
    const result = await window.api.player.play()
    if (result.success) {
      state.value = 'playing'
    }
  }

  async function pause(): Promise<void> {
    const result = await window.api.player.pause()
    if (result.success) {
      state.value = 'paused'
    }
  }

  async function stop(): Promise<void> {
    const result = await window.api.player.stop()
    if (result.success) {
      state.value = 'stopped'
      position.value = 0
    }
  }

  async function seek(pos: number): Promise<void> {
    const result = await window.api.player.seek(pos)
    if (result.success) {
      position.value = pos
    }
  }

  async function setVolume(vol: number): Promise<void> {
    const result = await window.api.player.setVolume(vol)
    if (result.success) {
      volume.value = vol
    }
  }

  /** Handle events pushed from main process */
  function handleEvent(event: PlayerEvent): void {
    switch (event.type) {
      case 'status':
        state.value = event.data.state
        position.value = event.data.position
        duration.value = event.data.duration
        volume.value = event.data.volume
        break
      case 'ended':
        state.value = 'stopped'
        position.value = duration.value
        break
      case 'error':
        error.value = event.error
        break
    }
  }

  // --- Subscribe to player events from main process ---
  let unsubscribe: (() => void) | null = null

  function init(): void {
    if (unsubscribe) return
    unsubscribe = window.api.player.onEvent(handleEvent)
  }

  function dispose(): void {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  }

  return {
    // State
    state,
    position,
    duration,
    volume,
    metadata,
    fftData,
    error,
    currentSource,
    // Computed
    isPlaying,
    isPaused,
    progress,
    // Actions
    load,
    play,
    pause,
    stop,
    seek,
    setVolume,
    init,
    dispose
  }
})
