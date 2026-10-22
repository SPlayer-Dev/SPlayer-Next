import { app } from "electron";
import { shutdown as shutdownMedia } from "@main/services/media";
import { closeDatabase } from "@main/database";
import { pluginRegistry } from "@main/plugins/registry";
import { dispose as disposePlaybackBridge } from "@main/plugins/playbackBridge";
import { stopServer } from "@main/server";
import { stopMcpServer } from "@main/services/mcp/http";
import { stopStreamingPlayback } from "@main/services/streaming/playback";
import { disposeUpdater } from "@main/services/updater";
import { coreLog } from "@main/utils/logger";

const cleanupTasks: Array<[string, () => void | Promise<void>]> = [
  ["外部 API", stopServer],
  ["MCP", stopMcpServer],
  ["插件", () => pluginRegistry.shutdown()],
  ["播放事件桥", disposePlaybackBridge],
  [
    "流媒体播放会话",
    () =>
      Promise.race([
        stopStreamingPlayback(),
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ]),
  ],
  ["系统媒体", shutdownMedia],
  ["更新服务", disposeUpdater],
  ["数据库", closeDatabase],
];

/** 按依赖顺序等待清理任务，单项失败不阻止后续资源释放 */
const runCleanupTasks = async (): Promise<void> => {
  for (const [name, cleanup] of cleanupTasks) {
    try {
      await cleanup();
    } catch (error) {
      coreLog.error("退出清理失败：" + name, error);
    }
  }
};

/** 注册应用退出处理，等待全部清理任务后退出 */
export const initAppLifecycle = (): void => {
  // 所有窗口关闭时退出应用
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
  let cleanupStarted = false;
  let cleanupFinished = false;
  app.on("before-quit", (event) => {
    if (cleanupFinished) return;
    event.preventDefault();
    if (cleanupStarted) return;
    cleanupStarted = true;
    coreLog.info("应用即将退出，清理资源");
    void runCleanupTasks().finally(() => {
      cleanupFinished = true;
      app.quit();
    });
  });
};
