/**
 * 插件脚本加载器
 *
 * - 读取脚本文件（.js 或 gz_ 压缩文本）
 * - 解析头部 JSDoc 元数据（`@name` / `@version` / ...）
 * - 生成稳定的 pluginId（name + sha1(source).slice(0,8)）
 * - 返回 { source, manifest }
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import type { PluginManifest, PluginPlatform } from "@shared/types/plugin";
import { HOST_API_LEVEL, PluginErrorCodes } from "@shared/defaults/plugin-api";

const GZ_PREFIX = "gz_";

/** 脚本头部字段长度上限 */
const FIELD_LIMITS: Record<string, number> = {
  name: 24,
  description: 256,
  author: 56,
  homepage: 1024,
  version: 36,
};

// JSDoc 风格的 `* @key value`
const HEADER_RE = /^\s?\*\s?@(\w+)\s(.+)$/;

// 源码开头的第一个块注释（`/*` 或 `/**` 都行，允许前置空白，非贪婪）
const BLOCK_COMMENT_RE = /^\s*\/\*[\s\S]+?\*\//;

/** 解压 gz_ 前缀脚本；若不是 gz_ 直接返回原文 */
export const decompressIfNeeded = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(GZ_PREFIX)) return raw;
  const payload = trimmed.slice(GZ_PREFIX.length);
  const buf = Buffer.from(payload, "base64");
  return zlib.inflateSync(buf).toString("utf-8");
};

interface HeaderFields {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  homepage?: string;
  platform?: PluginPlatform;
  apiLevel?: number;
}

const parseHeader = (source: string): HeaderFields => {
  const out: HeaderFields = {};
  const m0 = BLOCK_COMMENT_RE.exec(source);
  if (!m0) return out;
  const block = m0[0].slice(2, -2);

  for (const rawLine of block.split(/\r?\n/)) {
    const m = HEADER_RE.exec(rawLine);
    if (!m) continue;
    const key = m[1];
    const raw = m[2].trim();
    const limit = FIELD_LIMITS[key];
    const val = limit && raw.length > limit ? raw.slice(0, limit) + "..." : raw;
    switch (key) {
      case "name":
      case "description":
      case "version":
      case "author":
      case "homepage":
        out[key] = val;
        break;
      case "platform":
        out.platform = val === "lx" ? "lx" : "splayer";
        break;
      case "apiLevel": {
        const n = parseInt(val, 10);
        if (!Number.isNaN(n)) out.apiLevel = n;
        break;
      }
    }
  }
  return out;
};

const sha1 = (data: string): string => crypto.createHash("sha1").update(data).digest("hex");

/** 规范化 name 为 id 可用的 slug */
const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "plugin";

export interface LoadedScript {
  /** 纯文本源码 */
  source: string;
  /** 完整 manifest（含 id / hash / installedAt） */
  manifest: PluginManifest;
  /** 是否经过 gz_ 解压 */
  decompressed: boolean;
}

/** 从磁盘或原始字符串加载并解析 */
export const loadScript = (rawOrPath: string, isPath: boolean, fileName?: string): LoadedScript => {
  const raw = isPath ? fs.readFileSync(rawOrPath, "utf-8") : rawOrPath;
  const wasCompressed = raw.trim().startsWith(GZ_PREFIX);
  const source = decompressIfNeeded(raw);
  const header = parseHeader(source);
  const hash = sha1(source);

  // 稳定兜底——同一脚本 hash 一致，id 就一致
  const name = header.name || `user_api_${hash.slice(0, 6)}`;
  const version = header.version || "0.0.0";

  const platform: PluginPlatform = header.platform ?? (wasCompressed ? "lx" : "splayer");
  const apiLevel = header.apiLevel ?? 1;

  if (apiLevel > HOST_API_LEVEL) {
    throw Object.assign(
      new Error(`plugin requires apiLevel ${apiLevel} but host supports ${HOST_API_LEVEL}`),
      { code: PluginErrorCodes.API_LEVEL_MISMATCH },
    );
  }

  const id = `${slugify(name)}-${hash.slice(0, 8)}`;
  const finalFileName = fileName ?? (isPath ? path.basename(rawOrPath) : `${id}.js`);

  const manifest: PluginManifest = {
    id,
    name,
    version,
    description: header.description,
    author: header.author,
    homepage: header.homepage,
    platform,
    apiLevel,
    hash,
    installedAt: Date.now(),
    fileName: finalFileName,
  };

  return { source, manifest, decompressed: wasCompressed };
};
