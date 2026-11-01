/**
 * 下载文件名工具：模板渲染 + 非法字符清洗 + 重名序号
 */

import { existsSync } from "node:fs";
import type { DownloadFolderScheme } from "@shared/types/download";

/** 模板占位符取值 */
interface TemplateVars {
  artist: string;
  title: string;
  album: string;
}

/** 文件名非法字符 */
const ILLEGAL = /[\\/:*?"<>|]/g;

/** 清洗单个路径段：去非法字符、压缩空白、去首尾空白与点 */
export const sanitizeSegment = (name: string): string =>
  name
    .replace(ILLEGAL, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .trim();

/** 填充占位符 {artist} {title} {album} */
const fillTemplate = (template: string, vars: TemplateVars): string =>
  template
    .replace(/\{artist\}/g, vars.artist)
    .replace(/\{title\}/g, vars.title)
    .replace(/\{album\}/g, vars.album);

/** 智能分类对应的子文件夹段（清洗后丢弃空段） */
const folderSegments = (scheme: DownloadFolderScheme, vars: TemplateVars): string[] => {
  const raw =
    scheme === "artist"
      ? [vars.artist]
      : scheme === "artist-album"
        ? [vars.artist, vars.album]
        : [];
  return raw.map(sanitizeSegment).filter(Boolean);
};

/**
 * 组合下载的相对子目录与文件名（不含扩展名）
 *
 * 文件名整段视作单一名字，内部 / 不生成子目录；子目录仅由智能分类决定。
 * @param scheme - 文件智能分类
 * @param fileTemplate - 文件名模板（不含子目录）
 * @param vars - 占位符取值
 * @returns relDir 相对子目录（可能为空串），baseName 文件名
 */
export const renderDownloadPath = (
  scheme: DownloadFolderScheme,
  fileTemplate: string,
  vars: TemplateVars,
): { relDir: string; baseName: string } => {
  const baseName =
    sanitizeSegment(fillTemplate(fileTemplate, vars)) || sanitizeSegment(vars.title) || "untitled";
  return { relDir: folderSegments(scheme, vars).join("/"), baseName };
};

/**
 * 目标已存在时追加序号 name (2).ext
 * @param pathWithoutExt - 不含扩展名的完整路径
 * @param ext - 扩展名（含点，可空）
 * @returns 不冲突的完整路径
 */
export const dedupePath = (pathWithoutExt: string, ext: string): string => {
  let target = `${pathWithoutExt}${ext}`;
  for (let seq = 2; existsSync(target); seq++) {
    target = `${pathWithoutExt} (${seq})${ext}`;
  }
  return target;
};

/** Content-Type → 扩展名（含点） */
const MIME_EXT: Record<string, string> = {
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/ogg": ".ogg",
  "audio/opus": ".opus",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
};

/** 已知音频扩展名 */
const KNOWN_EXTS = new Set([
  ".flac",
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".wav",
  ".ape",
  ".wv",
  ".aiff",
]);

/**
 * 从 Content-Disposition 的文件名里取扩展名
 *
 * 插件音源给出的地址常常没有路径后缀（下载接口 302 到 CDN），
 * 此时服务器给的文件名是唯一可靠的格式信号
 * @param disposition - 响应头 content-disposition
 * @returns 已知音频扩展名（不含点）；无法识别时返回 undefined
 */
export const extensionFromDisposition = (
  disposition: string | null | undefined,
): string | undefined => {
  if (!disposition) return undefined;
  const match = disposition.match(/\.([a-z\d]{2,5})(?=["';]|$)/i);
  if (!match) return undefined;
  const name = match[1].toLowerCase();
  return KNOWN_EXTS.has(`.${name}`) ? name : undefined;
};

/**
 * 推断下载文件扩展名（含点）
 * 优先级：已声明格式 → Content-Type → URL 路径后缀 → 兜底 .mp3
 * @param declaredFormat - 已知格式（如 netease 的 flac/mp3）
 * @param contentType - 响应 Content-Type
 * @param url - 音频 URL
 */
export const resolveExtension = (
  declaredFormat: string | undefined,
  contentType: string | null,
  url: string,
): string => {
  if (declaredFormat) {
    const ext = declaredFormat.startsWith(".") ? declaredFormat : `.${declaredFormat}`;
    if (KNOWN_EXTS.has(ext.toLowerCase())) return ext.toLowerCase();
  }
  if (contentType) {
    const mime = contentType.split(";")[0].trim().toLowerCase();
    if (MIME_EXT[mime]) return MIME_EXT[mime];
  }
  const match = url.split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
  if (match) {
    const ext = `.${match[1].toLowerCase()}`;
    if (KNOWN_EXTS.has(ext)) return ext;
  }
  return ".mp3";
};
