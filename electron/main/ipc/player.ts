import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { app, ipcMain, powerMonitor } from "electron";
import { sendToMain } from "@main/utils/broadcast";
import { wsBroadcast } from "@main/server/broadcast";
import { toCacheUrl } from "@main/utils/protocol";
import { toMs } from "@main/utils/time";
import * as mediaService from "@main/services/media";
import * as nowPlaying from "@main/services/nowPlaying";
import * as lastfm from "@main/services/lastfm";
import { fetchBytes } from "@main/utils/fetchBytes";
import { getPlayer, resetPlayer, onPlayerCreated } from "@main/services/engine";
import { startDevicePolling, stopDevicePolling } from "@main/services/device";
import { getThumbar } from "@main/services/thumbar";
import { setTraySongName, setTrayPlayState, setTrayPlayMode } from "@main/services/tray";
import { getMainWindow, setTaskbarProgress } from "@main/window";
import { store } from "@main/store";
import { appName, getSongCacheDir } from "@main/utils/config";
import * as songCache from "@main/services/songCache";
import { parseArtists, parseAlbum, formatArtists } from "@main/utils/metadata";
import { playerLog } from "@main/utils/logger";
import { ErrorCode } from "@shared/types/errors";
import type { LoadOptions, RepeatMode, ShuffleMode } from "@shared/types/player";
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
  // 自动重建输出的冷却时间戳
  let lastReinitAt = 0;
  const REINIT_COOLDOWN_MS = 5000;
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
        lastfm.onState(state === "playing");
        const statusEvent = {
          type: "status",
          data: {
            state,
            position: toMs(inst.getPosition()),
            duration: toMs(inst.getDuration()),
            volume: inst.getVolume(),
            isFinished: false,
          },
        };
        sendToMain("player:event", statusEvent);
        wsBroadcast(statusEvent);
        break;
      }
      case "ended": {
        sendToMain("player:event", { type: "ended" });
        wsBroadcast({ type: "ended" });
        mediaService.setPlayState({ status: "Paused" });
        lastfm.onEnded();
        setTaskbarProgress(-1);
        break;
      }
      case "sourceError": {
        // 音源失效（网络中断 / URL 过期）
        sendToMain("player:event", { type: "sourceError" });
        mediaService.setPlayState({ status: "Paused" });
        setTaskbarProgress(-1);
        break;
      }
      case "position": {
        const posMs = toMs(event.position ?? 0);
        const durMs = toMs(event.duration ?? 0);
        const positionEvent = {
          type: "position",
          data: { position: posMs, duration: durMs },
        };
        sendToMain("player:event", positionEvent);
        wsBroadcast(positionEvent);
        mediaService.setTimeline({ currentMs: posMs, totalMs: durMs });
        nowPlaying.onPosition(posMs, true);
        lastfm.onPosition();
        if (store.get("system.taskbarProgress") && durMs > 0) setTaskbarProgress(posMs / durMs);
        break;
      }
      case "fftData": {
        const fftEvent = { type: "fftData", data: event.fftData ?? [] };
        sendToMain("player:event", fftEvent);
        wsBroadcast(fftEvent);
        break;
      }
      case "outputStalled": {
        const now = Date.now();
        if (now - lastReinitAt < REINIT_COOLDOWN_MS) break;
        lastReinitAt = now;
        playerLog.warn("检测到音频输出停滞，自动重建");
        try {
          inst.reinitOutput();
        } catch (error) {
          playerLog.error("自动重建音频输出失败:", error);
        }
        break;
      }
    }
  });
};

/** 每次 player:load 自增 */
let loadSeq = 0;

/** 播放器相关 IPC */
export const registerPlayerIpc = (): void => {
  // 注册实例创建/重建时的回调
  onPlayerCreated(registerNativeEvents);
  onPlayerCreated(() => startDevicePolling());
  // 加载音频文件
  ipcMain.handle("player:load", async (_event, source: string, options: LoadOptions = {}) => {
    const autoPlay = options.autoPlay ?? true;
    const authoritative = options.meta ?? null;
    // 非本地音源
    const isRemote = authoritative != null && authoritative.source !== "local";
    const seq = ++loadSeq;
    try {
      const inst = getPlayer();
      const loadingEvent = {
        type: "status",
        data: {
          state: "loading",
          position: 0,
          duration: 0,
          volume: inst.getVolume(),
          isFinished: false,
        },
      };
      sendToMain("player:event", loadingEvent);
      wsBroadcast(loadingEvent);
      // 在线封面原图 URL
      const remoteCover =
        authoritative && authoritative.source !== "local"
          ? (authoritative.coverOriginal ?? authoritative.cover)
          : undefined;
      const coverUrl = remoteCover && /^https?:\/\//i.test(remoteCover) ? remoteCover : undefined;
      // 写一次 SMTC/托盘/标题
      const applyDisplay = (
        title: string,
        artist: string,
        album: string,
        coverData: Buffer | undefined,
        durationMs: number,
      ): void => {
        const header = artist ? `${title} - ${artist}` : title || appName;
        mediaService.setMetadata({ title, artist, album, coverData, coverUrl, durationMs });
        mediaService.setPlayState({ status: autoPlay ? "Playing" : "Paused" });
        getMainWindow()?.setTitle(header);
        setTraySongName(header);
        setTrayPlayState(autoPlay ? "playing" : "paused");
      };
      // 流媒体乐观更新
      if (authoritative) {
        applyDisplay(
          authoritative.title || source.split(/[/\\]/).pop() || source,
          formatArtists(authoritative.artists ?? []),
          authoritative.album?.name ?? "",
          undefined,
          authoritative.duration ?? 0,
        );
      }
      const meta = await inst.load(source, autoPlay);
      const durationMs = toMs(meta.duration);
      const fallbackTitle = meta.title || source.split(/[/\\]/).pop() || source;
      const displayTitle = authoritative?.title ?? fallbackTitle;
      const displayArtist = authoritative
        ? formatArtists(authoritative.artists ?? [])
        : formatArtists(parseArtists(meta.artist ?? ""));
      const displayAlbum = authoritative?.album?.name ?? parseAlbum(meta.album ?? "")?.name ?? "";
      // 本地封面
      const localCover = isRemote ? null : (inst.getCoverRaw() ?? null);
      applyDisplay(displayTitle, displayArtist, displayAlbum, localCover ?? undefined, durationMs);
      // Last.fm
      const primaryArtist =
        authoritative?.artists?.[0]?.name ??
        parseArtists(meta.artist ?? "")[0]?.name ??
        displayArtist;
      lastfm.onTrackLoaded({
        title: displayTitle,
        artist: primaryArtist,
        album: displayAlbum,
        durationMs,
        autoPlay,
      });
      // 远端高清封面
      if (coverUrl) {
        void fetchBytes(coverUrl).then((buf) => {
          if (!buf) return;
          if (seq !== loadSeq) return;
          mediaService.setMetadata({
            title: displayTitle,
            artist: displayArtist,
            album: displayAlbum,
            coverData: buf,
            coverUrl,
            durationMs,
          });
        });
      }
      const quality = {
        sampleRate: meta.originalSampleRate,
        channels: meta.channels,
        bitsPerSample: meta.bitsPerSample,
        bitRate: meta.bitRate,
        codec: meta.codec,
      };
      const data = {
        detail: {
          quality,
          embeddedLyric: meta.embeddedLyric,
          externalLyrics: meta.externalLyrics,
        },
        mediaInfo: {
          duration: durationMs,
          cover: isRemote ? undefined : toCacheUrl(meta.cover),
          quality,
        },
      };
      playerLog.debug(`加载成功: ${displayTitle}`);
      return { success: true, data };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // 被更新的 load/stop 取代是正常竞态结果，不能按源类型误判为网络/解码错误
      //（那两类是可跳曲错误，会让用户的停止操作变成自动跳下一曲）
      if (msg.includes("已被更新的 load 取代")) {
        return fail(ErrorCode.LOAD_SUPERSEDED);
      }
      const isDeviceError = /output device|NoDevice|DeviceNotAvailable/i.test(msg);
      const isNetwork = source.startsWith("http://") || source.startsWith("https://");
      const code = isDeviceError
        ? ErrorCode.DEVICE_NOT_FOUND
        : isNetwork
          ? ErrorCode.NETWORK_ERROR
          : ErrorCode.FILE_DECODE_ERROR;
      // 解码失败的源指向歌曲缓存目录 → 文件已损坏，把这条缓存项作废
      if (code === ErrorCode.FILE_DECODE_ERROR && source.startsWith(getSongCacheDir())) {
        void songCache.invalidate(source);
      }
      return fail(code, error);
    }
  });

  // 恢复播放
  ipcMain.handle("player:play", async () => {
    try {
      await getPlayer().play();
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
  ipcMain.handle("player:seek", async (_event, positionMs: number) => {
    try {
      const positionSecs = positionMs / 1000;
      await getPlayer().seek(positionSecs);
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

  // 启用/禁用均衡器
  ipcMain.handle("player:setEqualizerEnabled", (_event, enabled: boolean) => {
    try {
      getPlayer().setEqualizerEnabled(enabled);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 更新均衡器频段增益（dB 数组，长度 10）
  ipcMain.handle("player:setEqualizerBands", (_event, gainsDb: number[]) => {
    try {
      getPlayer().setEqualizerBands(gainsDb);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 设置前级增益（dB）
  ipcMain.handle("player:setPreampGain", (_event, preampDb: number) => {
    try {
      getPlayer().setPreampGain(preampDb);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 设置播放速度（0.5 ~ 2.0），引擎侧自动 clamp
  ipcMain.handle("player:setSpeed", (_event, speed: number) => {
    try {
      getPlayer().setSpeed(speed);
      nowPlaying.onSpeedChange(speed);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 设置音调偏移（半音 -12 ~ 12），引擎侧自动 clamp
  ipcMain.handle("player:setPitch", (_event, semitones: number) => {
    try {
      getPlayer().setPitch(semitones);
      return { success: true };
    } catch (error) {
      return fail(ErrorCode.UNKNOWN, error);
    }
  });

  // 设置"音调同步"开关（true = 变速保音调）
  ipcMain.handle("player:setPitchSync", (_event, sync: boolean) => {
    try {
      getPlayer().setPitchSync(sync);
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
  // 后缀白名单：该通道只服务歌词文件，防止被当成任意文件读取接口
  // 必须与引擎扫描列表一致（native/audio-engine/src/metadata.rs 的 LYRIC_EXTENSIONS）
  const LYRIC_FILE_EXTS = new Set([
    ".ttml",
    ".lys",
    ".qrc",
    ".krc",
    ".yrc",
    ".lrc",
    ".ass",
    ".srt",
  ]);
  ipcMain.handle("player:readLyricFile", async (_event, filePath: string) => {
    try {
      const ext = extname(filePath).toLowerCase();
      if (!LYRIC_FILE_EXTS.has(ext)) {
        return fail(ErrorCode.UNKNOWN, new Error(`不支持的歌词文件类型: ${ext}`));
      }
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
    sendToMain("player:event", { type });
  });

  // 系统媒体事件处理
  mediaService.onEvent((event: MediaEvent) => {
    try {
      const inst = getPlayer();
      switch (event.type) {
        case "Play":
          void inst.play().catch(() => {});
          break;
        case "Pause":
          inst.pause();
          break;
        case "Stop":
          inst.stop();
          break;
        case "Seek":
          if (event.positionMs != null) {
            const targetMs = event.positionMs;
            void inst.seek(targetMs / 1000).then(() => {
              mediaService.setTimeline({
                currentMs: targetMs,
                totalMs: toMs(inst.getDuration()),
                seeked: true,
              });
            });
          }
          break;
        case "SetVolume":
          if (event.volume != null) {
            inst.setVolume(event.volume);
          }
          break;
        case "NextTrack":
          sendToMain("player:event", { type: "next" });
          break;
        case "PrevTrack":
          sendToMain("player:event", { type: "prev" });
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
    stopDevicePolling();
    const stoppedEvent = {
      type: "status",
      data: { state: "stopped", position: 0, duration: 0, volume: 1, isFinished: false },
    };
    sendToMain("player:event", stoppedEvent);
    wsBroadcast(stoppedEvent);
  };
  powerMonitor.on("resume", resumeHandler);
  // 退出前停止设备轮询
  app.on("before-quit", stopDevicePolling);
};
