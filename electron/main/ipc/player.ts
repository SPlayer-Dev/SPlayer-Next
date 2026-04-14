import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ipcMain, powerMonitor } from "electron";
import { broadcast } from "@main/utils/broadcast";
import { toCacheUrl } from "@main/utils/protocol";
import { toMs } from "@main/utils/time";
import * as mediaService from "@main/services/media";
import * as nowPlaying from "@main/services/nowPlaying";
import { getPlayer, resetPlayer, onPlayerCreated } from "@main/services/engine";
import { startDevicePolling } from "@main/services/device";
import { getThumbar } from "@main/services/thumbar";
import { setTraySongName, setTrayPlayState, setTrayPlayMode } from "@main/services/tray";
import { getMainWindow, setTaskbarProgress } from "@main/window";
import { store } from "@main/store";
import { appName } from "@main/utils/config";
import { parseArtists, parseAlbum, formatArtists } from "@main/utils/metadata";
import { playerLog } from "@main/utils/logger";
import { ErrorCode } from "@shared/types/errors";
import type { RepeatMode, ShuffleMode } from "@shared/types/player";
import type { MediaEvent } from "@main/services/media";
import { JsPlayerEvent } from "@splayer/audio-engine";

type AudioEngineModule = typeof import("@splayer/audio-engine");

/** 返回失败响应，附带日志 */
const fail = (code: ErrorCode, error?: unknown) => {
  if (error) playerLog.error(`${code}:`, error);
  return { success: false as const, error: code };
};

/**
 * 播放器原生事件回调
 * @param inst 播放器实例
 */
const registerNativeEvents = (inst: InstanceType<AudioEngineModule["AudioPlayer"]>): void => {
  inst.onEvent((event: JsPlayerEvent) => {
    switch (event.type) {
      case "stateChanged": {
        const state = event.state ?? "idle";
        // 更新缩略图工具栏和托盘菜单
        getThumbar()?.updateThumbar(state === "playing");
        setTrayPlayState(state === "playing" ? "playing" : "paused");
        if (state === "playing") {
          mediaService.setPlayState({ status: "Playing" });
        } else if (state === "paused") {
          mediaService.setPlayState({ status: "Paused" });
          if (store.get("system.taskbarProgress")) {
            const dur = inst.getDuration();
            if (dur > 0) setTaskbarProgress(inst.getPosition() / dur, true);
          }
        } else if (state === "stopped") {
          mediaService.setPlayState({ status: "Paused" });
          setTaskbarProgress(-1);
        }
        nowPlaying.onPlayStateChange(state === "playing");
        broadcast("player:event", {
          type: "status",
          data: {
            state,
            position: toMs(inst.getPosition()),
            duration: toMs(inst.getDuration()),
            volume: inst.getVolume(),
            isFinished: false,
          },
        });
        break;
      }
      case "ended": {
        broadcast("player:event", { type: "ended" });
        mediaService.setPlayState({ status: "Paused" });
        setTaskbarProgress(-1);
        break;
      }
      case "position": {
        const posMs = toMs(event.position ?? 0);
        const durMs = toMs(event.duration ?? 0);
        broadcast("player:event", {
          type: "position",
          data: { position: posMs, duration: durMs },
        });
        mediaService.setTimeline({ currentMs: posMs, totalMs: durMs });
        nowPlaying.onPosition(posMs, true);
        if (store.get("system.taskbarProgress") && durMs > 0) setTaskbarProgress(posMs / durMs);
        break;
      }
      case "fftData": {
        broadcast("player:event", {
          type: "fftData",
          data: event.fftData ?? [],
        });
        break;
      }
    }
  });
};

/** 播放器相关 IPC */
export const registerPlayerIpc = (): void => {
  // 注册实例创建/重建时的回调
  onPlayerCreated(registerNativeEvents);
  onPlayerCreated(() => startDevicePolling());
  // 加载音频文件
  ipcMain.handle("player:load", (_event, source: string, autoPlay = true) => {
    try {
      const inst = getPlayer();
      broadcast("player:event", {
        type: "status",
        data: {
          state: "loading",
          position: 0,
          duration: 0,
          volume: inst.getVolume(),
          isFinished: false,
        },
      });
      const meta = inst.load(source, autoPlay);
      // 提前解析元数据
      const artists = parseArtists(meta.artist ?? "");
      const artistStr = formatArtists(artists);
      const trackTitle = meta.title || source.split(/[/\\]/).pop() || source;
      const trackAlbum = parseAlbum(meta.album ?? "");
      const durationMs = toMs(meta.duration);
      const trackId = createHash("sha256").update(source).digest("hex").slice(0, 16);
      // 高清封面更新系统媒体控件
      const coverData = inst.getCoverRaw() ?? undefined;
      mediaService.setMetadata({
        title: trackTitle,
        artist: artistStr,
        album: trackAlbum?.name ?? "",
        coverData,
        durationMs,
      });
      const playState = autoPlay ? "Playing" : "Paused";
      mediaService.setPlayState({ status: playState });
      // 更新窗口标题和托盘
      const displayTitle = artistStr ? `${trackTitle} - ${artistStr}` : trackTitle || appName;
      getMainWindow()?.setTitle(displayTitle);
      setTraySongName(displayTitle);
      setTrayPlayState(autoPlay ? "playing" : "paused");
      const data = {
        track: {
          id: trackId,
          source: "local",
          path: source,
          title: trackTitle,
          comment: meta.comment ?? undefined,
          artists,
          album: trackAlbum,
          duration: durationMs,
          cover: toCacheUrl(meta.cover),
        },
        detail: {
          quality: {
            sampleRate: meta.originalSampleRate,
            channels: meta.channels,
            bitsPerSample: meta.bitsPerSample,
            bitRate: meta.bitRate,
            codec: meta.codec,
          },
          embeddedLyric: meta.embeddedLyric,
          externalLyrics: meta.externalLyrics,
        },
      };
      playerLog.debug(`加载成功: ${trackTitle}`);
      return { success: true, data };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isDeviceError = /output device|NoDevice|DeviceNotAvailable/i.test(msg);
      const isNetwork = source.startsWith("http://") || source.startsWith("https://");
      const code = isDeviceError
        ? ErrorCode.DEVICE_NOT_FOUND
        : isNetwork
          ? ErrorCode.NETWORK_ERROR
          : ErrorCode.FILE_DECODE_ERROR;
      return fail(code, error);
    }
  });

  // 恢复播放
  ipcMain.handle("player:play", () => {
    try {
      getPlayer().play();
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.DEVICE_NOT_FOUND, error);
    }
  });

  // 暂停播放
  ipcMain.handle("player:pause", () => {
    try {
      getPlayer().pause();
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 停止播放并释放资源
  ipcMain.handle("player:stop", () => {
    try {
      getPlayer().stop();
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 跳转到指定播放位置
  ipcMain.handle("player:seek", (_event, positionMs: number) => {
    try {
      const positionSecs = positionMs / 1000;
      getPlayer().seek(positionSecs);
      mediaService.setTimeline({
        currentMs: positionMs,
        totalMs: toMs(getPlayer().getDuration()),
        seeked: true,
      });
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 设置音量（0.0 ~ 1.0）
  ipcMain.handle("player:setVolume", (_event, volume: number) => {
    try {
      getPlayer().setVolume(volume);
      mediaService.setVolume(volume);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 获取当前音量
  ipcMain.handle("player:getVolume", () => {
    return { success: true, data: getPlayer().getVolume() };
  });

  // 设置暂停/恢复时的渐变时长（毫秒），0 表示禁用
  ipcMain.handle("player:setFadeDuration", (_event, durationMs: number) => {
    try {
      getPlayer().setFadeDuration(durationMs);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 获取当前渐变时长（毫秒）
  ipcMain.handle("player:getFadeDuration", () => {
    return { success: true, data: getPlayer().getFadeDuration() };
  });

  // 获取当前播放状态快照（转毫秒）
  ipcMain.handle("player:getStatus", () => {
    const raw = getPlayer().getStatus();
    return {
      success: true,
      data: {
        state: raw.state,
        position: toMs(raw.position),
        duration: toMs(raw.duration),
        volume: raw.volume,
        isFinished: raw.isFinished,
      },
    };
  });

  // 重建音频输出设备
  ipcMain.handle("player:reinit", () => {
    try {
      getPlayer().reinitOutput();
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 启用/禁用音量均衡
  ipcMain.handle("player:setNormalizationEnabled", (_event, enabled: boolean) => {
    try {
      getPlayer().setNormalizationEnabled(enabled);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 启用/禁用 FFT 频谱推送（前端组件挂载时启用，卸载时禁用）
  ipcMain.handle("player:setFftEnabled", (_event, enabled: boolean) => {
    try {
      getPlayer().setFftEnabled(enabled);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 获取 FFT 频谱数据（128 个频段，值域 0.0 ~ 1.0）
  ipcMain.handle("player:getFftData", () => {
    return { success: true, data: getPlayer().getFftData() };
  });

  // 按需读取外部歌词文件内容
  ipcMain.handle("player:readLyricFile", async (_event, filePath: string) => {
    try {
      const content = await readFile(filePath, "utf-8");
      return { success: true, data: content };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 获取当前歌曲的原始高清封面（base64 data URL）
  // 用于全屏播放器等需要高清封面的场景，按需调用，不缓存
  ipcMain.handle("player:getCoverRaw", () => {
    try {
      const inst = getPlayer();
      const raw = inst.getCoverRaw();
      if (!raw) return { success: true, data: null };
      // 转为 base64 data URL，用完即丢，不持有引用
      const base64 = Buffer.from(raw).toString("base64");
      return { success: true, data: `data:image/jpeg;base64,${base64}` };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 获取所有音频输出设备
  ipcMain.handle("player:getOutputDevices", () => {
    try {
      return { success: true, data: getPlayer().getOutputDevices() };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 获取系统默认输出设备名称
  ipcMain.handle("player:getDefaultDeviceName", () => {
    try {
      return { success: true, data: getPlayer().getDefaultDeviceName() ?? null };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 切换输出设备（传 null 使用系统默认）
  ipcMain.handle("player:setOutputDevice", (_event, deviceName: string | null) => {
    try {
      getPlayer().setOutputDevice(deviceName ?? undefined);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 获取当前选择的输出设备名称
  ipcMain.handle("player:getSelectedDeviceName", () => {
    try {
      return { success: true, data: getPlayer().getSelectedDeviceName() ?? null };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 渲染进程同步播放模式到托盘
  ipcMain.on("player:syncPlayMode", (_event, repeat: RepeatMode, shuffle: ShuffleMode) => {
    setTrayPlayMode(repeat, shuffle);
  });

  // 转发渲染端发起的播放控制
  ipcMain.on("player:dispatch", (_event, type: string) => {
    broadcast("player:event", { type });
  });

  // 系统媒体事件处理
  mediaService.onEvent((event: MediaEvent) => {
    try {
      const inst = getPlayer();
      switch (event.type) {
        case "Play":
          inst.play();
          break;
        case "Pause":
          inst.pause();
          break;
        case "Stop":
          inst.stop();
          break;
        case "Seek":
          if (event.positionMs != null) {
            inst.seek(event.positionMs / 1000);
            mediaService.setTimeline({
              currentMs: event.positionMs,
              totalMs: toMs(inst.getDuration()),
              seeked: true,
            });
          }
          break;
        case "SetVolume":
          if (event.volume != null) {
            inst.setVolume(event.volume);
          }
          break;
        case "NextTrack":
          broadcast("player:event", { type: "next" });
          break;
        case "PrevTrack":
          broadcast("player:event", { type: "prev" });
          break;
      }
    } catch {}
  });

  // 系统休眠唤醒后重建音频输出设备
  const resumeHandler = async (): Promise<void> => {
    const inst = getPlayer();
    // 延迟重试：系统唤醒后音频子系统可能需要时间恢复
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [500, 1500, 3000];
    for (let i = 0; i < MAX_RETRIES; i++) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[i]));
      try {
        inst.reinitOutput();
        playerLog.info(`唤醒后重建音频输出成功（第 ${i + 1} 次尝试）`);
        return;
      } catch (error) {
        playerLog.warn(`重建音频输出第 ${i + 1} 次失败:`, error);
      }
    }
    // 全部重试失败，销毁损坏的实例
    playerLog.error("重建音频输出全部失败，销毁播放器实例");
    resetPlayer();
    broadcast("player:event", {
      type: "status",
      data: { state: "stopped", position: 0, duration: 0, volume: 1, isFinished: false },
    });
  };
  powerMonitor.on("resume", resumeHandler);
};
