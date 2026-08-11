import { describe, expect, it, vi } from "vitest";
import type { Query } from "../core/option";
import type { RequestFn } from "../core/types";
import djDetail from "./dj_detail";
import djProgram from "./dj_program";
import djProgramSearch from "./dj_program_search";
import djSub from "./dj_sub";
import djSublist from "./dj_sublist";
import userAudio from "./user_audio";

const createRequest = () =>
  vi.fn().mockResolvedValue({ status: 200, body: { code: 200 }, cookie: [] });

describe("网易云播客接口", () => {
  it("请求用户创建和收藏的播客", async () => {
    const request = createRequest();

    await userAudio({ uid: 1 } satisfies Query, request as unknown as RequestFn);
    await djSublist({ limit: 20, offset: 5 } satisfies Query, request as unknown as RequestFn);

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "/api/djradio/get/byuser",
      "/api/djradio/get/subed",
    ]);
    expect(request.mock.calls[0]?.[1]).toMatchObject({ userId: 1, timestamp: expect.any(Number) });
    expect(request.mock.calls[1]?.[1]).toMatchObject({
      limit: 20,
      offset: 5,
      total: true,
      timestamp: expect.any(Number),
    });
  });

  it("请求播客详情和节目列表", async () => {
    const request = createRequest();

    await djDetail({ rid: "2" } satisfies Query, request as unknown as RequestFn);
    await djProgram(
      { rid: "2", limit: 50, offset: 10, asc: true } satisfies Query,
      request as unknown as RequestFn,
    );
    await djProgramSearch(
      { rid: "2", keyword: "测试", limit: 200, offset: 0 } satisfies Query,
      request as unknown as RequestFn,
    );

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "/api/djradio/v2/get",
      "/api/v6/dj/program/byradio",
      "/api/dj/radio/program/search",
    ]);
    expect(request.mock.calls[1]?.[1]).toMatchObject({
      radioId: "2",
      limit: 50,
      offset: 10,
      asc: true,
    });
    expect(request.mock.calls[1]?.[2]).toMatchObject({ crypto: "eapi" });
    expect(request.mock.calls[2]?.[1]).toMatchObject({
      radioId: "2",
      keyword: "测试",
      limit: 200,
      offset: 0,
    });
    expect(request.mock.calls[2]?.[2]).toMatchObject({ crypto: "eapi" });
  });

  it("按目标状态收藏或取消收藏播客", async () => {
    const request = createRequest();

    await djSub({ rid: "3", t: 1 } satisfies Query, request as unknown as RequestFn);
    await djSub({ rid: "3", t: 0 } satisfies Query, request as unknown as RequestFn);

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "/api/djradio/sub",
      "/api/djradio/unsub",
    ]);
  });
});
