import type { Track } from "@shared/types/player";
import type { DownloadRequest, DownloadTagOptions, DownloadTask } from "@shared/types/download";
import { QUALITY_LABELS, type QualityLevel } from "@/utils/quality";
import { useSettingsStore } from "@/stores/settings";
import { resolveDownloadSource } from "@/services/downloadSource";
import { resolveDownloadLyric } from "@/services/downloadLyric";
import { buildDownloadLyric } from "@/utils/lyric/serialize";
import { toast } from "@/composables/useToast";

/** 下载选项 */
interface EnqueueOptions {
  /** 临时音质，覆盖设置 */
  quality?: QualityLevel;
  /** 复用已有任务 id（重试） */
  taskId?: string;
  /** 禁用多余提示 */
  quiet?: boolean;
}

/** 可下载音质档位（展示顺序） */
const DOWNLOAD_QUALITY_LEVELS: QualityLevel[] = ["hi-res", "lossless", "hq", "sq", "lq"];

/** 解析下载地址时间间隔 */
const BATCH_RESOLVE_INTERVAL_MS = 500;

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

  /** 解析 URL + 歌词并组装下载请求；解析失败时 toast 并返回 null */
  const prepareRequest = async (
    track: Track,
    opts: EnqueueOptions,
  ): Promise<DownloadRequest | null> => {
    if (track.source === "local") return null;
    const download = useSettingsStore().system.download;
    const level = opts.quality ?? download.quality;
    const source = await resolveDownloadSource(track, level);
    if (!source) {
      toast.error(t("download.resolveFailed", { title: track.title }));
      return null;
    }
    const tagOptions: DownloadTagOptions = {
      embedCover: download.embedCover,
      embedMeta: download.embedMeta,
      embedLyric: download.embedLyric,
      writeLrc: download.writeLrc,
      saveTtml: download.saveTtml,
    };
    let lyricText: string | undefined;
    let ttmlText: string | undefined;
    if (tagOptions.embedLyric || tagOptions.writeLrc || tagOptions.saveTtml) {
      const lyric = await resolveDownloadLyric(track);
      if (lyric) {
        const input = {
          content: lyric.content,
          translation: lyric.translation,
          translationFormat: lyric.translationFormat,
          romaji: lyric.romaji,
          romajiFormat: lyric.romajiFormat,
        };
        // 内嵌与 .lrc 文件共用所选格式（lrc/增强 LRC）
        if (tagOptions.embedLyric || tagOptions.writeLrc) {
          lyricText =
            buildDownloadLyric(input, lyric.format, download.lyricFileFormat) ?? undefined;
        }
        // 完整 TTML 单独导出
        if (tagOptions.saveTtml) {
          ttmlText = buildDownloadLyric(input, lyric.format, "ttml") ?? undefined;
        }
      }
    }
    return {
      taskId: opts.taskId ?? crypto.randomUUID(),
      track,
      qualityLevel: level,
      url: source.url,
      declaredFormat: source.format,
      declaredSize: source.size,
      coverUrl: track.coverOriginal ?? track.cover,
      lyricText,
      ttmlText,
      tagOptions,
    };
  };

  /**
   * 单曲下载（不等待完成）
   * @returns 是否成功入队
   */
  const enqueue = async (track: Track, opts: EnqueueOptions = {}): Promise<boolean> => {
    const req = await prepareRequest(track, opts);
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
    if (opts.taskId === undefined && !opts.quiet)
      toast.success(t("download.started", { title: track.title }));
    return true;
  };

  /** 批量下载：每秒解析并加入2个曲目防止触碰网易云API频率上限 */
  const enqueueMany = async (tracks: Track[]): Promise<void> => {
    const downloadable = tracks.filter((track) => track.source !== "local");
    if (downloadable.length === 0) return;
    let successCount = 0;
    for (const [index, track] of downloadable.entries()) {
      const success = await enqueue(track, { quiet: true });
      if (success) successCount++;
      if (index < downloadable.length - 1) {
        if (success)
          toast.info(
            t("download.enqueuing", {
              title: track.title,
              count: successCount,
              total: downloadable.length,
            }),
          );
        await new Promise((resolve) => setTimeout(resolve, BATCH_RESOLVE_INTERVAL_MS));
      }
    }
    toast.success(t("download.enqueued", { count: successCount, total: downloadable.length }));
  };

  /** 重试：用任务保存的完整 Track 重新解析并入队 */
  const retry = (task: DownloadTask): Promise<boolean> =>
    enqueue(task.track, { quality: task.qualityLevel, taskId: task.taskId });

  return { enqueue, enqueueMany, retry };
};
