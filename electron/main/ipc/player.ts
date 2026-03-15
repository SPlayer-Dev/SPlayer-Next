import { ipcMain, BrowserWindow } from 'electron'
import { loadNativeModule } from '../utils/nativeLoader'

type AudioEngineModule = typeof import('@splayer/audio-engine')

let audioEngine: AudioEngineModule | null = null
let player: InstanceType<AudioEngineModule['AudioPlayer']> | null = null
let positionTimer: ReturnType<typeof setInterval> | null = null

function getEngine(): AudioEngineModule {
  if (!audioEngine) {
    audioEngine = loadNativeModule<AudioEngineModule>('audio-engine.node', 'audio-engine')
    if (!audioEngine) {
      throw new Error('[Player] audio-engine 原生模块加载失败')
    }
  }
  return audioEngine
}

function getPlayer(): InstanceType<AudioEngineModule['AudioPlayer']> {
  if (!player) {
    const engine = getEngine()
    player = new engine.AudioPlayer()
  }
  return player
}

/** 向所有窗口推送事件 */
function broadcast(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }
}

/** 30fps 位置推送 */
function startPositionPush(): void {
  stopPositionPush()
  positionTimer = setInterval(() => {
    const p = getPlayer()
    const status = p.getStatus()
    broadcast('player:event', { type: 'status', data: status })

    // 自动检测播放结束
    if (status.isFinished && status.state === 'playing') {
      broadcast('player:event', { type: 'ended' })
      stopPositionPush()
    }
  }, 33)
}

function stopPositionPush(): void {
  if (positionTimer !== null) {
    clearInterval(positionTimer)
    positionTimer = null
  }
}

export const registerPlayerIpc = (): void => {
  ipcMain.handle('player:load', async (_event, source: string) => {
    try {
      const metadata = getPlayer().load(source)
      startPositionPush()
      return { success: true, data: metadata }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('player:play', async () => {
    try {
      getPlayer().play()
      startPositionPush()
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('player:pause', async () => {
    try {
      getPlayer().pause()
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('player:stop', async () => {
    try {
      getPlayer().stop()
      stopPositionPush()
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('player:seek', async (_event, position: number) => {
    try {
      getPlayer().seek(position)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('player:setVolume', async (_event, volume: number) => {
    try {
      getPlayer().setVolume(volume)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('player:getVolume', async () => {
    return { success: true, data: getPlayer().getVolume() }
  })

  ipcMain.handle('player:getStatus', async () => {
    return { success: true, data: getPlayer().getStatus() }
  })

  ipcMain.handle('player:getFftData', async () => {
    return { success: true, data: getPlayer().getFftData() }
  })
}
