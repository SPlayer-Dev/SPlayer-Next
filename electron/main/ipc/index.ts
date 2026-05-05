import { registerSystemIpc } from "./system";
import { registerPlayerIpc } from "./player";
import { registerConfigIpc } from "./config";
import { registerLibraryIpc } from "./library";
import { registerNowPlayingIpc } from "./nowPlaying";
import { registerWindowIpc } from "./window";
import { registerPluginIpc } from "./plugin";
import { registerApisIpc } from "./apis";
import { registerLyricsIpc } from "./lyrics";
import { registerHotkeyIpc } from "./hotkey";

/** 注册所有 IPC 处理 */
export const registerIpcHandlers = (): void => {
  registerSystemIpc();
  registerPlayerIpc();
  registerConfigIpc();
  registerLibraryIpc();
  registerNowPlayingIpc();
  registerWindowIpc();
  registerPluginIpc();
  registerApisIpc();
  registerLyricsIpc();
  registerHotkeyIpc();
};
