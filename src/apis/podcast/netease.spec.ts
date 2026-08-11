import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  dj_program: vi.fn(),
  dj_program_search: vi.fn(),
}));

vi.mock("@/apis/netease", () => ({
  netease: api,
}));

import { fetchPodcastPrograms, searchPodcastPrograms } from "./netease";

const programResponse = (id: number, songId = id + 1) => ({
  data: {
    count: 1,
    more: false,
    programs: [
      {
        id,
        name: "测试声音",
        duration: 60000,
        createTime: 1710000000000,
        listenerCount: 123,
        likedCount: 45,
        mainSong: {
          id: songId,
          name: "音频",
          dt: 60000,
          ar: [],
        },
        radio: {
          id: 10,
          name: "测试播客",
        },
      },
    ],
  },
});

describe("播客节目请求缓存", () => {
  beforeEach(() => {
    vi.useRealTimers();
    api.dj_program.mockReset();
    api.dj_program_search.mockReset();
  });

  it("合并相同分页的并发请求并复用结果", async () => {
    api.dj_program.mockResolvedValue(programResponse(3081133072, 2725832901));

    const [first, second] = await Promise.all([
      fetchPodcastPrograms("cache-test", 0),
      fetchPodcastPrograms("cache-test", 0),
    ]);
    const cached = await fetchPodcastPrograms("cache-test", 0);

    expect(api.dj_program).toHaveBeenCalledTimes(1);
    expect(api.dj_program).toHaveBeenCalledWith({
      rid: "cache-test",
      limit: 500,
      offset: 0,
      asc: false,
    });
    expect(first.items[0]).toMatchObject({
      id: "2725832901",
      extId: "3081133072",
      playCount: 123,
      likedCount: 45,
    });
    expect(second).toBe(first);
    expect(cached).toBe(first);
  });

  it("串行发送不同播客的节目请求", async () => {
    let resolveFirst: ((value: ReturnType<typeof programResponse>) => void) | undefined;
    api.dj_program
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof programResponse>>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(programResponse(200));

    const first = fetchPodcastPrograms("queue-first", 0);
    const second = fetchPodcastPrograms("queue-second", 0);
    await vi.waitFor(() => expect(api.dj_program).toHaveBeenCalledTimes(1));

    resolveFirst?.(programResponse(100));
    await first;
    await second;

    expect(api.dj_program).toHaveBeenCalledTimes(2);
    expect(api.dj_program.mock.calls[1]?.[0]).toMatchObject({ rid: "queue-second" });
  });

  it("使用官方接口搜索指定播客内的声音", async () => {
    const response = programResponse(500, 600);
    api.dj_program_search.mockResolvedValue({ data: response.data.programs });

    const tracks = await searchPodcastPrograms("10", "测试");

    expect(api.dj_program_search).toHaveBeenCalledWith({
      rid: "10",
      keyword: "测试",
      limit: 200,
      offset: 0,
    });
    expect(tracks[0]).toMatchObject({ id: "600", extId: "500", title: "测试声音" });
  });
});
