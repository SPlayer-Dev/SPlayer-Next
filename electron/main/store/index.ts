import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { defaultSystemConfig } from "@shared/defaults/settings";
import type { SystemConfig } from "@shared/types/settings";
import type { ConfigPath, PathValue } from "./types";
import { deepMerge, getByPath, setByPath } from "./utils";
import { migrations } from "./migrations";

/** 配置文件路径 */
const configPath = path.join(app.getPath("userData"), "settings.json");
/** 配置版本键名 */
const META_KEY = "__configVersion";

/** 读取配置文件 */
const readFile = (): Record<string, unknown> => {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
};

/**
 * 将配置写入磁盘
 * @param config 配置对象
 */
const flush = (config: SystemConfig): void => {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    atomicWriteSync(configPath, JSON.stringify(config, null, 2));
  } catch {}
};

/**
 * 加载配置、执行迁移、回写磁盘
 * @returns 配置对象
 */
const init = (): SystemConfig => {
  const raw = readFile();
  const data = deepMerge(defaultSystemConfig, raw);

  let currentVersion: number = (raw[META_KEY] as number) ?? 0;
  const pending = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);
  for (const m of pending) {
    m.migrate(data);
    currentVersion = m.version;
  }
  if (pending.length > 0) {
    (data as unknown as Record<string, unknown>)[META_KEY] = currentVersion;
  }

  flush(data);
  return data;
};

/** 配置存储 */
let data: SystemConfig = init();

/** 配置存储 */
export const store = {
  /**
   * 获取配置存储
   * @returns 配置存储
   */
  get store(): SystemConfig {
    return data;
  },

  /**
   * 获取配置值
   * @param keyPath 配置键路径
   * @returns 配置值
   */
  get<P extends ConfigPath>(keyPath: P): PathValue<SystemConfig, P> {
    return getByPath(data, keyPath) as PathValue<SystemConfig, P>;
  },

  /**
   * 设置配置值
   * @param keyPath 配置键路径
   * @param value 配置值
   * @returns 配置对象
   */
  set(keyPath: ConfigPath | (string & {}), value: unknown): void {
    setByPath(data, keyPath, value);
    flush(data);
  },

  /** 清空配置 */
  clear(): void {
    data = structuredClone(defaultSystemConfig);
    flush(data);
  },
};
