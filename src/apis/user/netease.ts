import type { Album, Artist, Playlist } from "@shared/types/player";
import type { UserSubcount } from "@/types/user";
import { netease as neteaseApi } from "@/apis/netease";
import { ensureOk, toAlbum, toArtist, toPlaylist, toSubcount } from "@/utils/format/netease";

const PAGE_SIZE = 50;

/**
 * 通用分页直到拉完
 * @param fetcher 第 N 页拉取函数（offset/limit），返回 `{ data, hasMore }`
 * @param extract 单项 raw → Item
 */
const fetchAllPages = async <Item>(
  fetcher: (offset: number, limit: number) => Promise<{ data?: any[]; hasMore?: boolean }>,
  extract: (raw: any) => Item,
): Promise<Item[]> => {
  const all: Item[] = [];
  let offset = 0;
  while (true) {
    const resp = await fetcher(offset, PAGE_SIZE);
    const list = resp.data ?? [];
    all.push(...list.map(extract));
    if (!resp.hasMore || list.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
};

/** 用户全部歌单 */
export const fetchUserPlaylists = async (uid: number, total?: number): Promise<Playlist[]> => {
  const body = await neteaseApi.user_playlist({
    uid,
    limit: total && total > 0 ? total : 1000,
    offset: 0,
  });
  return (body?.playlist ?? []).map(toPlaylist);
};

/** 用户订阅计数 */
export const fetchSubcount = async (): Promise<UserSubcount> => {
  const body = await neteaseApi.user_subcount();
  return toSubcount(body ?? {});
};

/** 用户喜欢歌曲 id 列表 */
export const fetchLikelist = async (uid: number): Promise<string[]> => {
  const body = await neteaseApi.likelist({ uid });
  return ((body?.ids as number[]) ?? []).map(String);
};

/** 用户收藏专辑 */
export const fetchUserAlbums = (): Promise<Album[]> =>
  fetchAllPages(async (offset, limit) => {
    const body = await neteaseApi.album_sublist({ limit, offset });
    return { data: body?.data, hasMore: body?.hasMore };
  }, toAlbum);

/** 用户收藏歌手 */
export const fetchUserArtists = (): Promise<Artist[]> =>
  fetchAllPages(async (offset, limit) => {
    const body = await neteaseApi.artist_sublist({ limit, offset });
    return { data: body?.data, hasMore: body?.hasMore };
  }, toArtist);

/**
 * 切换红心状态
 * 优先调用新版 like_v1，失败时自动降级到旧版 like
 * @param trackId - 歌曲 ID
 * @param like - true 为红心，false 为取消红心
 */
export const toggleLikeSong = async (trackId: string, like: boolean): Promise<void> => {
  try {
    const res = await neteaseApi.like_v1<{ code?: number }>({ id: trackId, like });
    if (res && (res.code === 200 || Number(res.code) === 200)) return;
  } catch {}
  ensureOk(await neteaseApi.like({ id: trackId, like }));
};

/** 用户等级 */
export const fetchUserLevel = async (): Promise<number | undefined> => {
  const body = await neteaseApi.user_level();
  const level = body?.data?.level;
  return typeof level === "number" ? level : undefined;
};

interface SigninBody {
  android?: { code?: number; point?: number; msg?: string };
  web?: { code?: number; point?: number; msg?: string };
  code?: number;
  point?: number;
  msg?: string;
}

/**
 * 每日签到
 * @param type 签到类型（0=安卓端得 3 经验，1=PC 端得 2 经验）
 * @returns 本次获得的经验；重复签到 / 未登录等失败时抛带 code 的 Error
 */
export const dailySignin = async (type: 0 | 1 = 1): Promise<{ point: number }> => {
  let body: SigninBody;
  try {
    body = await neteaseApi.daily_signin<SigninBody>({ type });
  } catch (err) {
    // 顶层 code 形态的失败响应（如 {code: -2}）由请求层抛出，这里统一为带 code 的 Error
    const apiErr = err as { body?: { code?: number; msg?: string } };
    const e = new Error(apiErr?.body?.msg || "signin failed") as Error & { code?: number };
    e.code = apiErr?.body?.code;
    throw e;
  }
  // 兼容 `{android, web}` 与顶层 `{code, point}` 两种响应形态
  const result = body?.web ?? body?.android ?? body;
  if (result?.code === 200) return { point: result.point ?? 0 };
  const err = new Error(result?.msg || "signin failed") as Error & { code?: number };
  err.code = result?.code;
  throw err;
};

/**
 * 签到状态（今日是否已签到 + 连续天数）
 */
export interface SigninStatus {
  /** 今日是否已签到（接口未明确时为 undefined，由本地记录兜底） */
  signed?: boolean;
  /** 连续签到天数 */
  days?: number;
}

/**
 * 拉取签到状态
 * @returns 今日签到状态与连续天数；接口不可用或结构不符时对应字段为 undefined
 */
export const fetchSigninStatus = async (): Promise<SigninStatus> => {
  const body = await neteaseApi.signin_progress<{
    data?: {
      signinInfo?: { signinStatus?: number; todayFirstSigninStatus?: number };
      signinProgress?: { signinDays?: number };
    };
  }>();
  const info = body?.data?.signinInfo ?? {};
  const days = body?.data?.signinProgress?.signinDays;
  return {
    signed: info.signinStatus === 1 || info.todayFirstSigninStatus === 1 ? true : undefined,
    days: typeof days === "number" ? days : undefined,
  };
};
