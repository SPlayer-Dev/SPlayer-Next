import { ElectronAPI } from "@electron-toolkit/preload";
import { PlayerApi } from "@shared/types/player";
import { PlaybackApi } from "@shared/types/playback";

declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      player: PlayerApi;
      playback: PlaybackApi;
    };
  }
}
