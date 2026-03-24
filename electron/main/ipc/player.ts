import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ipcMain, dialog, powerMonitor } from "electron";
import { loadNativeModule } from "../utils/nativeLoader";
import { coverCacheDir } from "../utils/config";
import { broadcast } from "../utils/broadcast";
import { toCoverUrl } from "../utils/protocol";
import { toMs } from "../utils/time";
import { mediaService } from "../services/media";
import { getThumbar } from "../services/thumbar";
import { setTraySongName, setTrayPlayState, setTrayPlayMode } from "../services/tray";
import { getMainWindow } from "../window";
import { appName } from "../utils/config";
import { parseArtists, parseAlbum, formatArtists } from "../utils/metadata";
import type { RepeatMode, ShuffleMode } from "@shared/types/player";
import type { MediaEvent } from "../services/media";

type AudioEngineModule = typeof import("@splayer/audio-engine");

let audioEngine: AudioEngineModule | null = null;
let playerInstance: InstanceType<AudioEngineModule["AudioPlayer"]> | null = null;

/** 上一次推送给系统媒体控件的状态，用于避免重复发送 */
let lastMediaState: string | null = null;

/** 上次加载的源路径，用于 SMTC 封面缓存（同一首歌不重复提取封面） */
let lastCoverSource: string | null = null;
let lastCoverData: Buffer | null = null;

/**
 * 检测错误是否为音频设备丢失
 * 设备丢失后 Rust 实例已损坏，必须销毁重建
 */
const isDeviceError = (error: unknown): boolean => {
  const msg = String(error);
  return msg.includes("device") || msg.includes("output") || msg.includes("stream");
};

/** 销毁损坏的播放器实例，下次调用 player() 时自动重建 */
const resetPlayer = (): void => {
  console.warn("[Player] 销毁播放器实例，将在下次操作时重建");
  playerInstance = null;
  lastMediaState = null;
  lastCoverSource = null;
  lastCoverData = null;
};

/** 获取原生音频引擎模块 */
const engine = (): AudioEngineModule => {
  if (!audioEngine) {
    audioEngine = loadNativeModule<AudioEngineModule>("audio-engine.node", "audio-engine");
    if (!audioEngine) {
      throw new Error("[Player] Failed to load audio-engine.node");
    }
  }
  return audioEngine;
};

/** 轮询检测默认音频设备变化，首次创建播放器时启动 */
let devicePollingStarted = false;
const startDevicePolling = (): void => {
  if (devicePollingStarted) return;
  devicePollingStarted = true;
  let lastDefaultDevice: string | null = null;
  setInterval(() => {
    if (!playerInstance) return;
    try {
      const current = playerInstance.getDefaultDeviceName() ?? null;
      if (lastDefaultDevice !== null && current !== lastDefaultDevice) {
        console.log(`[Player] 检测到默认音频设备变化: ${lastDefaultDevice} → ${current}`);
        const selected = playerInstance.getSelectedDeviceName() ?? null;
        if (selected === null) {
          try {
            playerInstance.reinitOutput();
            console.log("[Player] 已自动切换到新的默认设备");
          } catch (error) {
            console.warn("[Player] 自动切换设备失败:", error);
          }
        }
        broadcast("player:event", {
          type: "deviceChanged",
          data: { defaultDevice: current },
        });
      }
      lastDefaultDevice = current;
    } catch {}
  }, 3000);
};

/** 为播放器实例注册原生事件回调 */
const registerNativeEvents = (inst: InstanceType<AudioEngineModule["AudioPlayer"]>): void => {
  inst.onEvent(
    (event: {
      type: string;
      state?: string;
      position?: number;
      duration?: number;
      fftData?: number[];
    }) => {
      switch (event.type) {
        case "stateChanged": {
          const state = event.state ?? "idle";
          // 更新缩略图工具栏和托盘菜单
          getThumbar()?.updateThumbar(state === "playing");
          setTrayPlayState(state === "playing" ? "playing" : "paused");
          if (state !== lastMediaState) {
            lastMediaState = state;
            if (state === "playing") {
              mediaService.setPlayState({ status: "Playing" });
            } else if (state === "paused") {
              mediaService.setPlayState({ status: "Paused" });
            } else if (state === "stopped") {
              mediaService.setPlayState({ status: "Paused" });
            }
          }
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
          lastMediaState = "stopped";
          broadcast("player:event", { type: "ended" });
          mediaService.setPlayState({ status: "Paused" });
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
    },
  );
};

/**
 * 获取播放器实例
 * 首次创建时设置封面缓存目录并注册原生事件回调
 * resetPlayer() 后会重建实例并重新注册，不会重复注册
 */
const player = (): InstanceType<AudioEngineModule["AudioPlayer"]> => {
  if (!playerInstance) {
    const mod = engine();
    playerInstance = new mod.AudioPlayer();
    playerInstance.setCoverCacheDir(coverCacheDir);
    registerNativeEvents(playerInstance);
    startDevicePolling();
  }
  return playerInstance;
};

/** 注册播放器相关的所有 IPC 事件 */
export const registerPlayerIpc = (): void => {
  // 只读取轻量元数据
  ipcMain.handle("player:probe", (_event, source: string) => {
    try {
      const meta = player().probe(source);
      const title = meta.title ?? "";
      const artist = meta.artist ?? "";
      const album = meta.album ?? "";
      const durationMs = toMs(meta.duration);
      const trackId = createHash("sha256").update(source).digest("hex").slice(0, 16);
      return {
        success: true,
        data: {
          id: trackId,
          source: "local",
          path: source,
          title: title || source.split(/[/\\]/).pop() || source,
          artists: parseArtists(artist),
          album: parseAlbum(album),
          duration: durationMs,
          cover: toCoverUrl(meta.cover),
        },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 加载音频文件
  ipcMain.handle("player:load", (_event, source: string, autoPlay = true) => {
    broadcast("player:event", {
      type: "status",
      data: { state: "loading", position: 0, duration: 0, volume: 0, isFinished: false },
    });
    try {
      const inst = player();
      const meta = inst.load(source, autoPlay);
      // 提前解析元数据
      const artists = parseArtists(meta.artist ?? "");
      const artistStr = formatArtists(artists);
      const trackTitle = meta.title || source.split(/[/\\]/).pop() || source;
      const trackAlbum = parseAlbum(meta.album ?? "");
      const durationMs = toMs(meta.duration);
      const trackId = createHash("sha256").update(source).digest("hex").slice(0, 16);
      // 更新系统媒体控件（同一首歌复用封面缓存，避免重复提取）
      if (source !== lastCoverSource) {
        lastCoverData = inst.getCoverRaw() ?? null;
        lastCoverSource = source;
      }
      mediaService.setMetadata({
        title: trackTitle,
        artist: artistStr,
        album: trackAlbum?.name ?? "",
        coverData: lastCoverData ?? undefined,
        durationMs,
      });
      const playState = autoPlay ? "Playing" : "Paused";
      lastMediaState = autoPlay ? "playing" : "paused";
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
          artists,
          album: trackAlbum,
          duration: durationMs,
          cover: toCoverUrl(meta.cover),
        },
        detail: {
          quality: {
            sampleRate: meta.sampleRate,
            channels: meta.channels,
            bitRate: meta.bitRate,
            codec: meta.codec,
          },
          embeddedLyric: meta.embeddedLyric,
          externalLyrics: meta.externalLyrics,
        },
      };
      return { success: true, data };
    } catch (error) {
      if (isDeviceError(error)) resetPlayer();
      return { success: false, error: String(error) };
    }
  });

  // 恢复播放
  ipcMain.handle("player:play", () => {
    try {
      player().play();
      return { success: true };
    } catch (error) {
      if (isDeviceError(error)) resetPlayer();
      return { success: false, error: String(error) };
    }
  });

  // 暂停播放
  ipcMain.handle("player:pause", () => {
    try {
      player().pause();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 停止播放并释放资源
  ipcMain.handle("player:stop", () => {
    try {
      player().stop();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 跳转到指定播放位置
  ipcMain.handle("player:seek", (_event, positionMs: number) => {
    try {
      const positionSecs = positionMs / 1000;
      player().seek(positionSecs);
      mediaService.setTimeline({
        currentMs: positionMs,
        totalMs: toMs(player().getDuration()),
        seeked: true,
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 设置音量（0.0 ~ 1.0）
  ipcMain.handle("player:setVolume", (_event, volume: number) => {
    try {
      player().setVolume(volume);
      mediaService.setVolume(volume);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 获取当前音量
  ipcMain.handle("player:getVolume", () => {
    return { success: true, data: player().getVolume() };
  });

  // 设置暂停/恢复时的渐变时长（毫秒），0 表示禁用
  ipcMain.handle("player:setFadeDuration", (_event, durationMs: number) => {
    try {
      player().setFadeDuration(durationMs);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 获取当前渐变时长（毫秒）
  ipcMain.handle("player:getFadeDuration", () => {
    return { success: true, data: player().getFadeDuration() };
  });

  // 获取当前播放状态快照（转毫秒）
  ipcMain.handle("player:getStatus", () => {
    const raw = player().getStatus();
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
      player().reinitOutput();
      return { success: true };
    } catch (error) {
      if (isDeviceError(error)) resetPlayer();
      return { success: false, error: String(error) };
    }
  });

  // 启用/禁用 FFT 频谱推送（前端组件挂载时启用，卸载时禁用）
  ipcMain.handle("player:setFftEnabled", (_event, enabled: boolean) => {
    try {
      player().setFftEnabled(enabled);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 获取 FFT 频谱数据（128 个频段，值域 0.0 ~ 1.0）
  ipcMain.handle("player:getFftData", () => {
    return { success: true, data: player().getFftData() };
  });

  // 按需读取外部歌词文件内容
  ipcMain.handle("player:readLyricFile", async (_event, filePath: string) => {
    try {
      const content = await readFile(filePath, "utf-8");
      return { success: true, data: content };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 打开文件选择对话框，返回用户选中的音频文件路径
  ipcMain.handle("player:openFile", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择音频文件",
      filters: [
        {
          name: "音频文件",
          extensions: ["mp3", "flac", "wav", "ogg", "aac", "m4a", "wma", "opus", "ape"],
        },
        { name: "所有文件", extensions: ["*"] },
      ],
      properties: ["openFile"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: "未选择文件" };
    }
    return { success: true, data: result.filePaths[0] };
  });

  // 获取所有音频输出设备
  ipcMain.handle("player:getOutputDevices", () => {
    try {
      return { success: true, data: player().getOutputDevices() };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 获取系统默认输出设备名称
  ipcMain.handle("player:getDefaultDeviceName", () => {
    try {
      return { success: true, data: player().getDefaultDeviceName() ?? null };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 切换输出设备（传 null 使用系统默认）
  ipcMain.handle("player:setOutputDevice", (_event, deviceName: string | null) => {
    try {
      player().setOutputDevice(deviceName ?? undefined);
      return { success: true };
    } catch (error) {
      if (isDeviceError(error)) resetPlayer();
      return { success: false, error: String(error) };
    }
  });

  // 获取当前选择的输出设备名称
  ipcMain.handle("player:getSelectedDeviceName", () => {
    try {
      return { success: true, data: player().getSelectedDeviceName() ?? null };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 渲染进程同步播放模式到托盘
  ipcMain.on("player:syncPlayMode", (_event, repeat: RepeatMode, shuffle: ShuffleMode) => {
    setTrayPlayMode(repeat, shuffle);
  });

  // 注册系统媒体事件处理（系统按键 → 控制播放器）
  mediaService.onEvent((event: MediaEvent) => {
    try {
      const inst = player();
      switch (event.type) {
        case "Play":
          // SMTC 的 Play/Pause 直接操作引擎，不走渲染进程
          // 避免与渲染进程的 nextTrack/onQueueEnded 状态冲突
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
    if (!playerInstance) return;

    // 延迟重试：系统唤醒后音频子系统可能需要时间恢复
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [500, 1500, 3000];

    for (let i = 0; i < MAX_RETRIES; i++) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[i]));
      try {
        playerInstance.reinitOutput();
        console.log(`[Player] 唤醒后重建音频输出成功（第 ${i + 1} 次尝试）`);
        return;
      } catch (error) {
        console.warn(`[Player] 重建音频输出第 ${i + 1} 次失败:`, error);
      }
    }

    // 全部重试失败：销毁损坏的实例，下次操作时会自动重建
    console.error("[Player] 重建音频输出全部失败，销毁播放器实例");
    playerInstance = null;
    lastMediaState = null;

    broadcast("player:event", {
      type: "status",
      data: { state: "stopped", position: 0, duration: 0, volume: 0, isFinished: false },
    });
  };
  powerMonitor.on("resume", resumeHandler);
};
