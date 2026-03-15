/** Audio metadata returned from the native engine */
export interface AudioMetadata {
  title?: string
  artist?: string
  album?: string
  duration: number
  sampleRate: number
  channels: number
}

/** Player status snapshot */
export interface PlayerStatus {
  state: 'idle' | 'playing' | 'paused' | 'stopped'
  position: number
  duration: number
  volume: number
  isFinished: boolean
}

/** Events pushed from main process to renderer */
export type PlayerEvent =
  | { type: 'status'; data: PlayerStatus }
  | { type: 'ended' }
  | { type: 'error'; error: string }

/** IPC response wrapper */
export interface IpcResponse<T = void> {
  success: boolean
  data?: T
  error?: string
}

/** Player API exposed via preload */
export interface PlayerApi {
  load: (source: string) => Promise<IpcResponse<AudioMetadata>>
  play: () => Promise<IpcResponse>
  pause: () => Promise<IpcResponse>
  stop: () => Promise<IpcResponse>
  seek: (position: number) => Promise<IpcResponse>
  setVolume: (volume: number) => Promise<IpcResponse>
  getVolume: () => Promise<IpcResponse<number>>
  getStatus: () => Promise<IpcResponse<PlayerStatus>>
  getFftData: () => Promise<IpcResponse<number[]>>
  onEvent: (callback: (event: PlayerEvent) => void) => () => void
}
