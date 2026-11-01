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
import { registerThemeIpc } from "./theme";
import { registerStreamingIpc } from "./streaming";
import { registerLastfmIpc } from "./lastfm";
import { registerCacheIpc } from "./cache";
import { registerDownloadIpc } from "./download";
import { registerExternalApiIpc } from "./externalApi";
import { registerMcpIpc } from "./mcp";
import { registerStatsIpc } from "./stats";
import { registerUpdateIpc } from "./update";
import { registerCloudIpc } from "./cloud";
import { registerCommentsIpc } from "./comments";
import { registerAiModelIpc } from "./aiModel";
import { registerPlaylistIpc } from "./playlist";
import { registerRecognitionIpc } from "./recognition";
import { registerOpenccIpc } from "./opencc";
import { registerAutoMixIpc } from "./automix";

/**
 * 注册所有 IPC 处理
 * @param onStartupComplete - 主界面启动完成后执行的应用初始化回调
 */
export const registerIpcHandlers = (onStartupComplete: () => void): void => {
  registerSystemIpc();
  registerPlayerIpc();
  registerAutoMixIpc();
  registerConfigIpc();
  registerLibraryIpc();
  registerNowPlayingIpc();
  registerWindowIpc(onStartupComplete);
  registerPluginIpc();
  registerApisIpc();
  registerCloudIpc();
  registerCommentsIpc();
  registerLyricsIpc();
  registerOpenccIpc();
  registerHotkeyIpc();
  registerThemeIpc();
  registerStreamingIpc();
  registerPlaylistIpc();
  registerRecognitionIpc();
  registerLastfmIpc();
  registerCacheIpc();
  registerDownloadIpc();
  registerExternalApiIpc();
  registerMcpIpc();
  registerAiModelIpc();
  registerStatsIpc();
  registerUpdateIpc();
};
