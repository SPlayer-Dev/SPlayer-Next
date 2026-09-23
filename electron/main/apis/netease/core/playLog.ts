import type { TrackFee } from "@shared/types/player";

interface PlaybackLogContext {
  app: {
    channel: string;
    version: string;
    versionCode: string;
  };
  auth: {
    vipType: string;
  };
}

export interface PlaybackLogResource {
  id: number;
  type: "song" | "dj";
  categoryId?: number;
  name: string;
  artist: string;
  bitrate: number;
  level: string;
  fee: TrackFee;
  time: number;
}

interface PlaybackLogSource {
  id: string;
  type: string;
  name: string;
}

export const parseCookie = (cookie: unknown): Record<string, string> => {
  if (cookie && typeof cookie === "object") return cookie as Record<string, string>;
  if (typeof cookie !== "string") return {};
  const obj: Record<string, string> = {};
  for (const part of cookie.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.substring(0, idx).trim();
    const val = part.substring(idx + 1).trim();
    if (key) obj[key] = val;
  }
  return obj;
};

export const createPlaybackLogContext = (
  cookieObj: Record<string, string>,
): PlaybackLogContext => ({
  app: {
    channel: cookieObj.channel || "netease",
    version: cookieObj.appver || "3.1.37",
    versionCode: cookieObj.versioncode || "205354",
  },
  auth: {
    vipType: cookieObj.vipType || "",
  },
});

export const toNcblSourceType = (resourceType: "song" | "dj", sourceType: string): string => {
  if (resourceType === "dj") return "djradio";
  if (sourceType === "song") return "track";
  if (sourceType === "radio") return "djradio";
  return sourceType;
};

export const buildPlv = (
  ctx: PlaybackLogContext,
  resource: PlaybackLogResource,
  source: PlaybackLogSource,
): Record<string, unknown> => ({
  mode: "circulation",
  download: 0,
  alg: "",
  status: "front",
  id: String(resource.id),
  bitrate: resource.bitrate,
  type: resource.type,
  ...(resource.type === "dj" && resource.categoryId !== undefined
    ? { categoryId: resource.categoryId }
    : {}),
  is_listentogether: 0,
  source: source.name,
  is_heart: 0,
  resource_ratio: "",
  resource_time: resource.time,
  musiceffect_id: "",
  app_mode: 2,
  bitrate_level: resource.level,
  vipType: ctx.auth.vipType,
  fee: resource.fee,
  file: 4,
  rightSource: 0,
  sourceId: source.id,
  sourcetype: source.type,
  libra_abt: "",
  channel: ctx.app.channel,
  curStartChannel: "",
});

export const buildPld = (
  ctx: PlaybackLogContext,
  resource: PlaybackLogResource,
  source: PlaybackLogSource,
  played: number,
): Record<string, unknown> => ({
  mode: "circulation",
  download: 0,
  alg: "",
  status: "front",
  id: String(resource.id),
  time: played,
  type: resource.type,
  ...(resource.type === "dj" && resource.categoryId !== undefined
    ? { categoryId: resource.categoryId }
    : {}),
  is_listentogether: 0,
  source: source.name,
  is_heart: 0,
  realtime: played,
  resource_ratio: "",
  resource_time: resource.time,
  musiceffect_id: "1001",
  app_mode: 1,
  lyriceffect: "default",
  displayMode: "classic",
  bitrate: resource.bitrate,
  bitrate_level: resource.level,
  vipType: ctx.auth.vipType,
  fee: resource.fee,
  file: 4,
  rightSource: 0,
  sourceId: source.id,
  sourcetype: source.type,
  end: "interrupt",
  libra_abt: "",
  channel: ctx.app.channel,
  curStartChannel: "",
});
