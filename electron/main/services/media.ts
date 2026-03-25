import { loadNativeModule } from "../utils/nativeLoader";
import { broadcast } from "../utils/broadcast";
import { mediaLog, nativeLogsDir } from "../utils/logger";
import { isDev } from "../utils/config";
import type { MediaEvent, MetadataParam, PlayStateParam, TimelineParam } from "@splayer/media-ctrl";

export type { MediaEvent, MetadataParam, PlayStateParam, TimelineParam };

type MediaCtrlModule = typeof import("@splayer/media-ctrl");

/**
 * 系统媒体控件服务
 *
 * 封装 media-ctrl 原生模块，提供系统媒体信息同步和事件处理。
 * 数据源在主进程，不走前端 IPC。
 */
class MediaService {
  private mc: MediaCtrlModule | null = null;
  private eventHandler: ((event: MediaEvent) => void) | null = null;

  /** 初始化原生模块并启用系统媒体控件 */
  init(): void {
    this.mc = loadNativeModule<MediaCtrlModule>("media-ctrl.node", "media-ctrl");
    if (!this.mc) {
      mediaLog.warn("media-ctrl 模块未找到，媒体集成不可用");
      return;
    }

    try {
      // 初始化原生日志系统
      this.mc.initLogger(nativeLogsDir, isDev);
      this.mc.initialize();
      this.mc.onEvent((event) => {
        this.eventHandler?.(event);
        broadcast("media:event", event);
      });
      this.mc.enable();
      mediaLog.info("系统媒体控件已初始化");
    } catch (error) {
      mediaLog.error("初始化失败:", error);
    }
  }

  /** 关闭并清理资源 */
  shutdown(): void {
    try {
      this.mc?.shutdown();
    } catch {}
  }

  /** 注册系统媒体事件处理器（播放/暂停/上下首等） */
  onEvent(handler: (event: MediaEvent) => void): void {
    this.eventHandler = handler;
  }

  /** 更新歌曲元数据 */
  setMetadata(param: MetadataParam): void {
    try {
      this.mc?.setMetadata(param);
    } catch {}
  }

  /** 更新播放状态 */
  setPlayState(param: PlayStateParam): void {
    try {
      this.mc?.setPlayState(param);
    } catch {}
  }

  /** 更新播放进度 */
  setTimeline(param: TimelineParam): void {
    try {
      this.mc?.setTimeline(param);
    } catch {}
  }

  /** 更新播放速率 */
  setRate(rate: number): void {
    try {
      this.mc?.setRate(rate);
    } catch {}
  }

  /** 更新音量 */
  setVolume(volume: number): void {
    try {
      this.mc?.setVolume(volume);
    } catch {}
  }
}

/** 媒体控件服务单例 */
export const mediaService = new MediaService();
