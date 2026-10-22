import { createCipheriv } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetch: vi.fn(), v3: vi.fn(), web: vi.fn() }));
vi.mock("@main/utils/proxy", () => ({ fetchWithProxy: api.fetch }));
vi.mock("./webClient", () => ({ requestWithWebClient: api.web }));
vi.mock("./checktoken", () => ({ getAntiCheatTokenV3: api.v3 }));
vi.mock("./device", () => ({ getAnonymousToken: () => "", getDeviceId: () => "device" }));

import { eapiReqDecrypt } from "./crypto";
import { createRequest } from "./request";

describe("平台请求协议与解析", () => {
  beforeEach(() => {
    api.fetch.mockReset().mockResolvedValue(new Response('{"code":200}'));
    api.v3.mockReset().mockResolvedValue("v3-fresh-token");
    api.web.mockReset().mockResolvedValue({ status: 200, body: { code: 200 }, cookie: [] });
  });

  it("网页配置路由到公共请求层，不再经过客户端凭据和自动重试", async () => {
    const data = { id: 1 };
    const options = { client: "web" as const };
    await createRequest("/api/artist/sub", data, options);
    expect(api.web).toHaveBeenCalledWith("/api/artist/sub", data, options);
    expect(api.fetch).not.toHaveBeenCalled();
    expect(api.v3).not.toHaveBeenCalled();
  });

  it("原收藏请求不获取反作弊凭据", async () => {
    await createRequest("/api/playlist/subscribe", { id: 1 }, { crypto: "eapi" });
    expect(api.v3).not.toHaveBeenCalled();
    const [, init] = api.fetch.mock.calls[0];
    expect(init.headers["X-antiCheatToken"]).toBeUndefined();
    const params = new URLSearchParams(init.body);
    const decrypted = eapiReqDecrypt(params.get("params")!);
    expect(decrypted?.data).toMatchObject({ id: 1 });
    expect(decrypted?.data).not.toMatchObject({
      header: { "X-antiCheatToken": expect.anything() },
    });
  });

  it("v3 接口仍然使用 v3 凭据", async () => {
    await createRequest("/api/radio/like", { id: 1 }, { crypto: "eapi", checkToken: "v3" });
    expect(api.v3).toHaveBeenCalledTimes(1);
    const [, init] = api.fetch.mock.calls[0];
    expect(init.headers["X-antiCheatToken"]).toBe("v3-fresh-token");
    const decrypted = eapiReqDecrypt(new URLSearchParams(init.body).get("params")!);
    expect(decrypted?.data).toMatchObject({ header: { "X-antiCheatToken": "v3-fresh-token" } });
  });

  it("HTTP 200 的 HTML 错误页面不能伪装为成功响应", async () => {
    api.fetch.mockResolvedValueOnce(new Response("<html>gateway error</html>"));
    await expect(createRequest("/api/playlist/detail", { id: 1 }, {})).rejects.toMatchObject({
      response: { status: 502, body: { code: 502 } },
    });
  });

  it("加密响应无法解包时不能返回业务成功", async () => {
    api.fetch.mockResolvedValueOnce(new Response("invalid encrypted body"));
    await expect(
      createRequest("/api/playlist/detail", { id: 1 }, { e_r: true }),
    ).rejects.toMatchObject({ response: { status: 502, body: { code: 502 } } });
  });

  it("有效加密 JSON 响应正常解包", async () => {
    const cipher = createCipheriv("aes-128-ecb", Buffer.from("e82ckenh8dichen8"), null);
    const encrypted = Buffer.concat([cipher.update('{"code":200,"ids":[1]}'), cipher.final()]);
    api.fetch.mockResolvedValueOnce(new Response(encrypted));
    await expect(createRequest("/api/song", {}, { e_r: true })).resolves.toMatchObject({
      status: 200,
      body: { code: 200, ids: [1] },
    });
  });
});
