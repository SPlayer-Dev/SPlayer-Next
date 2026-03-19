import { createHash } from "node:crypto";
import { ipcMain, dialog, powerMonitor } from "electron";
import { loadNativeModule } from "../utils/nativeLoader";
import { coverCacheDir } from "../core/index";
import { broadcast } from "../utils/broadcast";
import { toCoverUrl } from "../utils/protocol";
import { toMs } from "../utils/time";
import { mediaService } from "../services/media";
import type { MediaEvent } from "../services/media";

type AudioEngineModule = typeof import("@splayer/audio-engine");

let audioEngine: AudioEngineModule | null = null;
let playerInstance: InstanceType<AudioEngineModule["AudioPlayer"]> | null = null;

/** 上一次推送给系统媒体控件的状态，用于避免重复发送 */
let lastMediaState: string | null = null;

/** 是否已注册原生事件回调 */
let nativeEventRegistered = false;

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

/**
 * 获取播放器实例
 * 仅在首次创建时设置封面缓存目录并注册原生事件回调
 */
const player = (): InstanceType<AudioEngineModule["AudioPlayer"]> => {
  if (!playerInstance) {
    const mod = engine();
    playerInstance = new mod.AudioPlayer();
    playerInstance.setCoverCacheDir(coverCacheDir);
  }

  // 注册原生事件回调（仅一次）
  if (!nativeEventRegistered) {
    nativeEventRegistered = true;
    playerInstance.onEvent((event: { type: string; state?: string; position?: number; duration?: number; fftData?: number[] }) => {
      switch (event.type) {
        case "stateChanged": {
          const state = event.state ?? "idle";
          // 同步到系统媒体控件
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
              position: toMs(playerInstance!.getPosition()),
              duration: toMs(playerInstance!.getDuration()),
              volume: playerInstance!.getVolume(),
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
          // 只推送位置，不碰状态，避免竞态覆盖
          broadcast("player:event", {
            type: "position",
            data: { position: posMs, duration: durMs },
          });
          // 同步进度到系统媒体控件
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
    });
  }

  return playerInstance;
};

/** 注册播放器相关的所有 IPC 事件 */
export const registerPlayerIpc = (): void => {
  // 加载音频文件
  ipcMain.handle("player:load", (_event, source: string) => {
    broadcast("player:event", {
      type: "status",
      data: { state: "loading", position: 0, duration: 0, volume: 0, isFinished: false },
    });

    try {
      const inst = player();
      const meta = inst.load(source);

      // 向系统媒体控件发送元数据（getCoverRaw 返回的已是 Buffer，无需再复制）
      const title = meta.title ?? "";
      const artist = meta.artist ?? "";
      const album = meta.album ?? "";
      const durationMs = toMs(meta.duration);

      mediaService.setMetadata({
        title,
        artist,
        album,
        coverData: inst.getCoverRaw() ?? undefined,
        durationMs,
      });
      lastMediaState = "playing";
      mediaService.setPlayState({ status: "Playing" });

      // 本地文件 ID：路径的短 hash
      const trackId = createHash("sha256").update(source).digest("hex").slice(0, 16);

      const data = {
        track: {
          id: trackId,
          source: "local",
          path: source,
          title: title || source.split(/[/\\]/).pop() || source,
          artists: artist ? [{ name: artist }] : [],
          album: album ? { name: album } : undefined,
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
      return { success: false, error: String(error) };
    }
  });

  // 恢复播放
  ipcMain.handle("player:play", () => {
    try {
      player().play();
      return { success: true };
    } catch (error) {
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

  // 注册系统媒体事件处理（系统按键 → 控制播放器）
  mediaService.onEvent((event: MediaEvent) => {
    try {
      const inst = player();
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
        // NextTrack / PrevTrack 等需要播放列表支持，后续实现
      }
    } catch {}
  });

  // 系统休眠唤醒后重建音频输出设备（OutputStream 句柄在休眠后会失效）
  // Rust 侧 reinitOutput 会自动保存并恢复播放状态（位置、暂停/播放），对用户无感
  powerMonitor.on("resume", () => {
    if (!playerInstance) return;
    try {
      playerInstance.reinitOutput();
    } catch (error) {
      console.error("[Player] 唤醒后重建音频输出失败:", error);
      // 重建失败时通知前端回到停止状态
      broadcast("player:event", {
        type: "status",
        data: { state: "stopped", position: 0, duration: 0, volume: 0, isFinished: false },
      });
    }
  });

};
