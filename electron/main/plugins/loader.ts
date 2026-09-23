/**
 * 插件脚本加载器
 *
 * - 读取脚本文件（.js 或 gz_ 压缩文本）
 * - 解析头部 JSDoc 元数据（`@id` / `@name` / `@version` / ...）
 * - 生成稳定的 pluginId（优先作者声明的 `@id`，否则按 `平台.名称` 兜底），跨版本不变以支持原地更新
 * - 返回 { source, manifest }
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import {
  PLUGIN_TYPES,
  PLUGIN_GRANTS,
  type PluginGrant,
  type PluginManifest,
  type PluginType,
} from "@shared/types/plugin";
import { HOST_API_LEVEL, PluginErrorCodes } from "@shared/defaults/plugin-api";

const GZ_PREFIX = "gz_";

/** 脚本头部字段长度上限 */
const FIELD_LIMITS: Record<string, number> = {
  name: 64,
  description: 512,
  author: 64,
  homepage: 1024,
  version: 36,
  changelog: 1000,
};

// JSDoc 风格的 `@key value` 或 `* @key value`，兼容各类空白与星号
const HEADER_RE = /^\s*\*?\s*@(\w+)\s+(.+)$/;

// 源码开头的第一个块注释（`/*` 或 `/**` 或 `/*!`，非贪婪）
const BLOCK_COMMENT_RE = /^\s*\/\*[\s\S]*?\*\//;

/** 解压 gz_ 前缀脚本；若不是 gz_ 直接返回原文 */
export const decompressIfNeeded = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(GZ_PREFIX)) return raw;
  const payload = trimmed.slice(GZ_PREFIX.length);
  const buf = Buffer.from(payload, "base64");
  return zlib.inflateSync(buf).toString("utf-8");
};

interface HeaderFields {
  id?: string;
  grant?: string;
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  homepage?: string;
  apiLevel?: number;
  type?: PluginType;
  updateUrl?: string;
  changelog?: string;
}

const parseHeader = (source: string): HeaderFields => {
  const out: HeaderFields = {};
  const m0 = BLOCK_COMMENT_RE.exec(source);
  const block = m0 ? m0[0].slice(2, -2) : source.slice(0, 3000);

  const applyField = (key: string, raw: string): void => {
    const limit = FIELD_LIMITS[key];
    const val = limit && raw.length > limit ? raw.slice(0, limit) + "..." : raw;
    switch (key) {
      case "id":
        out.id = val;
        break;
      case "grant":
        out.grant = raw;
        break;
      case "name":
      case "description":
      case "version":
      case "author":
      case "homepage":
        out[key] = val;
        break;
      case "updateUrl":
      case "updateURL":
        out.updateUrl = raw;
        break;
      case "changelog":
        // 单行头里用字面 \n 表示换行，卡片按 pre-wrap 渲染
        out.changelog = val.replace(/\\n/g, "\n");
        break;
      case "apiLevel": {
        const n = parseInt(val, 10);
        if (!Number.isNaN(n)) out.apiLevel = n;
        break;
      }
      case "type":
        out.type = (PLUGIN_TYPES as readonly string[]).includes(val)
          ? (val as PluginType)
          : "source";
        break;
    }
  };

  for (const rawLine of block.split(/\r?\n/)) {
    const m = HEADER_RE.exec(rawLine);
    if (!m) continue;
    applyField(m[1], m[2].trim());
  }

  // 兜底提取：若未匹配到关键字段，尝试在头部区域按正则全局提取
  const fallbackKeys = ["name", "version", "author", "description", "homepage", "id"] as const;
  for (const key of fallbackKeys) {
    if (!out[key]) {
      const fb = new RegExp(`@${key}\\s+(.+)`).exec(block);
      if (fb?.[1]) applyField(key, fb[1].trim());
    }
  }

  return out;
};

const sha1 = (data: string): string => crypto.createHash("sha1").update(data).digest("hex");

/** 规范化 name 为 id 片段的 slug；纯非 ASCII 名会得到空串，交给 deriveId 兜底 */
const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** 规范化作者声明的 @id：小写、仅留 [a-z0-9._-]、去首尾分隔符并截断 */
const normalizeId = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 64);

/**
 * 计算插件身份 id
 * - 作者声明 `@id`（规范化后非空）→ 直接用，改名/改源码都不变，将来市场也按它做唯一键
 * - 否则按名称 slug 兜底；纯非 ASCII 名（如纯中文）slug 为空时退化为名称哈希，避免全部塌成同一个 id
 * @param declared - 头部 `@id`（可空）
 * @param name - 展示名
 */
const deriveId = (declared: string | undefined, name: string): string => {
  const normalized = declared ? normalizeId(declared) : "";
  if (normalized) return normalized;
  const slug = slugify(name);
  return slug || sha1(name).slice(0, 8);
};

/**
 * 计算插件权限
 * - 音源类（type 非 control，含缺省与 lx 脚本）：联网解析 URL 是其本职，自动授予 network
 * - 控制类：解析 @grant 按白名单去重过滤（缺省 []）——控制插件能看到播放数据，联网外发须显式声明
 * @param declared - 头部 @grant 原文（可空）
 * @param type - 插件类型
 */
const deriveGrants = (declared: string | undefined, type: PluginType): PluginGrant[] => {
  if (type !== "control") return ["network"];
  if (!declared) return [];
  const valid = (PLUGIN_GRANTS as readonly string[]).includes.bind(PLUGIN_GRANTS);
  const parsed = declared
    .split(/[,\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is PluginGrant => valid(item));
  return [...new Set(parsed)];
};

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

  const apiLevel = header.apiLevel ?? 1;
  const rawType: PluginType = header.type ?? "source";

  // 控制类依赖 level 2 宿主 API（splayer.player / onSettingChange），低于 2 直接拒绝，和文档"否则不可用"一致
  if (rawType === "control" && apiLevel < 2) {
    throw Object.assign(
      new Error(`control plugin "${name}" requires apiLevel >= 2 (declared ${apiLevel})`),
      { code: PluginErrorCodes.API_LEVEL_MISMATCH },
    );
  }

  if (apiLevel > HOST_API_LEVEL) {
    throw Object.assign(
      new Error(`plugin requires apiLevel ${apiLevel} but host supports ${HOST_API_LEVEL}`),
      { code: PluginErrorCodes.API_LEVEL_MISMATCH },
    );
  }

  // 身份优先用作者声明的 @id（跨版本/改名都稳定）；无 @id 时按名称兜底。
  // 兜底依赖名称而非源码，故源码更新 id 不变、可原地替换；无 @name 的脚本其 name 已含源码 hash，按内容区分、不享受原地更新。
  const id = deriveId(header.id, name);
  const grant = deriveGrants(header.grant, rawType);
  const finalFileName = fileName ?? (isPath ? path.basename(rawOrPath) : `${id}.js`);

  const manifest: PluginManifest = {
    id,
    name,
    version,
    description: header.description,
    author: header.author,
    homepage: header.homepage,
    grant,
    type: rawType,
    apiLevel,
    hash,
    updateUrl: header.updateUrl,
    changelog: header.changelog,
    installedAt: Date.now(),
    fileName: finalFileName,
  };

  return { source, manifest, decompressed: wasCompressed };
};
