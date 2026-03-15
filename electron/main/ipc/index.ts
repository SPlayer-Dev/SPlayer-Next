import { registerSystemIpc } from './system'
import { registerPlayerIpc } from './player'

/**
 * 注册所有 IPC 事件处理
 * @description 在此处集中引入各模块的 IPC 注册函数
 */
export const registerIpcHandlers = (): void => {
  registerSystemIpc()
  registerPlayerIpc()
  // 按需添加更多模块:
  // registerPlaylistIpc()
  // registerLyricIpc()
}
