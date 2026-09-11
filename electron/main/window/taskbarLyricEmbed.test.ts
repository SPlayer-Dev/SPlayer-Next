import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveEmbedAction } from "./taskbarLyricEmbed";

describe("resolveEmbedAction", () => {
  it("尚未完成首次嵌入时不动作", () => {
    assert.equal(resolveEmbedAction({ alive: true, embedded: true }, 11, null), "idle");
  });

  it("HWND 已失效时不动作（避免对失效窗口做任何操作）", () => {
    assert.equal(resolveEmbedAction({ alive: false, embedded: false }, 11, 11), "idle");
  });

  it("父关系被摘除时重新附着", () => {
    assert.equal(resolveEmbedAction({ alive: true, embedded: false }, 11, 11), "reattach");
  });

  it("窗口被重建（HWND 变化）时重新嵌入", () => {
    assert.equal(resolveEmbedAction({ alive: true, embedded: true }, 22, 11), "reembed");
  });

  it("HWND 变化且父关系同时失效时优先重新嵌入", () => {
    assert.equal(resolveEmbedAction({ alive: true, embedded: false }, 22, 11), "reembed");
  });

  it("一切正常时不动作", () => {
    assert.equal(resolveEmbedAction({ alive: true, embedded: true }, 11, 11), "healthy");
  });
});
