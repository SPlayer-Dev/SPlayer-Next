import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import log from "electron-log/main";
import { isDev } from "./config";

/** 日志根目录：开发模式放 dev 子目录，生产模式直接放 logs/ */
export const logsDir = isDev ? path.join(app.getPath("logs"), "dev") : app.getPath("logs");

/** 原生模块日志目录 */
export const nativeLogsDir = path.join(app.getPath("userData"), "logs", "native");

/**
 * 自动清理超过指定天数的旧日志文件
 */
const autoCleanLogs = (dir: string, daysToKeep: number = 30): void => {
  try {
    if (!existsSync(dir)) return;
    const files = readdirSync(dir);
    const now = Date.now();
    const msToKeep = daysToKeep * 24 * 60 * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(dir, file);
      const stats = statSync(filePath);
      if (now - stats.mtimeMs > msToKeep) {
        unlinkSync(filePath);
      }
    }
  } catch {}
};

/**
 * 初始化日志系统
 *
 * - 日志文件按日期命名：YYYY-MM-DD.log
 * - 开发模式：控制台（debug）+ 文件（info），保留 7 天
 * - 生产模式：控制台（warn）+ 文件（info），保留 30 天
 * - console.log/warn/error/info 重绑到 logger
 */
export const initLogger = (): void => {
  // 确保日志目录存在
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });

  // 按日期命名日志文件
  const dateString = new Date().toISOString().slice(0, 10);
  const logFilePath = path.join(logsDir, `${dateString}.log`);

  // 文件输出配置
  log.transports.file.resolvePathFn = () => logFilePath;
  log.transports.file.maxSize = 2 * 1024 * 1024; // 2MB 单文件上限
  log.transports.file.level = "info";

  // 控制台输出配置
  log.transports.console.useStyles = true;
  log.transports.console.level = isDev ? "debug" : "warn";

  // 捕获未处理的异常和 rejection
  log.errorHandler.startCatching();

  // 重绑 console 到 logger
  const defaultLog = log.scope("default");
  console.log = defaultLog.log;
  console.info = defaultLog.info;
  console.warn = defaultLog.warn;
  console.error = defaultLog.error;

  // 自动清理旧日志
  autoCleanLogs(logsDir, isDev ? 7 : 30);

  log.info(`日志系统已初始化 (${isDev ? "development" : "production"})`);
  log.info(`日志目录: ${logsDir}`);
};

// 分作用域导出
export const coreLog = log.scope("core");
export const playerLog = log.scope("player");
export const mediaLog = log.scope("media");
export const trayLog = log.scope("tray");
export const thumbarLog = log.scope("thumbar");
export const systemLog = log.scope("system");
export const ipcLog = log.scope("ipc");
