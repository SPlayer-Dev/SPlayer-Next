import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { nativeImage, net } from "electron";
import type { PluginCoverData } from "@shared/types/plugin";
import * as nowPlaying from "@main/services/nowPlaying";
import { resolveCacheUrlPath } from "@main/utils/protocol";
import { pluginLog } from "@main/utils/logger";

const MAX_COVER_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_COVER_BASE64_LENGTH = Math.ceil(MAX_COVER_INPUT_BYTES / 3) * 4;
const COVER_SIZE = 300;
const COVER_TIMEOUT_MS = 10_000;

/** 按上限校验封面字节 */
const ensureBounded = (data: Uint8Array): Uint8Array | null =>
  data.byteLength > 0 && data.byteLength <= MAX_COVER_INPUT_BYTES ? data : null;

/** 读取 data URL */
const readDataUrl = (url: string): Uint8Array | null => {
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

/** 读取 HTTP(S) 封面 */
const readRemoteCover = async (url: string): Promise<Uint8Array | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COVER_TIMEOUT_MS);
  try {
    const response = await net.fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) return null;
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null) {
      const length = Number(contentLength);
      if (Number.isFinite(length) && length > MAX_COVER_INPUT_BYTES) return null;
    }

    const chunks: Uint8Array[] = [];
    const reader = response.body.getReader();
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_COVER_INPUT_BYTES) {
        controller.abort();
        return null;
      }
      chunks.push(value);
    }
    if (total === 0) return null;
    return Buffer.concat(chunks, total);
  } finally {
    clearTimeout(timer);
  }
};

/** 读取当前 Track 的小尺寸封面来源 */
const readCoverSource = async (url: string): Promise<Uint8Array | null> => {
  if (url.startsWith("cache://")) {
    const filePath = resolveCacheUrlPath(url);
    if (!filePath) return null;
    return ensureBounded(await readFile(filePath));
  }
  if (url.startsWith("data:image/")) return readDataUrl(url);
  if (/^https?:\/\//i.test(url)) return readRemoteCover(url);
  return null;
};

/**
 * 获取适合插件小尺寸展示的当前封面
 * @returns 统一为 300px JPEG；无封面或读取失败返回 null
 */
export const getCurrentCover = async (): Promise<PluginCoverData | null> => {
  const track = nowPlaying.snapshot().track;
  const coverUrl = track?.cover ?? track?.coverOriginal;
  if (!track || !coverUrl) return null;
  try {
    const source = await readCoverSource(coverUrl);
    if (!source) return null;
    const image = nativeImage.createFromBuffer(Buffer.from(source));
    if (image.isEmpty()) return null;
    const data = image
      .resize({ width: COVER_SIZE, height: COVER_SIZE, quality: "good" })
      .toJPEG(84);
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
