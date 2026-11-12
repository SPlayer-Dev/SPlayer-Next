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
import { isAppQuitting } from "@main/utils/lifecycle";

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

/** 退出卡住时用于定位的当前阶段 */
let quitStage = "";

/** 按依赖顺序等待清理任务，单项失败不阻止后续资源释放 */
const runCleanupTasks = async (): Promise<void> => {
  for (const [name, cleanup] of cleanupTasks) {
    quitStage = name;
    try {
      await cleanup();
    } catch (error) {
      coreLog.error("退出清理失败：" + name, error);
    }
  }
  quitStage = "关闭窗口";
};

/** 注册应用退出处理，等待全部清理任务后退出 */
export const initAppLifecycle = (): void => {
  // 所有窗口关闭时退出应用
  app.on("window-all-closed", () => {
    // 退出流程中关掉的最后一个窗口会让 Electron 复位内部退出标记，关窗后不再进入
    // will-quit；此时清理已完成，补一次退出调用把流程收尾
    if (isAppQuitting() || process.platform !== "darwin") {
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
    // 清理和关窗都可能卡住，进程正常退出时计时器随之消失
    setTimeout(() => {
      coreLog.error("应用退出超过 10 秒，强制结束进程，卡在：" + quitStage);
      app.exit(1);
    }, 10_000);
    void runCleanupTasks().finally(() => {
      cleanupFinished = true;
      app.quit();
    });
  });
};
