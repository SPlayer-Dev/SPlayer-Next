import { ElectronAPI } from "@electron-toolkit/preload";
import { PlayerApi } from "@shared/types/player";
import { ConfigApi, LocaleCode } from "@shared/types/settings";
import { LibraryApi } from "@shared/types/library";
import { NowPlayingApi } from "@shared/types/nowPlaying";
import { WindowApi, DesktopLyricApi } from "@shared/types/window";

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
        openSettings: (category?: string) => Promise<void>;
        onOpenSettings: (callback: (category?: string) => void) => () => void;
      };
      library: LibraryApi;
      window: WindowApi;
      desktopLyric: DesktopLyricApi;
      nowPlaying: NowPlayingApi;
    };
  }
}
