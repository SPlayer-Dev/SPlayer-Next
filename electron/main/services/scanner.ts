import { createHash } from "node:crypto";
import type { JsScanEvent, JsScannedTrack } from "@splayer/audio-engine";
import { getEngine } from "./engine";
import {
  upsertTracks,
  deleteTracksByPaths,
  getFileRecords,
  type UpsertTrack,
} from "@main/database";
import { broadcast } from "@main/utils/broadcast";
import { toCacheUrl } from "@main/utils/protocol";
import { toMs } from "@main/utils/time";
import { parseArtists, parseAlbum } from "@main/utils/metadata";
import { getCoverCacheDir } from "@main/utils/config";
import { libraryLog } from "@main/utils/logger";

let scanning = false;

/**
 * Rust 扫描/探测结果 → 数据库 Upsert 记录
 * id 由文件路径哈希生成，标签编辑回灌与扫描共用此规则
 */
export const scannedToUpsert = (track: JsScannedTrack): UpsertTrack => {
  const id = createHash("sha256").update(track.path).digest("hex").slice(0, 16);
  return {
    id,
    path: track.path,
    title: track.title || track.path.split(/[/\\]/).pop() || track.path,
    artists: parseArtists(track.artist ?? ""),
    album: parseAlbum(track.album ?? ""),
    duration: toMs(track.duration),
    cover: toCacheUrl(track.cover),
    codec: track.codec,
    sampleRate: track.sampleRate,
    bitRate: track.bitRate,
    channels: track.channels,
    bitsPerSample: track.bitsPerSample,
    fileSize: track.fileSize,
    mtime: track.mtime,
    ctime: track.ctime,
  };
};

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
    (event: JsScanEvent) => {
      switch (event.eventType) {
        case "progress": {
          // 已取消则丢弃滞后批次，避免写回已删除目录的曲目
          if (!scanning) break;
          // 批量写入数据库
          if (event.tracks && event.tracks.length > 0) {
            upsertTracks(event.tracks.map(scannedToUpsert));
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
      }
    },
    getCoverCacheDir(),
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
