import { ipcMain } from "electron";
import { isDbOpen } from "@main/database";
import {
  deleteLibraryByServer,
  getLibrarySnapshot,
  searchLibrary,
} from "@main/services/streaming/library";
import {
  addStreamingServer,
  getStreamingConfig,
  getStreamingServer,
  removeStreamingServer,
  setActiveStreamingServer,
  updateStreamingServer,
} from "@main/services/streaming/config";
import {
  connectStreamingServer,
  testStreamingConnection,
  withStreamingAdapter,
} from "@main/services/streaming/connection";
import { registerStreamingCoverProtocol } from "@main/services/streaming/coverProtocol";
import { invalidateStreamingSession } from "@main/services/streaming/adapters/resolve";
import { cancelStreamingSync, queueStreamingSync } from "@main/services/streaming/sync";
import type { StreamingServerInput } from "@shared/types/streaming";

/** 注册流媒体 IPC 和封面协议 */
export const registerStreamingIpc = (): void => {
  registerStreamingCoverProtocol();

  ipcMain.handle("streaming:loadServers", getStreamingConfig);
  ipcMain.handle("streaming:addServer", (_event, input: StreamingServerInput) =>
    addStreamingServer(input),
  );
  ipcMain.handle(
    "streaming:updateServer",
    (_event, serverId: string, input: StreamingServerInput) => {
      invalidateStreamingSession(serverId);
      cancelStreamingSync(serverId);
      return updateStreamingServer(serverId, input);
    },
  );
  ipcMain.handle("streaming:removeServer", (_event, serverId: string) => {
    invalidateStreamingSession(serverId);
    cancelStreamingSync(serverId);
    removeStreamingServer(serverId);
    if (isDbOpen()) deleteLibraryByServer(serverId);
  });
  ipcMain.handle("streaming:setActiveServer", (_event, serverId: string | null) =>
    setActiveStreamingServer(serverId),
  );
  ipcMain.handle(
    "streaming:testConnection",
    (_event, input: StreamingServerInput, serverId?: string) =>
      testStreamingConnection(input, serverId),
  );
  ipcMain.handle("streaming:connect", (_event, serverId: string) =>
    connectStreamingServer(serverId),
  );
  ipcMain.handle("streaming:disconnect", (_event, serverId: string) =>
    invalidateStreamingSession(serverId),
  );
  ipcMain.handle("streaming:getSnapshot", (_event, serverId: string) =>
    getLibrarySnapshot(serverId),
  );
  ipcMain.handle("streaming:sync", (_event, serverId: string, force = false) =>
    queueStreamingSync(getStreamingServer(serverId), force),
  );
  ipcMain.handle("streaming:search", (_event, serverId: string, query: string) =>
    searchLibrary(serverId, query.slice(0, 200)),
  );
  ipcMain.handle("streaming:getAlbumSongs", (_event, serverId: string, albumId: string) =>
    withStreamingAdapter(serverId, (config, adapter) => adapter.getAlbumSongs(config, albumId)),
  );
  ipcMain.handle("streaming:getPlaylistSongs", (_event, serverId: string, playlistId: string) =>
    withStreamingAdapter(serverId, (config, adapter) =>
      adapter.getPlaylistSongs(config, playlistId),
    ),
  );
  ipcMain.handle("streaming:getArtistAlbums", (_event, serverId: string, artistId: string) =>
    withStreamingAdapter(serverId, (config, adapter) => adapter.getArtistAlbums(config, artistId)),
  );
  ipcMain.handle("streaming:getArtistSongs", (_event, serverId: string, artistId: string) =>
    withStreamingAdapter(serverId, (config, adapter) => adapter.getArtistSongs(config, artistId)),
  );
  ipcMain.handle(
    "streaming:getStreamUrl",
    (_event, serverId: string, trackId: string, playSessionId?: string) =>
      withStreamingAdapter(serverId, (config, adapter) =>
        adapter.getStreamUrl(config, trackId, playSessionId),
      ),
  );
  ipcMain.handle(
    "streaming:getLyrics",
    (_event, serverId: string, trackId: string, hint?: { artist?: string; title?: string }) =>
      withStreamingAdapter(serverId, (config, adapter) => adapter.getLyrics(config, trackId, hint)),
  );
};
