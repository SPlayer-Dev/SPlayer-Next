import { net } from "electron";
import fs from "node:fs";
import path from "node:path";
import { artistCacheDir } from "@main/utils/config";
import { toCacheUrl } from "@main/utils/protocol";

/** MusicBrainz User-Agent */
const UA = "SPlayer-Next/1.0.0 (https://github.com/imsyy/SPlayer)";

/** 根据歌手名生成缓存文件名 */
const getCacheFileName = (artistName: string): string => {
  const safe = Buffer.from(artistName.toLowerCase()).toString("base64url");
  return `${safe}.jpg`;
};

/** 标记文件名（查询失败标记，避免重复请求） */
const getNotFoundFileName = (artistName: string): string => {
  const safe = Buffer.from(artistName.toLowerCase()).toString("base64url");
  return `${safe}.notfound`;
};

/** 确保缓存目录存在 */
const ensureCacheDir = (): void => {
  if (!fs.existsSync(artistCacheDir)) {
    fs.mkdirSync(artistCacheDir, { recursive: true });
  }
};

/**
 * 通过 MusicBrainz 搜索歌手获取 MBID
 */
const searchMusicBrainzId = async (artistName: string): Promise<string | null> => {
  const url = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(artistName)}&fmt=json&limit=1`;
  const response = await net.fetch(url, {
    headers: { "User-Agent": UA },
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { artists?: { id: string; score: number }[] };
  const artist = data.artists?.[0];
  if (!artist || artist.score < 90) return null;
  return artist.id;
};

/**
 * 通过 TheAudioDB 获取歌手头像 URL
 */
const fetchAudioDbThumb = async (mbid: string): Promise<string | null> => {
  const url = `https://www.theaudiodb.com/api/v1/json/2/artist-mb.php?i=${mbid}`;
  const response = await net.fetch(url, {
    headers: { "User-Agent": UA },
  });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    artists?: { strArtistThumb?: string; strArtistFanart?: string }[];
  };
  const artist = data.artists?.[0];
  return artist?.strArtistThumb || artist?.strArtistFanart || null;
};

/**
 * 下载图片到指定路径
 */
const downloadImage = async (imageUrl: string, savePath: string): Promise<boolean> => {
  const response = await net.fetch(imageUrl, {
    headers: { "User-Agent": UA },
  });
  if (!response.ok) return false;
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(savePath, buffer);
  return true;
};

/**
 * 获取歌手头像（带缓存）
 * @returns cache://artists/xxx.jpg 或 null
 */
export const fetchArtistAvatar = async (artistName: string): Promise<string | null> => {
  if (!artistName?.trim()) return null;
  const name = artistName.trim();

  ensureCacheDir();

  const cacheFileName = getCacheFileName(name);
  const cachePath = path.join(artistCacheDir, cacheFileName);

  // 已缓存，直接返回
  if (fs.existsSync(cachePath)) {
    return toCacheUrl(cachePath) ?? null;
  }

  // 已标记为未找到（7 天过期）
  const notFoundPath = path.join(artistCacheDir, getNotFoundFileName(name));
  if (fs.existsSync(notFoundPath)) {
    const stat = fs.statSync(notFoundPath);
    if (Date.now() - stat.mtimeMs < 7 * 24 * 60 * 60 * 1000) return null;
    fs.unlinkSync(notFoundPath);
  }

  try {
    // MusicBrainz 搜索 MBID
    const mbid = await searchMusicBrainzId(name);
    if (!mbid) {
      fs.writeFileSync(notFoundPath, "");
      return null;
    }

    // TheAudioDB 获取头像 URL
    const thumbUrl = await fetchAudioDbThumb(mbid);
    if (!thumbUrl) {
      fs.writeFileSync(notFoundPath, "");
      return null;
    }

    // 下载并缓存
    const ok = await downloadImage(thumbUrl, cachePath);
    if (!ok) {
      fs.writeFileSync(notFoundPath, "");
      return null;
    }

    return toCacheUrl(cachePath) ?? null;
  } catch {
    // 网络异常不写 notfound 标记，下次重试
    return null;
  }
};
