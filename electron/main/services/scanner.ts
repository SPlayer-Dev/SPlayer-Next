import { createHash } from "node:crypto";
import { getEngine } from "./engine";
import {
  upsertTracks,
  deleteTracksByPaths,
  getFileRecords,
  type UpsertTrack,
} from "./database";
import { broadcast } from "../utils/broadcast";
import { toCoverUrl } from "../utils/protocol";
import { toMs } from "../utils/time";
import { parseArtists, parseAlbum } from "../utils/metadata";
import { coverCacheDir } from "../utils/config";
import { libraryLog } from "../utils/logger";

let scanning = false;

/** 是否正在扫描 */
export const isScanning = (): boolean => scanning;

/**
 * 开始扫描
 * @param dirs 扫描目录列表
 * @param incremental 是否增量扫描（跳过未变化的文件）
 */
export const startScan = (dirs: string[], incremental = true): void => {
  if (scanning) {
    libraryLog.warn("已有扫描任务进行中，跳过");
    return;
  }
  if (dirs.length === 0) {
    libraryLog.warn("无扫描目录，跳过");
    return;
  }

  scanning = true;
  libraryLog.info(`开始扫描 ${dirs.length} 个目录 (增量=${incremental})`);

  // 增量扫描时传入已有文件记录，Rust 端会比对 mtime/size 跳过未变化的文件
  const incrementalData = incremental ? getFileRecords() : undefined;

  const engine = getEngine();
  engine.scanDirs(
    dirs,
    (event: {
      eventType: string;
      scanned: number;
      total: number;
      current?: string;
      tracks?: Array<{
        path: string;
        title?: string;
        artist?: string;
        album?: string;
        duration: number;
        codec: string;
        sampleRate: number;
        bitRate: number;
        channels: number;
        bitsPerSample: number;
        cover?: string;
        fileSize: number;
        fileMtime: number;
      }>;
      removedPaths?: string[];
      error?: string;
    }) => {
      switch (event.eventType) {
        case "progress": {
          // 批量写入数据库
          if (event.tracks && event.tracks.length > 0) {
            const upserts: UpsertTrack[] = event.tracks.map((t) => {
              const id = createHash("sha256").update(t.path).digest("hex").slice(0, 16);
              return {
                id,
                path: t.path,
                title: t.title || t.path.split(/[/\\]/).pop() || t.path,
                artists: parseArtists(t.artist ?? ""),
                album: parseAlbum(t.album ?? ""),
                duration: toMs(t.duration),
                cover: toCoverUrl(t.cover),
                codec: t.codec,
                sampleRate: t.sampleRate,
                bitRate: t.bitRate,
                channels: t.channels,
                bitsPerSample: t.bitsPerSample,
                fileSize: t.fileSize,
                fileMtime: t.fileMtime,
              };
            });
            upsertTracks(upserts);
          }
          broadcast("library:scanProgress", {
            phase: "scanning",
            total: event.total,
            scanned: event.scanned,
            current: event.current,
          });
          break;
        }
        case "done": {
          // 清理已删除的文件
          if (event.removedPaths && event.removedPaths.length > 0) {
            deleteTracksByPaths(event.removedPaths);
            libraryLog.info(`清理 ${event.removedPaths.length} 个已删除文件`);
          }
          scanning = false;
          broadcast("library:scanProgress", {
            phase: "done",
            total: event.total,
            scanned: event.scanned,
          });
          libraryLog.info(`扫描完成: ${event.scanned}/${event.total} 个文件`);
          break;
        }
        case "error": {
          scanning = false;
          broadcast("library:scanProgress", {
            phase: "error",
            total: event.total,
            scanned: event.scanned,
            error: event.error,
          });
          libraryLog.error(`扫描出错: ${event.error}`);
          break;
        }
      }
    },
    coverCacheDir,
    incrementalData,
  );
};

/** 取消正在进行的扫描 */
export const cancelScan = (): void => {
  if (!scanning) return;
  const engine = getEngine();
  engine.cancelScan();
  scanning = false;
  libraryLog.info("已发送扫描取消信号");
};
