import { ipcMain } from "electron";
import type {
  LegacyPlaylistRecord,
  PlaylistCreateInput,
  PlaylistUpdateInput,
} from "@shared/types/playlist";
import {
  addPlaylistTracks,
  clearPlaylists,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  getPlaylists,
  importLegacyPlaylists,
  removePlaylistTracks,
  updatePlaylist,
} from "@main/database/playlists";
/** 注册统一歌单 IPC */
export const registerPlaylistIpc = (): void => {
  ipcMain.handle("playlist:list", getPlaylists);
  ipcMain.handle("playlist:get", (_event, id: string) => getPlaylist(id));
  ipcMain.handle("playlist:create", (_event, input: PlaylistCreateInput) => createPlaylist(input));
  ipcMain.handle("playlist:update", (_event, id: string, input: PlaylistUpdateInput) =>
    updatePlaylist(id, input),
  );
  ipcMain.handle("playlist:remove", (_event, id: string) => deletePlaylist(id));
  ipcMain.handle("playlist:addTracks", (_event, id: string, trackIds: string[]) =>
    addPlaylistTracks(id, trackIds),
  );
  ipcMain.handle("playlist:removeTracks", (_event, id: string, trackIds: string[]) =>
    removePlaylistTracks(id, trackIds),
  );
  ipcMain.handle("playlist:importLegacy", (_event, records: LegacyPlaylistRecord[]) =>
    importLegacyPlaylists(records),
  );
  ipcMain.handle("playlist:clear", clearPlaylists);
};
