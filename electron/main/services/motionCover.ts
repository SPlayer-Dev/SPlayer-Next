/**
 * 动态封面
 *
 * AM：iTunes Search 匹配专辑 → 公开专辑页 serialized-server-data 取 HLS 主列表
 * → 选 avc1 变体 → 下载 EXT-X-MAP 指向的单个 fMP4 到缓存目录，全程无需鉴权
 * NCM：登录后按歌曲 id 取在线 mp4，不落盘
 */

import crypto from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { ReadableStream } from "node:stream/web";
import {
  buildLyricSearchKeyword,
  normalize,
  pickBestCandidate,
  type LyricCandidate,
} from "@main/apis/common/lyric/utils";
import { callNetease, getNeteaseCookies } from "@main/apis/netease";
import { buildFingerprint } from "@main/database/lyricMatchCache";
import { getMotionCoverRecord, setMotionCoverRecord } from "@main/database/motionCoverCache";
import { store } from "@main/store";
import { getMotionCoverCacheDir } from "@main/utils/config";
import { convertTexts } from "@main/services/opencc";
import { motionCoverLog } from "@main/utils/logger";
import { toCacheUrl } from "@main/utils/protocol";
import type { MotionCoverSource, Track } from "@shared/types/player";

/** 依次尝试的地区；CN 区 Search 接口不返回结果，专辑 ID 按区不同，详情页须用同一区 */
const STOREFRONTS = ["hk", "tw", "us"];
/** 变体短边下限（px） */
const TARGET_SIZE = 768;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** iTunes Search 约 20 次/分钟限流 */
const ITUNES_INTERVAL_MS = 3000;
const TIMEOUT_MS = 15_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

/** iTunes Search 单曲结果 */
interface ItunesSong {
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  trackTimeMillis?: number;
  collectionId?: number;
}

/** 专辑页数据中用到的部分 */
interface AlbumPageData {
  data?: {
    data?: {
      sections?: {
        id?: string;
        items?: { videoArtwork?: { dictionary?: { motionDetailSquare?: { video?: string } } } }[];
      }[];
    };
  }[];
}

/** 当前曲目的 AM 任务，切到别的曲目时中止 */
let active: {
  fingerprint: string;
  controller: AbortController;
  task: Promise<string | null>;
} | null = null;
let itunesQueue: Promise<unknown> = Promise.resolve();
let lastSearchAt = 0;

/**
 * 请求远端资源，非 2xx 抛错，避免把网络问题记成未命中
 * @param url - 地址
 * @param signal - 中止信号
 * @returns 响应
 */
const request = async (url: string, signal: AbortSignal): Promise<Response> => {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res;
};

/**
 * 串行排队调用 iTunes Search
 * @param term - 关键词
 * @param storefront - 地区
 * @param signal - 中止信号
 * @returns 单曲结果
 */
const searchItunes = (
  term: string,
  storefront: string,
  signal: AbortSignal,
): Promise<ItunesSong[]> => {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=10&country=${storefront}`;
  const task = itunesQueue.then(async () => {
    // 已切走的曲目直接出队，不占限流间隔
    signal.throwIfAborted();
    await sleep(Math.max(0, lastSearchAt + ITUNES_INTERVAL_MS - Date.now()), undefined, {
      signal,
    });
    lastSearchAt = Date.now();
    const body = (await (await request(url, signal)).json()) as { results?: ItunesSong[] };
    return body.results ?? [];
  });
  itunesQueue = task.catch(() => {});
  return task;
};

/**
 * 读取专辑页中的动态封面主列表
 * @param collectionId - 专辑 ID
 * @param storefront - 地区
 * @param signal - 中止信号
 * @returns 主列表地址，专辑无动态封面时为 null
 */
const fetchAlbumVideo = async (
  collectionId: number,
  storefront: string,
  signal: AbortSignal,
): Promise<string | null> => {
  const html = await (
    await request(`https://music.apple.com/${storefront}/album/x/${collectionId}`, signal)
  ).text();
  const json = html.match(/id="serialized-server-data">([\s\S]*?)<\/script>/)?.[1];
  // 页面结构变化或被跳转时抛错而不是记成未命中
  if (!json) throw new Error(`serialized-server-data missing ${collectionId}`);
  const page = JSON.parse(json) as AlbumPageData;
  const header = page.data?.[0]?.data?.sections?.find((section) =>
    section.id?.startsWith("album-detail-header"),
  );
  if (!header) throw new Error(`album-detail-header missing ${collectionId}`);
  return header.items?.[0]?.videoArtwork?.dictionary?.motionDetailSquare?.video ?? null;
};

/**
 * 匹配曲目所属专辑并取动态封面
 * @param track - 曲目
 * @param signal - 中止信号
 * @returns 主列表地址，未匹配或无动态封面时为 null
 */
const matchVideoUrl = async (track: Track, signal: AbortSignal): Promise<string | null> => {
  const term = buildLyricSearchKeyword(track);
  // 港台区返回繁体，双方统一转简体再比对
  const [title, album, ...artistNames] = convertTexts(
    [track.title, track.album?.name ?? "", ...track.artists.map((artist) => artist.name)],
    "t2s",
  );
  const albumKey = album ? `album|${normalize(album)}|${normalize(artistNames[0])}` : null;
  const albumRecord = albumKey ? getMotionCoverRecord(albumKey) : undefined;
  if (albumRecord !== undefined) return albumRecord;
  const simplified: Track = {
    ...track,
    title,
    album: track.album && { ...track.album, name: album },
    artists: track.artists.map((artist, index) => ({ ...artist, name: artistNames[index] })),
  };
  for (const storefront of STOREFRONTS) {
    const songs = (await searchItunes(term, storefront, signal)).filter(
      (song) => song.collectionId,
    );
    const texts = convertTexts(
      songs.flatMap((song) => [
        song.trackName ?? "",
        song.artistName ?? "",
        song.collectionName ?? "",
      ]),
      "t2s",
    );
    const candidates: LyricCandidate<number>[] = songs.map((song, index) => ({
      name: texts[index * 3],
      artist: texts[index * 3 + 1],
      album: texts[index * 3 + 2],
      duration: song.trackTimeMillis,
      extra: song.collectionId!,
    }));
    const best = pickBestCandidate(candidates, simplified);
    if (!best) continue;
    const collectionKey = `collection|${storefront}|${best.extra}`;
    let video = getMotionCoverRecord(collectionKey);
    if (video === undefined) {
      video = await fetchAlbumVideo(best.extra, storefront, signal);
      setMotionCoverRecord(collectionKey, video);
    }
    // 专辑名一致才共享，避免一首歌的误匹配扩散到整张专辑
    if (albumKey && normalize(best.album) === normalize(album)) {
      setMotionCoverRecord(albumKey, video);
    }
    if (!video) motionCoverLog.info(`${track.title}：AM 专辑无动态封面`);
    return video;
  }
  motionCoverLog.info(`${track.title}：AM 未匹配`);
  return null;
};

/**
 * 选出短边不低于 TARGET_SIZE 的最小 avc1 变体，同尺寸取码率最高；都不够时取最大的
 * @param masterUrl - 主列表地址
 * @param signal - 中止信号
 * @returns 变体列表地址
 */
const pickVariant = async (masterUrl: string, signal: AbortSignal): Promise<string> => {
  const lines = (await (await request(masterUrl, signal)).text()).split(/\r?\n/);
  const variants = lines.flatMap((line, index) => {
    if (!line.startsWith("#EXT-X-STREAM-INF:") || !line.includes("avc1")) return [];
    const [width, height] = (line.match(/RESOLUTION=(\d+)x(\d+)/)?.slice(1) ?? []).map(Number);
    const uri = lines[index + 1];
    if (!width || !height || !uri || uri.startsWith("#")) return [];
    return [
      {
        size: Math.min(width, height),
        bandwidth: Number(line.match(/[,:]BANDWIDTH=(\d+)/)?.[1] ?? 0),
        url: new URL(uri, masterUrl).href,
      },
    ];
  });
  const eligible = variants.filter((variant) => variant.size >= TARGET_SIZE);
  const chosen = eligible.length
    ? eligible.sort((left, right) => left.size - right.size || right.bandwidth - left.bandwidth)[0]
    : variants.sort((left, right) => right.size - left.size || right.bandwidth - left.bandwidth)[0];
  if (!chosen) throw new Error(`no avc1 variant ${masterUrl}`);
  return chosen.url;
};

/**
 * 变体的所有分片都是同一个 fMP4 的字节区间，直接取 EXT-X-MAP 指向的整个文件
 * @param variantUrl - 变体列表地址
 * @param signal - 中止信号
 * @returns mp4 地址
 */
const resolveMp4Url = async (variantUrl: string, signal: AbortSignal): Promise<string> => {
  const text = await (await request(variantUrl, signal)).text();
  const uri = text.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1];
  if (!uri) throw new Error(`EXT-X-MAP missing ${variantUrl}`);
  return new URL(uri, variantUrl).href;
};

/**
 * 下载到临时文件后改名，避免残缺文件被当作命中
 * @param url - mp4 地址
 * @param dest - 目标路径
 * @param signal - 中止信号
 */
const download = async (url: string, dest: string, signal: AbortSignal): Promise<void> => {
  const res = await request(url, signal);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_FILE_BYTES || !res.body) {
    throw new Error(`invalid clip ${url}`);
  }
  // 同专辑切歌时旧下载可能尚未清理完，临时文件不能共用
  const temp = `${dest}.${crypto.randomUUID()}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as ReadableStream), createWriteStream(temp));
    await fs.rename(temp, dest);
  } catch (err) {
    await fs.rm(temp, { force: true });
    throw err;
  }
};

/**
 * 按修改时间淘汰最久未用的文件，直到总量不超过上限
 * @param dir - 缓存目录
 */
const trimCache = async (dir: string): Promise<void> => {
  // 跳过下载中的 .part
  const names = (await fs.readdir(dir)).filter((name) => name.endsWith(".mp4"));
  const files = await Promise.all(
    names.map(async (name) => {
      const full = path.join(dir, name);
      const stat = await fs.stat(full);
      return { full, size: stat.size, mtime: stat.mtimeMs };
    }),
  );
  files.sort((left, right) => right.mtime - left.mtime);
  const limit = store.get("cache.motionCoverSizeLimitMb") * 1024 * 1024;
  let total = 0;
  for (const file of files) {
    total += file.size;
    if (total > limit) await fs.rm(file.full, { force: true });
  }
};

/**
 * 动态封面在缓存目录中的路径，同专辑的曲目共用一个文件
 * @param videoUrl - 主列表地址
 * @returns 文件路径
 */
const clipPath = (videoUrl: string): string =>
  path.join(
    getMotionCoverCacheDir(),
    `${crypto.createHash("sha1").update(videoUrl).digest("hex").slice(0, 20)}.mp4`,
  );

/**
 * 已缓存的 AM 动态封面，刷新修改时间以保持 LRU
 * @param track - 曲目
 * @param fingerprint - 曲目指纹
 * @returns cache:// 地址，未缓存时为 null
 */
const cachedAm = async (track: Track, fingerprint: string): Promise<string | null> => {
  const videoUrl = getMotionCoverRecord(fingerprint);
  if (!videoUrl) return null;
  const file = clipPath(videoUrl);
  if (!existsSync(file)) return null;
  const now = new Date();
  await fs.utimes(file, now, now);
  motionCoverLog.info(`${track.title}：AM 已缓存`);
  return toCacheUrl(file) ?? null;
};

/**
 * 解析 AM 动态封面并确保本地有缓存文件
 * @param track - 曲目
 * @param fingerprint - 曲目指纹
 * @param signal - 中止信号
 * @returns cache:// 地址
 */
const resolveAmUncached = async (
  track: Track,
  fingerprint: string,
  signal: AbortSignal,
): Promise<string | null> => {
  const cached = await cachedAm(track, fingerprint);
  if (cached) return cached;
  let videoUrl = getMotionCoverRecord(fingerprint);
  if (videoUrl === null) {
    motionCoverLog.info(`${track.title}：AM 无动态封面`);
    return null;
  }
  if (videoUrl === undefined) {
    videoUrl = await matchVideoUrl(track, signal);
    setMotionCoverRecord(fingerprint, videoUrl);
    if (!videoUrl) return null;
    // 同专辑其他曲目可能已下载过
    const shared = await cachedAm(track, fingerprint);
    if (shared) return shared;
  }
  const file = clipPath(videoUrl);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await download(await resolveMp4Url(await pickVariant(videoUrl, signal), signal), file, signal);
  motionCoverLog.info(`${track.title}：AM 已下载`);
  await trimCache(path.dirname(file));
  return toCacheUrl(file) ?? null;
};

/**
 * 记录失败原因，下次重新尝试
 * @param track - 曲目
 * @returns 失败处理函数
 */
const logFailure =
  (track: Track) =>
  (err: Error & { cause?: { code?: string; message?: string } }): null => {
    if (err.name === "AbortError") return null;
    // fetch failed 的真实原因在 cause 里
    motionCoverLog.warn(
      `${track.title}：获取失败 ${err.cause?.code ?? err.cause?.message ?? err.message}`,
    );
    return null;
  };

/**
 * 解析 AM 动态封面，同一曲目并发请求合并
 * @param track - 曲目
 * @param fingerprint - 曲目指纹
 * @returns cache:// 地址
 */
const resolveAm = (track: Track, fingerprint: string): Promise<string | null> => {
  if (active?.fingerprint === fingerprint) return active.task;
  const controller = new AbortController();
  const task: Promise<string | null> = resolveAmUncached(track, fingerprint, controller.signal)
    .catch(logFailure(track))
    .finally(() => {
      if (active?.task === task) active = null;
    });
  active = { fingerprint, controller, task };
  return task;
};

/**
 * 获取 NCM 动态封面，仅限已登录时的网易云曲目
 * @param track - 曲目
 * @returns 在线 mp4 地址
 */
const resolveNcm = async (track: Track): Promise<string | null> => {
  if (track.source !== "netease" || !getNeteaseCookies().MUSIC_U) return null;
  const { body } = await callNetease("song_dynamic_cover", { id: track.id });
  return body?.data?.videoPlayUrl || null;
};

/**
 * 获取曲目的动态封面
 * @param track - 曲目
 * @param source - 来源模式
 * @returns 视频地址，无动态封面或失败时为 null
 */
export const resolveMotionCover = async (
  track: Track,
  source: MotionCoverSource,
): Promise<string | null> => {
  if (source === "off" || !track.title || track.artists.length === 0) return null;
  const fingerprint = buildFingerprint(track);
  // 切歌后旧曲目的匹配与下载不再需要
  if (active && active.fingerprint !== fingerprint) {
    active.controller.abort();
    active = null;
  }
  if (source === "ncm") return resolveNcm(track).catch(logFailure(track));
  if (source === "am") return resolveAm(track, fingerprint);
  // AM 优先：已缓存直接用；否则先放 NCM，AM 在后台下载供下次播放，不中途切换
  const cached = await cachedAm(track, fingerprint);
  if (cached) return cached;
  const am = resolveAm(track, fingerprint);
  return (await resolveNcm(track).catch(logFailure(track))) ?? am;
};
