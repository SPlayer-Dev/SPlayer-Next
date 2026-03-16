import { ipcMain, BrowserWindow, dialog, app } from "electron";
import path from "node:path";
import { loadNativeModule } from "../utils/nativeLoader";

type AudioEngineModule = typeof import("@splayer/audio-engine");

let audioEngine: AudioEngineModule | null = null;
let player: InstanceType<AudioEngineModule["AudioPlayer"]> | null = null;
let positionTimer: ReturnType<typeof setInterval> | null = null;

/** 获取原生音频引擎模块（懒加载） */
const getEngine = (): AudioEngineModule => {
  if (!audioEngine) {
    audioEngine = loadNativeModule<AudioEngineModule>(
      "audio-engine.node",
      "audio-engine",
    );
    if (!audioEngine) {
      throw new Error("[Player] Failed to load audio-engine.node");
    }
  }
  return audioEngine;
};

/** 获取播放器实例（懒加载），首次创建时设置封面缓存目录 */
const getPlayer = (): InstanceType<AudioEngineModule["AudioPlayer"]> => {
  if (!player) {
    const engine = getEngine();
    player = new engine.AudioPlayer();
    // 设置封面缓存目录
    const coverCacheDir = path.join(app.getPath("userData"), "cover-cache");
    player.setCoverCacheDir(coverCacheDir);
  }
  return player;
};

/** 将封面本地路径转为 splayer-file:// 协议 URL */
const toCoverUrl = (coverPath: string | undefined | null): string | undefined => {
  if (!coverPath) return undefined;
  const normalized = coverPath.replace(/\\/g, "/");
  return `splayer-file:///${normalized}`;
};

/** 向所有窗口广播事件 */
const broadcast = (channel: string, data: unknown): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
};

/** 启动 30fps 播放状态推送 */
const startPositionPush = (): void => {
  stopPositionPush();
  positionTimer = setInterval(() => {
    const p = getPlayer();
    const status = p.getStatus();
    broadcast("player:event", { type: "status", data: status });

    // 自动检测播放结束
    if (status.isFinished && status.state === "playing") {
      broadcast("player:event", { type: "ended" });
      stopPositionPush();
    }
  }, 33);
};

/** 停止播放状态推送 */
const stopPositionPush = (): void => {
  if (positionTimer !== null) {
    clearInterval(positionTimer);
    positionTimer = null;
  }
};

/** 注册播放器相关的所有 IPC 事件 */
export const registerPlayerIpc = (): void => {
  // 加载音频文件，返回完整元信息（含封面路径和歌词），只打开一次 FFmpeg
  ipcMain.handle("player:load", (_event, source: string) => {
    try {
      const metadata = getPlayer().load(source);
      // 将封面路径转为协议 URL
      metadata.coverPath = toCoverUrl(metadata.coverPath);
      startPositionPush();
      return { success: true, data: metadata };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 恢复播放
  ipcMain.handle("player:play", () => {
    try {
      getPlayer().play();
      startPositionPush();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 暂停播放
  ipcMain.handle("player:pause", () => {
    try {
      getPlayer().pause();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 停止播放并释放资源
  ipcMain.handle("player:stop", () => {
    try {
      getPlayer().stop();
      stopPositionPush();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 跳转到指定播放位置（秒）
  ipcMain.handle("player:seek", (_event, position: number) => {
    try {
      getPlayer().seek(position);
      startPositionPush();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 设置音量（0.0 ~ 1.0）
  ipcMain.handle("player:setVolume", (_event, volume: number) => {
    try {
      getPlayer().setVolume(volume);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
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
      return { success: false, error: String(error) };
    }
  });

  // 获取当前渐变时长（毫秒）
  ipcMain.handle("player:getFadeDuration", () => {
    return { success: true, data: getPlayer().getFadeDuration() };
  });

  // 获取当前播放状态快照
  ipcMain.handle("player:getStatus", () => {
    return { success: true, data: getPlayer().getStatus() };
  });

  // 获取 FFT 频谱数据（128 个频段，值域 0.0 ~ 1.0）
  ipcMain.handle("player:getFftData", () => {
    return { success: true, data: getPlayer().getFftData() };
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
};
