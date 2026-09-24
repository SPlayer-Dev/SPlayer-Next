/**
 * 插件只读媒体数据
 *
 * 封面由主进程统一解码成 300px JPEG 再交给插件：原始高清图可达数 MB，
 * 直接透传会把体积放大到跨进程传输与沙箱内的内存上。
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { nativeImage } from "electron";
import type { Track } from "@shared/types/player";
import type { PluginCoverData } from "@shared/types/plugin";
import * as nowPlaying from "@main/services/nowPlaying";
import { fetchBytes } from "@main/utils/fetchBytes";
import { resolveCacheUrlPath } from "@main/utils/protocol";
import { pluginLog } from "@main/utils/logger";

/** 本地封面与 data URL 允许的最大字节数 */
const MAX_COVER_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_COVER_BASE64_LENGTH = Math.ceil(MAX_COVER_INPUT_BYTES / 3) * 4;
/** 输出边长，与引擎抽取的缩略图一致 */
const COVER_SIZE = 300;
/** 输出 JPEG 质量 */
const COVER_JPEG_QUALITY = 84;

/** 按上限校验封面字节 */
const ensureBounded = (data: Buffer): Buffer | null =>
  data.byteLength > 0 && data.byteLength <= MAX_COVER_INPUT_BYTES ? data : null;

/** 读取 data URL */
const readDataUrl = (url: string): Buffer | null => {
  const separator = url.indexOf(",");
  if (separator < 0 || !/^data:image\/[a-z0-9.+-]+;base64$/i.test(url.slice(0, separator)))
    return null;
  const encoded = url.slice(separator + 1);
  if (
    encoded.length === 0 ||
    encoded.length > MAX_COVER_BASE64_LENGTH ||
    encoded.length % 4 === 1 ||
    !/^[a-z0-9+/]*={0,2}$/i.test(encoded)
  )
    return null;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  if (padding > 0 && encoded.length % 4 !== 0) return null;
  const decodedLength = Math.floor((encoded.length - padding) * 0.75);
  if (decodedLength === 0 || decodedLength > MAX_COVER_INPUT_BYTES) return null;
  return ensureBounded(Buffer.from(encoded, "base64"));
};

/**
 * 读取封面来源的原始字节
 * @param url - Track.cover / coverOriginal，支持 cache://、data URL、http(s) 与 streaming-cover://
 */
const readCoverSource = async (url: string): Promise<Buffer | null> => {
  if (url.startsWith("cache://")) {
    const filePath = resolveCacheUrlPath(url);
    if (!filePath) return null;
    return ensureBounded(await readFile(filePath));
  }
  if (url.startsWith("data:image/")) return readDataUrl(url);
  // 流媒体封面协议在主进程注册，与 http 一样能被 net.fetch 取到，但要过鉴权代理那一层
  if (/^(https?|streaming-cover):\/\//i.test(url))
    return await fetchBytes(url, { requireImage: true });
  return null;
};

/** 把封面来源编码成插件可见的小图 */
const buildCover = async (track: Track, coverUrl: string): Promise<PluginCoverData | null> => {
  try {
    const source = await readCoverSource(coverUrl);
    if (!source) return null;
    const image = nativeImage.createFromBuffer(source);
    if (image.isEmpty()) return null;
    // 只给 width：同时给宽高会非等比拉伸
    const data = image.resize({ width: COVER_SIZE, quality: "good" }).toJPEG(COVER_JPEG_QUALITY);
    return {
      trackId: track.id,
      source: track.source,
      mimeType: "image/jpeg",
      hash: createHash("sha256").update(data).digest("hex"),
      data: new Uint8Array(data),
    };
  } catch (error) {
    pluginLog.debug("读取插件封面失败", error instanceof Error ? error.message : String(error));
    return null;
  }
};

/** 最近一次封面结果，只保留一份 */
let coverCache: { key: string; promise: Promise<PluginCoverData | null> } | null = null;

/**
 * 获取适合插件小尺寸展示的当前封面
 * @returns 统一为 300px JPEG；无封面或读取失败返回 null
 */
export const getCurrentCover = (): Promise<PluginCoverData | null> => {
  const snap = nowPlaying.snapshot();
  const track = snap.track;
  const coverUrl = track?.cover ?? track?.coverOriginal;
  if (!track || !coverUrl) return Promise.resolve(null);
  // 元数据修订号参与 key：封面变更必然伴随 track-update，旧结果据此失效
  const key = `${snap.trackRevision}|${track.id}|${coverUrl}`;
  if (coverCache?.key === key) return coverCache.promise;
  const promise = buildCover(track, coverUrl).then((data) => {
    // 失败不占住 key，下次调用重新取
    if (!data && coverCache?.key === key) coverCache = null;
    return data;
  });
  coverCache = { key, promise };
  return promise;
};
