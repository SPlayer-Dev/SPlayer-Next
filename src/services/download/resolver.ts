/**
 * 下载地址/歌词即时解析服务
 *
 * 批量下载整批入队后，主进程在轮到某任务且缺少 URL 时广播 download:resolve，
 * 这里解析 URL 与歌词后回传。解析请求因此保持一次一首，避免集中请求触发服务端风控。
 */
import type { DownloadResolution, DownloadResolvePayload } from "@shared/types/download";
import i18n from "@/i18n";
import { resolveDownloadSource } from "@/services/download/source";
import { resolveDownloadLyric } from "@/services/download/lyric";
import { buildDownloadLyric } from "@/utils/lyric/serialize";
import { toast } from "@/composables/useToast";

/** 解析单个任务的 URL 与歌词 */
const resolvePayload = async (payload: DownloadResolvePayload): Promise<DownloadResolution> => {
  const source = await resolveDownloadSource(
    payload.track,
    payload.qualityLevel,
    payload.usePlaybackForDownload,
  );
  if (!source) throw new Error("no download source");
  const { tagOptions } = payload;
  let lyricText: string | undefined;
  let ttmlText: string | undefined;
  if (tagOptions.embedLyric || tagOptions.writeLrc || tagOptions.saveTtml) {
    const lyric = await resolveDownloadLyric(payload.track);
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
        lyricText = buildDownloadLyric(input, lyric.format, payload.lyricFileFormat) ?? undefined;
      }
      // 完整 TTML 单独导出
      if (tagOptions.saveTtml) {
        ttmlText = buildDownloadLyric(input, lyric.format, "ttml") ?? undefined;
      }
    }
  }
  return {
    url: source.url,
    declaredFormat: source.format,
    declaredSize: source.size,
    lyricText,
    ttmlText,
  };
};

/** 注册解析请求监听 */
export const initDownloadResolver = (): (() => void) =>
  window.api.download.onResolve((payload) => {
    resolvePayload(payload)
      .then((res) => window.api.download.submitResolution(payload.taskId, res))
      .catch(() => {
        toast.error(i18n.global.t("download.resolveFailed", { title: payload.track.title }));
        void window.api.download.failResolution(payload.taskId);
      });
  });
