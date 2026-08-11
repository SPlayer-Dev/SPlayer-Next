import type { Track } from "@shared/types/player";
import type { NeteaseDjProgram, NeteaseDjRadio } from "@/types/netease";
import type { Podcast } from "@/types/podcast";
import { netease as neteaseApi } from "@/apis/netease";
import { ensureOk } from "@/utils/format/netease";
import { podcastProgramToTrack, toPodcast } from "@/utils/format/podcast";

const PODCAST_PAGE_SIZE = 50;
const PROGRAM_PAGE_SIZE = 500;
const PROGRAM_CACHE_TTL = 2 * 60 * 1000;
const PROGRAM_CACHE_LIMIT = 4;

interface ProgramCacheEntry {
  page: PodcastProgramPage;
  expiresAt: number;
}

const programCache = new Map<string, ProgramCacheEntry>();
const programRequests = new Map<string, Promise<PodcastProgramPage>>();
let programRequestQueue: Promise<void> = Promise.resolve();

interface PodcastProgramPayload {
  programs?: NeteaseDjProgram[];
  count?: number;
  more?: boolean;
}

interface PodcastProgramResponse extends PodcastProgramPayload {
  data?: PodcastProgramPayload;
}

interface PodcastProgramSearchResponse {
  data?: NeteaseDjProgram[];
}

const getProgramPayload = (body: PodcastProgramResponse): PodcastProgramPayload =>
  body.data ?? body;

/** 获取用户创建的播客 */
export const fetchCreatedPodcasts = async (uid: number): Promise<Podcast[]> => {
  const body = await neteaseApi.user_audio({ uid });
  return ((body?.djRadios ?? []) as NeteaseDjRadio[]).map(toPodcast);
};

/** 获取用户收藏的全部播客 */
export const fetchSubscribedPodcasts = async (): Promise<Podcast[]> => {
  const podcasts: Podcast[] = [];
  let offset = 0;
  while (true) {
    const body = await neteaseApi.dj_sublist({ limit: PODCAST_PAGE_SIZE, offset });
    const list = (body?.djRadios ?? []) as NeteaseDjRadio[];
    podcasts.push(...list.map(toPodcast));
    if (!body?.hasMore || list.length < PODCAST_PAGE_SIZE) break;
    offset += list.length;
  }
  return podcasts;
};

/** 获取播客详情 */
export const fetchPodcastDetail = async (id: string): Promise<NeteaseDjRadio | null> => {
  const body = await neteaseApi.dj_detail({ rid: id });
  return (body?.data as NeteaseDjRadio | undefined) ?? null;
};

export interface PodcastProgramPage {
  items: Track[];
  total: number;
  hasMore: boolean;
}

/** 分页获取播客节目 */
export const fetchPodcastPrograms = async (
  id: string,
  offset: number,
  limit = PROGRAM_PAGE_SIZE,
): Promise<PodcastProgramPage> => {
  const key = `${id}:${offset}:${limit}`;
  const cached = programCache.get(key);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      programCache.delete(key);
      programCache.set(key, cached);
      return cached.page;
    }
    programCache.delete(key);
  }

  const pending = programRequests.get(key);
  if (pending) return pending;

  const request = programRequestQueue.then(async (): Promise<PodcastProgramPage> => {
    const body = await neteaseApi.dj_program<PodcastProgramResponse>({
      rid: id,
      limit,
      offset,
      asc: false,
    });
    const payload = getProgramPayload(body);
    const radio = payload.programs?.[0]?.radio as NeteaseDjRadio | undefined;
    const programs = (payload.programs ?? []) as NeteaseDjProgram[];
    const items = programs.map((program) => podcastProgramToTrack(program, radio));
    const total = Number(payload.count) || items.length;
    const page = {
      items,
      total,
      hasMore: Boolean(payload.more) || offset + items.length < total,
    };
    if (items.length > 0) {
      if (programCache.size >= PROGRAM_CACHE_LIMIT) {
        const oldest = programCache.keys().next().value;
        if (oldest !== undefined) programCache.delete(oldest);
      }
      programCache.set(key, { page, expiresAt: Date.now() + PROGRAM_CACHE_TTL });
    }
    return page;
  });
  programRequestQueue = request.then(
    () => undefined,
    () => undefined,
  );

  programRequests.set(key, request);
  try {
    return await request;
  } finally {
    programRequests.delete(key);
  }
};

/** 搜索指定播客内的声音 */
export const searchPodcastPrograms = async (id: string, keyword: string): Promise<Track[]> => {
  const body = await neteaseApi.dj_program_search<PodcastProgramSearchResponse>({
    rid: id,
    keyword,
    limit: 200,
    offset: 0,
  });
  return (body.data ?? []).map((program) => podcastProgramToTrack(program, program.radio));
};

/** 收藏或取消收藏播客 */
export const subscribePodcast = async (id: string, subscribe: boolean): Promise<void> => {
  ensureOk(await neteaseApi.dj_sub({ rid: id, t: subscribe ? 1 : 0 }));
};
