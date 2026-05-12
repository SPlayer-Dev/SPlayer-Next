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

/** 防抖窗口 */
const FLUSH_DEBOUNCE_MS = 200;
let flushTimer: NodeJS.Timeout | null = null;

/** 同步写盘的内部实现 */
const writeNow = (config: SystemConfig): void => {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    atomicWriteSync(configPath, JSON.stringify(config, null, 2));
  } catch {}
};

/** 立即写盘 */
const flushImmediate = (config: SystemConfig): void => {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  writeNow(config);
};

/**
 * 将配置写入磁盘
 * @param config 配置对象
 */
const flush = (config: SystemConfig): void => {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    writeNow(config);
  }, FLUSH_DEBOUNCE_MS);
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

  // 初始化立即落盘
  flushImmediate(data);
  return data;
};

/** 配置存储 */
let data: SystemConfig = init();

app.on("before-quit", () => {
  flushImmediate(data);
});

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

  /** 用导入的配置替换当前配置 */
  replaceAll(input: unknown): void {
    const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    data = deepMerge(defaultSystemConfig, raw);
    flushImmediate(data);
  },
};
