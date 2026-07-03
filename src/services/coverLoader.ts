/**
 * 封面兜底加载服务
 *
 * 当前曲目无封面时，向声明 musicPic 的插件源逐个兜底，命中即 patch 到 media store。
 * 主要用于本地文件无内嵌封面、在线封面失效等场景，使全屏播放器大图与背景能补上。
 */

import type { Track } from "@shared/types/player";
import { useMediaStore } from "@/stores/media";
import { usePluginsStore } from "@/stores/plugins";
import { extractColorFromUrl } from "@/utils/color";

/** 竞态 token */
let currentToken = 0;

/**
 * 为当前 track 兜底封面
 * 已有封面则直接跳过、不发任何插件请求；命中后若已切歌则丢弃
 * @param track - 歌曲信息
 */
export const loadCoverForTrack = async (track: Track): Promise<void> => {
  const token = ++currentToken;
  if (track.cover || track.coverOriginal) return;
  const plugins = usePluginsStore();
  for (const info of plugins.list) {
    if (!info.enabled || info.status.state !== "ready") continue;
    for (const [source, cap] of Object.entries(info.status.sources)) {
      if (!cap.actions.includes("musicPic")) continue;
      const resp = await window.api.plugins.matchCover({
        pluginId: info.manifest.id,
        source,
        track,
      });
      if (token !== currentToken) return;
      if (!resp.ok || !resp.data?.url) continue;
      const media = useMediaStore();
      // 期间可能已切歌
      if (media.track?.id !== track.id) return;
      media.patchCover(resp.data.url);
      // 封面晚到，按这张重新提色（加载时那次是空封面，未提到色）
      extractColorFromUrl(resp.data.url);
      return;
    }
  }
};
