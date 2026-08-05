import type { Album } from "@shared/types/player";
import { getDb } from "@main/database";

export interface StreamingAlbumRecord {
  serverId: string;
  remoteId: string;
  album: Album;
  generation: number;
}

interface AlbumRow {
  data: string;
}

/**
 * 批量写入流媒体专辑
 * @param records - 流媒体专辑记录
 */
export const upsertAlbums = (records: StreamingAlbumRecord[]): void => {
  if (records.length === 0) return;
  const statement = getDb().prepare(`
    INSERT INTO remote_albums (server_id, remote_id, data, name, generation, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(server_id, remote_id) DO UPDATE SET
      data = excluded.data,
      name = excluded.name,
      generation = excluded.generation,
      updated_at = excluded.updated_at
  `);
  const now = Date.now();
  getDb().transaction(() => {
    for (const record of records) {
      statement.run(
        record.serverId,
        record.remoteId,
        JSON.stringify(record.album),
        record.album.name,
        record.generation,
        now,
      );
    }
  })();
};

/**
 * 获取指定服务器的完整专辑列表
 * @param serverId - 服务器 ID
 * @returns 完整专辑列表
 */
export const getAlbums = (serverId: string): Album[] => {
  const rows = getDb()
    .prepare(
      "SELECT data FROM remote_albums WHERE server_id = ? ORDER BY name COLLATE NOCASE, remote_id",
    )
    .all(serverId) as AlbumRow[];
  return rows.map((row) => JSON.parse(row.data) as Album);
};

/**
 * 删除指定服务器的旧同步专辑
 * @param serverId - 服务器 ID
 * @param generation - 当前同步代次
 */
export const deleteStaleAlbums = (serverId: string, generation: number): void => {
  getDb()
    .prepare("DELETE FROM remote_albums WHERE server_id = ? AND generation <> ?")
    .run(serverId, generation);
};

/**
 * 删除指定服务器的全部专辑
 * @param serverId - 服务器 ID
 */
export const deleteAlbumsByServer = (serverId: string): void => {
  getDb().prepare("DELETE FROM remote_albums WHERE server_id = ?").run(serverId);
};
