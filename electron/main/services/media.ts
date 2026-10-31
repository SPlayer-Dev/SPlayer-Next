import { loadNativeModule } from "@main/utils/nativeLoader";
import { mediaLog, nativeLogsDir } from "@main/utils/logger";
import { isDev } from "@main/utils/config";
import { store } from "@main/store";
import * as nowPlaying from "@main/services/nowPlaying";
import type { MediaEvent, MetadataParam, PlayStateParam, TimelineParam } from "@splayer/media-ctrl";
import type { DiscordDisplayMode, DiscordSettings } from "@shared/types/settings";

type MediaCtrlModule = typeof import("@splayer/media-ctrl");

/** DiscordDisplayMode 映射到 media-ctrl 的枚举值 */
const DISCORD_MODE_MAP: Record<DiscordDisplayMode, "Name" | "State" | "Details"> = {
  name: "Name",
  state: "State",
  details: "Details",
};

let mc: MediaCtrlModule | null = null;
let eventHandler: ((event: MediaEvent) => void) | null = null;

/** 安全调用原生方法 */
const safeCall = (fn: () => void): void => {
  try {
    fn();
  } catch (error) {
    mediaLog.error("media-ctrl 调用失败:", error);
  }
};

/** 应用 Discord RPC 配置 */
const applyDiscordConfig = (discord?: DiscordSettings): void => {
  if (!mc) return;
  discord ??= store.get("media").discord;
  if (discord.enabled) {
    mc.enableDiscord();
  } else {
    mc.disableDiscord();
  }
  mc.setDiscordConfig({
    showWhenPaused: discord.showWhenPaused,
    displayMode: DISCORD_MODE_MAP[discord.displayMode],
  });
};

/** 初始化原生模块并启用系统媒体控件 */
export const init = (): void => {
  mc = loadNativeModule<MediaCtrlModule>("media-ctrl.node", "media-ctrl");
  if (!mc) {
    mediaLog.warn("media-ctrl 模块未找到，媒体集成不可用");
    return;
  }

  try {
    mc.initLogger(nativeLogsDir, isDev);
    mc.initialize();
    mc.onEvent((event) => {
      eventHandler?.(event);
    });
    const mediaConfig = store.get("media");
    if (mediaConfig.systemMediaControls) {
      mc.enable();
    }
    applyDiscordConfig(mediaConfig.discord);
    mediaLog.info("系统媒体控件已初始化");
  } catch (error) {
    mediaLog.error("初始化失败:", error);
  }
};

/** 启用系统媒体控件 */
export const enable = (): void => safeCall(() => mc?.enable());

/** 禁用系统媒体控件 */
export const disable = (): void => safeCall(() => mc?.disable());

/** 重新应用 Discord 配置 */
export const reloadDiscordConfig = (): void => applyDiscordConfig();

/** 关闭并清理资源 */
export const shutdown = (): void => safeCall(() => mc?.shutdown());

/** 响应 MPRIS 扩展元数据开关变更，即时重新发布当前元数据 */
export const syncMprisExtendedMetadata = (enabled: boolean): void => {
  if (!lastMetadataParam) return;
  const currentSnap = nowPlaying.snapshot();
  const plainLyrics =
    enabled && currentSnap.lyric.length > 0
      ? currentSnap.lyric
          .map((l) => (l.words ? l.words.map((w) => w.word).join("") : ""))
          .filter(Boolean)
          .join("\n")
      : undefined;
  const url = enabled ? lastMetadataParam.url : undefined;
  safeCall(() =>
    mc?.setMetadata({
      ...lastMetadataParam!,
      url,
      lyrics: plainLyrics,
    }),
  );
};

/** 注册系统媒体事件处理器（播放/暂停/上下首等） */
export const onEvent = (handler: (event: MediaEvent) => void): void => {
  eventHandler = handler;
};

let lastMetadataParam: MetadataParam | null = null;

/** 获取当前已发布的媒体元数据快照 */
export const getCurrentMetadata = (): MetadataParam | null => lastMetadataParam;

/** 更新歌曲元数据 */
export const setMetadata = (param: MetadataParam): void => {
  if (
    param.lyrics === undefined &&
    lastMetadataParam?.lyrics &&
    lastMetadataParam.title === param.title
  ) {
    param.lyrics = lastMetadataParam.lyrics;
  }
  lastMetadataParam = param;
  safeCall(() => mc?.setMetadata(param));
};

nowPlaying.onLyricChange((snap) => {
  if (!store.get("media.mprisExtendedMetadata")) return;
  if (!lastMetadataParam || !snap.track) return;
  if (snap.lyric && snap.lyric.length > 0) {
    const plainLyrics = snap.lyric
      .map((l) => (l.words ? l.words.map((w) => w.word).join("") : ""))
      .filter(Boolean)
      .join("\n");
    if (plainLyrics && plainLyrics !== lastMetadataParam.lyrics) {
      setMetadata({
        ...lastMetadataParam,
        lyrics: plainLyrics,
      });
    }
  }
});

/** 更新播放状态 */
export const setPlayState = (param: PlayStateParam): void =>
  safeCall(() => mc?.setPlayState(param));

/** 更新播放进度 */
export const setTimeline = (param: TimelineParam): void => safeCall(() => mc?.setTimeline(param));

/** 更新播放速率 */
export const setRate = (rate: number): void => safeCall(() => mc?.setRate(rate));

/** 更新音量 */
export const setVolume = (volume: number): void => safeCall(() => mc?.setVolume(volume));
