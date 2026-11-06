import { app } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { AutoMixComponentId } from "@shared/types/automix";

/**
 * 便携模式：将 userData 重定向到 exe 同级 UserData 目录
 *
 * electron-builder 的便携版会注入 PORTABLE_EXECUTABLE_DIR，此时把整个 userData
 * （含 Chromium 缓存与下方 app-data）落到 exe 同级目录，实现免安装、可整体拷贝
 */
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  const portableUserData = path.join(process.env.PORTABLE_EXECUTABLE_DIR, "UserData");
  if (!existsSync(portableUserData)) mkdirSync(portableUserData, { recursive: true });
  app.setPath("userData", portableUserData);
}

/**
 * 统一数据根目录
 *
 * 所有应用自定义数据（配置 / 数据库 / 缓存 / 日志 / 插件）集中存放于此，
 * 与 Chromium 自建的 Cache/ GPUCache/ 等隔开，便于备份与后续便携版整体迁移。
 * 仅需改这一处即可整体改变数据落点（如便携版指向 exe 同级目录）。
 */
export const dataRoot = path.join(app.getPath("userData"), "app-data");

/** 配置目录：settings.json / streaming.json / lastfm.json */
export const configDir = path.join(dataRoot, "config");

/** 数据库目录：library.db */
export const databaseDir = path.join(dataRoot, "database");

/** 默认缓存根目录：covers / artists / backgrounds / songs */
export const defaultCacheDir = path.join(dataRoot, "cache");

/** 日志根目录：应用日志 + native/ */
export const logsDir = path.join(dataRoot, "logs");

/** 插件根目录：scripts / data / logs */
export const pluginsDir = path.join(dataRoot, "plugins");

/** 用户手动下载的模型和独立推理运行时 */
export const modelsDir = path.join(dataRoot, "models");

/** AutoMix 各组件独立的安装目录，升级某组件只改它的目录，其余组件已安装的文件继续有效 */
export const automixDirs: Record<AutoMixComponentId, string> = {
  beat: path.join(modelsDir, "automix-v2", "beat"),
  demucs: path.join(modelsDir, "automix-v2", "demucs"),
  runtime: path.join(modelsDir, "automix-v2", "runtime"),
};

/** 有界分离窗口缓存，首次分析时回收上一会话 */
export const automixCacheDir = path.join(defaultCacheDir, "automix");
