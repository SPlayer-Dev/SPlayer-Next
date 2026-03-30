import { loadNativeModule } from "../utils/nativeLoader";
import { broadcast } from "../utils/broadcast";
import { mediaLog, nativeLogsDir } from "../utils/logger";
import { isDev } from "../utils/config";
import { store } from "../store";
import type { MediaEvent, MetadataParam, PlayStateParam, TimelineParam } from "@splayer/media-ctrl";
import type { DiscordDisplayMode, DiscordSettings } from "@shared/types/settings";

export type { MediaEvent, MetadataParam, PlayStateParam, TimelineParam };

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
      broadcast("media:event", event);
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

/** 注册系统媒体事件处理器（播放/暂停/上下首等） */
export const onEvent = (handler: (event: MediaEvent) => void): void => {
  eventHandler = handler;
};

/** 更新歌曲元数据 */
export const setMetadata = (param: MetadataParam): void => safeCall(() => mc?.setMetadata(param));

/** 更新播放状态 */
export const setPlayState = (param: PlayStateParam): void =>
  safeCall(() => mc?.setPlayState(param));

/** 更新播放进度 */
export const setTimeline = (param: TimelineParam): void => safeCall(() => mc?.setTimeline(param));

/** 更新播放速率 */
export const setRate = (rate: number): void => safeCall(() => mc?.setRate(rate));

/** 更新音量 */
export const setVolume = (volume: number): void => safeCall(() => mc?.setVolume(volume));
