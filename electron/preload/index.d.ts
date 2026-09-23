import { ElectronAPI } from "@electron-toolkit/preload";
import { PlayerApi, TrackSource } from "@shared/types/player";
import {
  ConfigApi,
  ExternalApiStatus,
  LocaleCode,
  McpClientConfigParams,
  McpAgentApp,
  McpStatus,
} from "@shared/types/settings";
import { LibraryApi } from "@shared/types/library";
import { NowPlayingApi } from "@shared/types/nowPlaying";
import { PluginsApi } from "@shared/types/plugin";
import { ApisApi } from "@shared/types/apis";
import { LyricsApi } from "@shared/types/lyrics";
import { DownloadApi } from "@shared/types/download";
import {
  WindowApi,
  DesktopLyricApi,
  DynamicIslandApi,
  TaskbarLyricApi,
} from "@shared/types/window";
import { HotkeyApi } from "@shared/types/hotkey";
import { StreamingApi } from "@shared/types/streaming";
import { RecognitionApi } from "@shared/types/recognition";
import { LastfmApi } from "@shared/types/lastfm";
import { IpcResponse } from "@shared/types/player";
import { StatsApi } from "@shared/types/stats";
import { UpdateApi } from "@shared/types/update";
import { CloudUploadApi } from "@shared/types/cloudUpload";
import { CommentsApi } from "@shared/types/comment";
import { AiModelApi } from "@shared/types/ai";
import { PlaylistApi } from "@shared/types/playlist";
import { OpenccApi } from "@shared/types/opencc";

declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      config: ConfigApi;
      player: PlayerApi;
      system: {
        installType: "nsis" | "portable" | "appx" | "dmg" | "appimage";
        platform: NodeJS.Platform;
        osInfo: {
          type: string;
          arch: string;
          release: string;
        };
        toggleDevTools: () => Promise<void>;
        showInExplorer: (filePath: string) => Promise<void>;
        openLogsDir: () => Promise<string>;
        setLocale: (locale: LocaleCode) => void;
        focusMainWindow: () => Promise<void>;
        openSettings: (category?: string, highlight?: string) => Promise<void>;
        onOpenSettings: (
          callback: (payload: { category?: string; highlight?: string }) => void,
        ) => () => void;
        listFonts: () => Promise<string[]>;
        fetchRemoteBytes: (url: string) => Promise<IpcResponse<Buffer | null>>;
        saveFile: (
          data: ArrayBuffer,
          fileName: string,
        ) => Promise<{ success: boolean; path?: string; error?: string }>;
        relaunch: () => Promise<void>;
        testNetworkProxy: () => Promise<boolean>;
        onProtocolUrl: (callback: (url: string) => void) => () => void;
        consumePendingProtocolUrl: () => Promise<string | null>;
        onOpenFiles: (callback: (files: string[]) => void) => () => void;
        consumePendingAudioFiles: () => Promise<string[]>;
        getPathForFile: (file: File) => string;
      };
      library: LibraryApi;
      playlist: PlaylistApi;
      window: WindowApi;
      desktopLyric: DesktopLyricApi;
      dynamicIsland: DynamicIslandApi;
      taskbarLyric: TaskbarLyricApi;
      nowPlaying: NowPlayingApi;
      plugins: PluginsApi;
      apis: ApisApi;
      cloud: CloudUploadApi;
      lyrics: LyricsApi;
      opencc: OpenccApi;
      comments: CommentsApi;
      download: DownloadApi;
      theme: {
        pickBackgroundImage: () => Promise<string | null>;
        clearBackgroundImages: () => Promise<void>;
      };
      cache: {
        getStats: () => Promise<{ id: string; kind: "file" | "db"; path: string; size: number }[]>;
        clear: (id: string) => Promise<void>;
        clearAllByKind: (kind: "file" | "db") => Promise<void>;
        getDir: () => Promise<string>;
        pickDir: () => Promise<{ ok: boolean; dir: string; reason?: "canceled" | "notEmpty" }>;
        resetDir: () => Promise<string>;
        song: {
          lookup: (cacheKey: string) => Promise<string | null>;
          fetch: (
            cacheKey: string,
            source: TrackSource,
            streamUrl: string,
          ) => Promise<string | null>;
          cancel: (cacheKey: string) => Promise<void>;
        };
      };
      stats: StatsApi;
      hotkey: HotkeyApi;
      streaming: StreamingApi;
      recognition: RecognitionApi;
      lastfm: LastfmApi;
      externalApi: {
        restart: () => Promise<ExternalApiStatus>;
        getStatus: () => Promise<ExternalApiStatus>;
        onStatus: (callback: (status: ExternalApiStatus) => void) => () => void;
      };
      mcp: {
        restart: () => Promise<McpStatus>;
        getStatus: () => Promise<McpStatus>;
        getClientConfigParams: () => Promise<McpClientConfigParams>;
        detectAgents: () => Promise<McpAgentApp[]>;
        injectAgentConfig: (agentId: string, params: McpClientConfigParams) => Promise<boolean>;
        onStatus: (callback: (status: McpStatus) => void) => () => void;
      };
      aiModel: AiModelApi;
      update: UpdateApi;
    };
  }
}
