import { ElectronAPI } from '@electron-toolkit/preload'
import { PlayerApi } from '../../src/types/player'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      player: PlayerApi
    }
  }
}
