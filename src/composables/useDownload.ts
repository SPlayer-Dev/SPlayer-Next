import type { Track } from "@shared/types/player";
import type { DownloadRequest, DownloadTagOptions, DownloadTask } from "@shared/types/download";
import { QUALITY_LABELS, type QualityLevel } from "@/utils/quality";
import { useSettingsStore } from "@/stores/settings";
import { toast } from "@/composables/useToast";

/** 下载选项 */
interface EnqueueOptions {
  /** 临时音质，覆盖设置 */
  quality?: QualityLevel;
  /** 复用已有任务 id（重试） */
  taskId?: string;
}

/** 可下载音质档位（展示顺序） */
const DOWNLOAD_QUALITY_LEVELS: QualityLevel[] = ["hi-res", "lossless", "hq", "sq", "lq"];

/**
 * 构建下载音质菜单项
 * @param defaultLabel - 「跟随默认」项文案
 * @param keyPrefix - key 前缀；右键菜单用 "download:" 做路由，空音质表示默认
 */
export const buildDownloadQualityItems = (
  defaultLabel: string,
  keyPrefix = "",
): { key: string; label: string }[] => [
  { key: keyPrefix, label: defaultLabel },
  ...DOWNLOAD_QUALITY_LEVELS.map((quality) => ({
    key: `${keyPrefix}${quality}`,
    label: QUALITY_LABELS[quality],
  })),
];

export const useDownload = () => {
  const { t } = useI18n();

  /**
   * 构建不含网络解析的下载请求
   * @returns 本地曲目返回 null
   */
  const prepareRequest = (track: Track, opts: EnqueueOptions): DownloadRequest | null => {
    if (track.source === "local") return null;
    const download = useSettingsStore().system.download;
    const level = opts.quality ?? download.quality;
    const tagOptions: DownloadTagOptions = {
      embedCover: download.embedCover,
      embedMeta: download.embedMeta,
      embedLyric: download.embedLyric,
      writeLrc: download.writeLrc,
      saveTtml: download.saveTtml,
    };
    return {
      taskId: opts.taskId ?? crypto.randomUUID(),
      track,
      qualityLevel: level,
      coverUrl: track.coverOriginal ?? track.cover,
      tagOptions,
      usePlaybackForDownload: download.usePlaybackForDownload,
      lyricFileFormat: download.lyricFileFormat,
    };
  };

  /**
   * 单曲下载（不等待完成）
   * @returns 是否成功入队
   */
  const enqueue = async (track: Track, opts: EnqueueOptions = {}): Promise<boolean> => {
    const req = prepareRequest(track, opts);
    if (!req) return false;
    const res = opts.taskId
      ? await window.api.download.retry(req)
      : await window.api.download.start(req);
    if (!res.ok) {
      toast.warning(
        res.reason === "downloaded" ? t("download.alreadyDownloaded") : t("download.alreadyQueued"),
      );
      return false;
    }
    if (opts.taskId === undefined) toast.success(t("download.started", { title: track.title }));
    return true;
  };

  /** 批量下载 */
  const enqueueMany = async (tracks: Track[]): Promise<void> => {
    const requests = tracks
      .map((track) => prepareRequest(track, {}))
      .filter((req): req is DownloadRequest => req !== null);
    const results = await window.api.download.startMany(requests).catch(() => []);
    const count = results.filter((result) => result?.ok).length;
    if (count > 0) toast.success(t("download.enqueued", { count }));
  };

  /** 重试：用任务保存的完整 Track 重新入队（复用 taskId） */
  const retry = (task: DownloadTask): Promise<boolean> =>
    enqueue(task.track, { quality: task.qualityLevel, taskId: task.taskId });

  return { enqueue, enqueueMany, retry };
};
