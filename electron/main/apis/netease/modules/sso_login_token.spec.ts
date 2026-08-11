import { describe, expect, it, vi } from "vitest";
import type { Query } from "../core/option";
import type { RequestFn } from "../core/types";
import ssoLoginToken from "./sso_login_token";

describe("网易云网页单点登录接口", () => {
  it("使用 eapi 获取短期登录 token", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ status: 200, body: { code: 200, token: "token" }, cookie: [] });

    await ssoLoginToken({} satisfies Query, request as unknown as RequestFn);

    expect(request).toHaveBeenCalledWith(
      "/api/sso/login/token",
      {},
      expect.objectContaining({ crypto: "eapi" }),
    );
  });
});
