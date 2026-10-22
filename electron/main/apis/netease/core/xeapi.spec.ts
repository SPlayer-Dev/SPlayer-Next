import { createCipheriv } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@main/utils/proxy", () => ({ fetchWithProxy: api.fetch }));

import { xeapiSign } from "./crypto";
import { ensureXeapiKey, getXeapiSession, resetXeapiKey, updateXeapiSession } from "./xeapi";

const key = { version: "test", publicKey: "test-key", sk: "test-sk" };
const makeResponse = (_url: string, init: RequestInit) => {
  const cipher = createCipheriv(
    "aes-256-ecb",
    Buffer.from("ab1d5a430f6bb04a3f01e81ddd72bd916d5ce591248ac128714806d7f8fb1b84", "hex"),
    null,
  );
  const encryptedData = Buffer.concat([
    cipher.update(JSON.stringify(key)),
    cipher.final(),
  ]).toString("base64");
  const params = new URLSearchParams(String(init.body));
  return {
    json: async () => ({
      code: 200,
      data: {
        encryptedData,
        timestamp: "test-time",
        signature: xeapiSign("test-time", params.get("nonce")!),
      },
    }),
  };
};

describe("xeapi 公钥与会话", () => {
  beforeEach(() => {
    resetXeapiKey();
    api.fetch.mockReset().mockImplementation(makeResponse);
  });

  it("采用上游新公钥地址与客户端版本，校验签名后复用公钥", async () => {
    await expect(ensureXeapiKey("device")).resolves.toEqual(key);
    await expect(ensureXeapiKey("device")).resolves.toEqual(key);
    expect(api.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = api.fetch.mock.calls[0];
    expect(url).toBe("https://interface.music.163.com/api/bsr/sk/get");
    expect(new URLSearchParams(init.body).get("appVersion")).toBe("9.5.61");
    expect(init.headers["User-Agent"]).toContain("9.5.61");
  });

  it("签名不匹配不会保存公钥，下次重新请求", async () => {
    api.fetch.mockResolvedValueOnce({
      json: async () => ({ code: 200, data: { encryptedData: "bad", signature: "bad" } }),
    });
    await expect(ensureXeapiKey("device")).rejects.toThrow("signature mismatch");
    await expect(ensureXeapiKey("device")).resolves.toEqual(key);
    expect(api.fetch).toHaveBeenCalledTimes(2);
  });

  it("登出前的迟到响应不能恢复会话密钥", () => {
    const old = getXeapiSession();
    resetXeapiKey();
    updateXeapiSession("old-id", "old-key", old.generation);
    expect(getXeapiSession()).toMatchObject({ sessionId: "", sessionKey: "" });
    updateXeapiSession("new-id", "new-key", getXeapiSession().generation);
    expect(getXeapiSession()).toMatchObject({ sessionId: "new-id", sessionKey: "new-key" });
  });
});
