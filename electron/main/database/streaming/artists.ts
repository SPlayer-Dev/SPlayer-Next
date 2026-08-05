import type { Artist } from "@shared/types/player";
import { getDb } from "@main/database";

export interface StreamingArtistRecord {
  serverId: string;
  remoteId: string;
  artist: Artist;
  generation: number;
}

interface ArtistRow {
  data: string;
}

/**
 * 批量写入流媒体歌手
 * @param records - 流媒体歌手记录
 */
export const upsertArtists = (records: StreamingArtistRecord[]): void => {
  if (records.length === 0) return;
  const statement = getDb().prepare(`
    INSERT INTO remote_artists (server_id, remote_id, data, name, generation, updated_at)
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
        JSON.stringify(record.artist),
        record.artist.name,
        record.generation,
        now,
      );
    }
  })();
};

/**
 * 获取指定服务器的完整歌手列表
 * @param serverId - 服务器 ID
 * @returns 完整歌手列表
 */
export const getArtists = (serverId: string): Artist[] => {
  const rows = getDb()
    .prepare(
      "SELECT data FROM remote_artists WHERE server_id = ? ORDER BY name COLLATE NOCASE, remote_id",
    )
    .all(serverId) as ArtistRow[];
  return rows.map((row) => JSON.parse(row.data) as Artist);
};

/**
 * 删除指定服务器的旧同步歌手
 * @param serverId - 服务器 ID
 * @param generation - 当前同步代次
 */
export const deleteStaleArtists = (serverId: string, generation: number): void => {
  getDb()
    .prepare("DELETE FROM remote_artists WHERE server_id = ? AND generation <> ?")
    .run(serverId, generation);
};

/**
 * 删除指定服务器的全部歌手
 * @param serverId - 服务器 ID
 */
export const deleteArtistsByServer = (serverId: string): void => {
  getDb().prepare("DELETE FROM remote_artists WHERE server_id = ?").run(serverId);
};
