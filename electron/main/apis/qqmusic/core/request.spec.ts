import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@main/database/sessions", () => ({
  getSessionCookies: () => ({ uin: "123456", qm_keyst: "saved-key" }),
}));
vi.mock("@main/utils/logger", () => ({ coreLog: { info: vi.fn(), warn: vi.fn() } }));

import search from "../modules/search";
import { qmRequest } from "./request";

const fetchMock = vi.fn();

describe("QQ 搜索签名请求", () => {
  beforeEach(() => {
    fetchMock
      .mockReset()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ code: 0, request: { code: 0, data: { ok: true } } })),
      );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("按实际 UTF-8 请求体签名，匿名请求不携带保存的账号", async () => {
    await expect(
      qmRequest(
        "test.module",
        "Test",
        { text: "中文 /+=" },
        {
          signed: true,
          session: false,
          auth: false,
        },
      ),
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://u.y.qq.com/cgi-bin/musics.fcg?sign=zzc1e5fa52xvbbw2xnh0dllekgdd2hmt5j9ya7ea27b8",
    );
    expect(init.body).toBe(
      '{"comm":{"ct":11,"cv":14090008,"v":14090008,"chid":"10003505","os_ver":"15","phonetype":"24122RKC7C","tmeAppID":"qqmusic","nettype":"NETWORK_WIFI","udid":"0","OpenUDID":"0","QIMEI36":"0","uin":"0"},"request":{"module":"test.module","method":"Test","param":{"text":"中文 /+="}}}',
    );
    expect(init.headers.Cookie).toBe("tmeLoginType=-1;");
  });

  it("未启用签名的接口保留原网关和登录凭据", async () => {
    await qmRequest("test.module", "Test", {}, { session: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://u.y.qq.com/cgi-bin/musicu.fcg");
    expect(JSON.parse(init.body).comm).toMatchObject({ uin: "123456", authst: "saved-key" });
    expect(init.headers.Cookie).toBe("uin=123456; qm_keyst=saved-key");
  });

  it("四类搜索共用签名网关，并保留分页参数和结果映射", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            code: 0,
            request: {
              code: 0,
              data: {
                meta: { sum: 100 },
                body: {
                  item_song: [{ id: 1, mid: "song", title: "晴天", interval: 269 }],
                  item_album: [{ albummid: "album", name: "叶惠美" }],
                  singer: [{ singerMID: "artist", singerName: "周杰伦" }],
                  item_songlist: [{ dissid: "playlist", dissname: "<em>周杰伦</em>精选" }],
                },
              },
            },
          }),
        ),
    );
    for (const [type, searchType, field, expected] of [
      [0, 0, "songs", { id: "1", mid: "song", name: "晴天", duration: 269000 }],
      [8, 2, "albums", { id: "album", name: "叶惠美" }],
      [9, 1, "artists", { id: "artist", name: "周杰伦" }],
      [2, 3, "playlists", { id: "playlist", name: "周杰伦精选" }],
    ] as const) {
      const result = await search({ keywords: "周杰伦", type, page: 2, limit: 50 });
      expect(result).toMatchObject({ code: 200, total: 100, [field]: [expected] });
      const [url, init] = fetchMock.mock.calls.at(-1)!;
      expect(new URL(url).pathname).toBe("/cgi-bin/musics.fcg");
      expect(new URL(url).searchParams.get("sign")).toMatch(/^zzc[a-z0-9]+$/);
      expect(JSON.parse(init.body)).toMatchObject({
        comm: { tmeAppID: "qqmusiclight", cv: "1003006", uin: "0" },
        request: {
          method: "DoSearchForQQMusicLite",
          param: { query: "周杰伦", search_type: searchType, page_num: 2, num_per_page: 50 },
        },
      });
      expect(init.headers.Cookie).toBe("tmeLoginType=-1;");
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
