import { ElectronAPI } from "@electron-toolkit/preload";
import { PlayerApi } from "@shared/types/player";
import { ConfigApi, LocaleCode } from "@shared/types/settings";
import { LibraryApi } from "@shared/types/library";
import { NowPlayingApi } from "@shared/types/nowPlaying";
import { PluginsApi } from "@shared/types/plugin";
import { NeteaseApi } from "@shared/types/netease";
import {
  WindowApi,
  DesktopLyricApi,
  DynamicIslandApi,
  TaskbarLyricApi,
} from "@shared/types/window";

declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      config: ConfigApi;
      player: PlayerApi;
      system: {
        toggleDevTools: () => Promise<void>;
        showInExplorer: (filePath: string) => Promise<void>;
        setLocale: (locale: LocaleCode) => void;
        focusMainWindow: () => Promise<void>;
        openSettings: (category?: string, highlight?: string) => Promise<void>;
        onOpenSettings: (
          callback: (payload: { category?: string; highlight?: string }) => void,
        ) => () => void;
      };
      library: LibraryApi;
      window: WindowApi;
      desktopLyric: DesktopLyricApi;
      dynamicIsland: DynamicIslandApi;
      taskbarLyric: TaskbarLyricApi;
      nowPlaying: NowPlayingApi;
      plugins: PluginsApi;
      netease: NeteaseApi;
    };
  }
}
