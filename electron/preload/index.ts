import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  player: {
    load: (source: string) => ipcRenderer.invoke('player:load', source),
    play: () => ipcRenderer.invoke('player:play'),
    pause: () => ipcRenderer.invoke('player:pause'),
    stop: () => ipcRenderer.invoke('player:stop'),
    seek: (position: number) => ipcRenderer.invoke('player:seek', position),
    setVolume: (volume: number) => ipcRenderer.invoke('player:setVolume', volume),
    getVolume: () => ipcRenderer.invoke('player:getVolume'),
    getStatus: () => ipcRenderer.invoke('player:getStatus'),
    getFftData: () => ipcRenderer.invoke('player:getFftData'),
    onEvent: (callback: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => {
        callback(data)
      }
      ipcRenderer.on('player:event', handler)
      return () => {
        ipcRenderer.removeListener('player:event', handler)
      }
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
