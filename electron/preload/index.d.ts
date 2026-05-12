import { ElectronAPI } from "@electron-toolkit/preload";
import { PlayerApi, TrackSource } from "@shared/types/player";
import { ConfigApi, LocaleCode } from "@shared/types/settings";
import { LibraryApi } from "@shared/types/library";
import { NowPlayingApi } from "@shared/types/nowPlaying";
import { PluginsApi } from "@shared/types/plugin";
import { ApisApi } from "@shared/types/apis";
import { LyricsApi } from "@shared/types/lyrics";
import {
  WindowApi,
  DesktopLyricApi,
  DynamicIslandApi,
  TaskbarLyricApi,
} from "@shared/types/window";
import { HotkeyApi } from "@shared/types/hotkey";
import { StreamingApi } from "@shared/types/streaming";
import { IpcResponse } from "@shared/types/player";

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
        listFonts: () => Promise<string[]>;
        fetchRemoteBytes: (url: string) => Promise<IpcResponse<Buffer | null>>;
        relaunch: () => Promise<void>;
      };
      library: LibraryApi;
      window: WindowApi;
      desktopLyric: DesktopLyricApi;
      dynamicIsland: DynamicIslandApi;
      taskbarLyric: TaskbarLyricApi;
      nowPlaying: NowPlayingApi;
      plugins: PluginsApi;
      apis: ApisApi;
      lyrics: LyricsApi;
      theme: {
        pickBackgroundImage: () => Promise<string | null>;
        clearBackgroundImages: () => Promise<void>;
      };
      songCache: {
        lookup: (cacheKey: string) => Promise<string | null>;
        fetch: (
          cacheKey: string,
          source: TrackSource,
          streamUrl: string,
        ) => Promise<string | null>;
        cancel: (cacheKey: string) => Promise<void>;
      };
      cache: {
        getStats: () => Promise<
          { id: string; kind: "file" | "db"; path: string; size: number }[]
        >;
        clear: (id: string) => Promise<void>;
        clearAllByKind: (kind: "file" | "db") => Promise<void>;
        getDir: () => Promise<string>;
        pickDir: () => Promise<{ ok: boolean; dir: string; reason?: "canceled" | "notEmpty" }>;
        resetDir: () => Promise<string>;
      };
      hotkey: HotkeyApi;
      streaming: StreamingApi;
    };
  }
}
