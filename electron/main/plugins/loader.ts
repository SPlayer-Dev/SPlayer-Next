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

/** lx 脚本头部的 JSDoc 字段。字段长度上限参考 lx */
const FIELD_LIMITS: Record<string, number> = {
  name: 24,
  description: 256,
  author: 56,
  homepage: 1024,
  version: 36,
};

const HEADER_RE = /^\s*\*\s*@(\w+)\s+(.+?)\s*$/;

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
  // 只取第一块块注释 /** ... */
  const commentEnd = source.indexOf("*/");
  if (commentEnd < 0) return out;
  const commentStart = source.indexOf("/**");
  if (commentStart < 0 || commentStart > commentEnd) return out;

  const block = source.slice(commentStart + 3, commentEnd);
  for (const rawLine of block.split(/\r?\n/)) {
    const m = HEADER_RE.exec(rawLine);
    if (!m) continue;
    const key = m[1];
    const val = m[2];
    const limit = FIELD_LIMITS[key];
    const trimmed = limit ? val.slice(0, limit) : val;
    switch (key) {
      case "name":
      case "description":
      case "version":
      case "author":
      case "homepage":
        out[key] = trimmed;
        break;
      case "platform":
        out.platform = trimmed === "lx" ? "lx" : "splayer";
        break;
      case "apiLevel": {
        const n = parseInt(trimmed, 10);
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
  name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "plugin";

export interface LoadedScript {
  /** 纯文本源码 */
  source: string;
  /** 完整 manifest（含 id / hash / installedAt） */
  manifest: PluginManifest;
  /** 是否经过 gz_ 解压 */
  decompressed: boolean;
}

/** 从磁盘或原始字符串加载并解析 */
export const loadScript = (
  rawOrPath: string,
  isPath: boolean,
  fileName?: string,
): LoadedScript => {
  const raw = isPath ? fs.readFileSync(rawOrPath, "utf-8") : rawOrPath;
  const wasCompressed = raw.trim().startsWith(GZ_PREFIX);
  const source = decompressIfNeeded(raw);
  const header = parseHeader(source);

  if (!header.name || !header.version) {
    throw Object.assign(new Error("plugin manifest missing @name or @version"), {
      code: PluginErrorCodes.INVALID_MANIFEST,
    });
  }

  const platform: PluginPlatform =
    header.platform ?? (wasCompressed ? "lx" : "splayer");
  const apiLevel = header.apiLevel ?? 1;

  if (apiLevel > HOST_API_LEVEL) {
    throw Object.assign(
      new Error(
        `plugin requires apiLevel ${apiLevel} but host supports ${HOST_API_LEVEL}`,
      ),
      { code: PluginErrorCodes.API_LEVEL_MISMATCH },
    );
  }

  const hash = sha1(source);
  const id = `${slugify(header.name)}-${hash.slice(0, 8)}`;
  const finalFileName = fileName ?? (isPath ? path.basename(rawOrPath) : `${id}.js`);

  const manifest: PluginManifest = {
    id,
    name: header.name,
    version: header.version,
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
