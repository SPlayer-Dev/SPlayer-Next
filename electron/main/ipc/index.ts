import { registerSystemIpc } from "./system";
import { registerPlayerIpc } from "./player";

/**
 * 注册所有 IPC 事件处理
 */
export const registerIpcHandlers = (): void => {
  registerSystemIpc();
  registerPlayerIpc();
};
