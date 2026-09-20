import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

// 隔离 Electron 配置和日志初始化，避免测试访问用户数据目录。
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const stubs: Record<string, string> = {
      "@main/utils/proxy": "export const fetchWithProxy = (...args) => globalThis.fetch(...args)",
      "@main/utils/logger":
        "export const neteaseLog = { warn: (...args) => console.warn(...args) }",
    };
    if (stubs[specifier]) {
      return {
        url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});
const { createRequest, NeteaseRequestError } = await import("./request").finally(() =>
  hooks.deregister(),
);

describe("网易云请求错误处理", () => {
  it("网络失败保留底层原因，并明确没有收到 HTTP 响应", async (t) => {
    const cause = new AggregateError([
      Object.assign(new Error("connect ETIMEDOUT 192.0.2.1:443"), { code: "ETIMEDOUT" }),
      Object.assign(new Error("connect ENETUNREACH 2001:db8::1:443"), { code: "ENETUNREACH" }),
    ]);
    const error = new TypeError("fetch failed", { cause });
    const fetchMock = t.mock.method(globalThis, "fetch", async () => {
      throw error;
    });
    const log = t.mock.method(console, "warn", () => {});

    await assert.rejects(createRequest("/api/v6/playlist/detail", { id: 123 }, {}), (err) => {
      assert.ok(err instanceof NeteaseRequestError);
      assert.equal(err.response.status, 502);
      assert.match(err.message, /未收到 HTTP 响应/);
      assert.equal(err.cause, error);
      return true;
    });

    assert.equal(fetchMock.mock.callCount(), 3);
    assert.deepEqual(
      fetchMock.mock.calls.map((call) => (call.arguments as unknown[])[2]),
      [false, true, true],
    );
    assert.equal(log.mock.callCount(), 1);
    const output = log.mock.calls[0].arguments.join(" ");
    assert.match(output, /https:\/\/interfacepc\.music\.163\.com\/eapi\/v6\/playlist\/detail/);
    assert.match(output, /ETIMEDOUT/);
    assert.match(output, /ENETUNREACH/);
  });

  it("连接重试成功后正常返回，不输出失败日志", async (t) => {
    let attempts = 0;
    t.mock.method(globalThis, "fetch", async () => {
      if (++attempts === 1) throw new TypeError("fetch failed");
      return Response.json({ code: 200, playlist: { id: 123 } });
    });
    const log = t.mock.method(console, "warn", () => {});

    const result = await createRequest("/api/v6/playlist/detail", { id: 123 }, {});

    assert.equal(attempts, 2);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.playlist, { id: 123 });
    assert.equal(log.mock.callCount(), 0);
  });

  for (const body of [
    "Bad Gateway",
    JSON.stringify({ code: 502 }),
    JSON.stringify({ code: 200 }),
  ]) {
    it(`HTTP 502 不会因响应体 ${body} 被当成成功`, async (t) => {
      t.mock.method(console, "warn", () => {});
      const fetchMock = t.mock.method(
        globalThis,
        "fetch",
        async () => new Response(body, { status: 502 }),
      );

      await assert.rejects(createRequest("/api/v6/playlist/detail", {}, {}), (err) => {
        assert.ok(err instanceof NeteaseRequestError);
        assert.equal(err.response.status, 502);
        assert.match(err.message, /netease HTTP 502/);
        assert.doesNotMatch(err.message, /未收到 HTTP 响应/);
        return true;
      });
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  }

  it("HTTP 200 中的业务码 502 保持兼容，交由登录模块处理", async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({ code: 502, msg: "账号或密码错误" }),
    );

    const result = await createRequest("/api/w/login", {}, {});

    assert.equal(result.status, 200);
    assert.equal(result.body.code, 502);
  });

  for (const body of ["<html>Bad Gateway</html>", "null", "[]"]) {
    it(`HTTP 200 携带无效响应体 ${body} 时不能返回成功`, async (t) => {
      t.mock.method(globalThis, "fetch", async () => new Response(body));
      t.mock.method(console, "warn", () => {});

      await assert.rejects(createRequest("/api/v6/playlist/detail", {}, {}), (err) => {
        assert.ok(err instanceof NeteaseRequestError);
        assert.equal(err.response.status, 502);
        assert.match(err.message, /响应读取或解析失败（HTTP 200）/);
        return true;
      });
    });
  }

  it("响应头成功但响应体中途断开时不能返回成功", async (t) => {
    const error = new TypeError("terminated", {
      cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }),
    });
    t.mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(error);
            },
          }),
        ),
    );
    const log = t.mock.method(console, "warn", () => {});

    await assert.rejects(createRequest("/api/v6/playlist/detail", {}, {}), (err) => {
      assert.ok(err instanceof NeteaseRequestError);
      assert.equal(err.response.status, 502);
      assert.match(err.message, /响应读取或解析失败（HTTP 200）/);
      assert.equal(err.cause, error);
      return true;
    });
    assert.match(log.mock.calls[0].arguments.join(" "), /UND_ERR_SOCKET/);
  });

  it("网关错误的加密响应无法解密时仍保留真实 HTTP 状态", async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response("Bad Gateway", { status: 502 }));
    t.mock.method(console, "warn", () => {});

    await assert.rejects(createRequest("/api/v6/playlist/detail", {}, { e_r: true }), (err) => {
      assert.ok(err instanceof NeteaseRequestError);
      assert.equal(err.response.status, 502);
      assert.match(err.message, /netease HTTP 502/);
      assert.ok(err.cause instanceof Error);
      return true;
    });
  });
});
