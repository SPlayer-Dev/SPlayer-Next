import { storeToRefs } from "pinia";
import { onMounted, onUnmounted } from "vue";
import { usePlayerStore } from "@/stores/player";

/**
 * Composable for audio player interaction.
 * Automatically initializes event listener on mount and cleans up on unmount.
 */
export function usePlayer() {
  const store = usePlayerStore();

  const {
    state,
    position,
    duration,
    volume,
    metadata,
    fftData,
    error,
    currentSource,
    isPlaying,
    isPaused,
    progress,
  } = storeToRefs(store);

  onMounted(() => {
    store.init();
  });

  onUnmounted(() => {
    store.dispose();
  });

  return {
    // Reactive state
    state,
    position,
    duration,
    volume,
    metadata,
    fftData,
    error,
    currentSource,
    isPlaying,
    isPaused,
    progress,
    // Actions
    load: store.load,
    play: store.play,
    pause: store.pause,
    stop: store.stop,
    seek: store.seek,
    setVolume: store.setVolume,
  };
}
