import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ call: vi.fn(), tags: vi.fn() }));
vi.mock("@main/apis/netease", () => ({ callNetease: api.call }));
vi.mock("@main/services/engine", () => ({ getEngine: () => ({ readTrackTags: api.tags }) }));
vi.mock("@main/utils/logger", () => ({ cloudLog: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("@main/apis/netease/core/checktoken", () => ({ getAntiCheatTokenV3: vi.fn() }));
vi.mock("@main/apis/netease/core/device", () => ({
  getAnonymousToken: () => "",
  getDeviceId: () => "device",
}));
vi.mock("@main/utils/proxy", () => ({ fetchWithProxy: vi.fn() }));
vi.mock("node:fs/promises", () => {
  const mock = { stat: vi.fn(async () => ({ size: 4 })) };
  return { ...mock, default: mock };
});
vi.mock("node:fs", () => {
  const mock = { createReadStream: () => Readable.from([Buffer.from("song")]) };
  return { ...mock, default: mock };
});
vi.mock("node:https", () => ({
  default: {
    request: (_url: unknown, _options: unknown, callback: (response: unknown) => void) => {
      const request = new Writable({ write: (_chunk, _encoding, done) => done() });
      request.on("finish", () => {
        const response = Object.assign(new EventEmitter(), { statusCode: 200 });
        callback(response);
        response.emit("end");
      });
      return request;
    },
  },
}));

import { uploadCloudSong } from "./cloudUpload";

const ok = (body: Record<string, unknown> = {}) => ({ status: 200, body: { code: 200, ...body } });

describe("云盘上传业务结果", () => {
  beforeEach(() => {
    api.call.mockReset();
    api.tags.mockResolvedValue({ title: "song", artist: "artist", album: "album" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ upload: ["https://upload.example.com"] }),
      })),
    );
  });

  it("包装为 HTTP 200 的查重错误不能被当作秒传", async () => {
    api.call.mockResolvedValue({ status: 200, body: { code: 502, msg: "查重失败" } });
    await expect(uploadCloudSong("song.mp3", vi.fn())).rejects.toThrow("查重失败");
    expect(api.call).toHaveBeenCalledTimes(1);
  });

  it("缺失 needUpload 不能进入秒传路径", async () => {
    api.call.mockResolvedValue(ok());
    await expect(uploadCloudSong("song.mp3", vi.fn())).rejects.toThrow("上传标识");
    expect(api.call).toHaveBeenCalledTimes(1);
  });

  it("秒传导入失败不能报告成功", async () => {
    api.call
      .mockResolvedValueOnce(ok({ needUpload: false }))
      .mockResolvedValueOnce(ok({ data: [{ songId: 1, upload: 0 }] }))
      .mockResolvedValueOnce({ status: 200, body: { code: 502, msg: "导入失败" } });
    await expect(uploadCloudSong("song.mp3", vi.fn())).rejects.toThrow("导入失败");
  });

  it("不可导入的匹配结果不能继续导入", async () => {
    api.call
      .mockResolvedValueOnce(ok({ needUpload: false }))
      .mockResolvedValueOnce(ok({ data: [{ songId: 1, upload: 2 }] }));
    await expect(uploadCloudSong("song.mp3", vi.fn())).rejects.toThrow("无法导入");
    expect(api.call).toHaveBeenCalledTimes(2);
  });

  it("有效秒传结果正常返回", async () => {
    api.call
      .mockResolvedValueOnce(ok({ needUpload: false }))
      .mockResolvedValueOnce(ok({ data: [{ songId: 1, upload: 0 }] }))
      .mockResolvedValueOnce(ok());
    await expect(uploadCloudSong("song.mp3", vi.fn())).resolves.toEqual({
      success: true,
      instant: true,
      songId: "1",
    });
  });

  for (const failedStage of ["token", "info", "publish"] as const) {
    it(`${failedStage} 阶段业务失败不能报告上传成功`, async () => {
      api.call
        .mockResolvedValueOnce(ok({ needUpload: true, songId: 1 }))
        .mockResolvedValueOnce(
          ok({
            result: { objectKey: "key", token: "token", resourceId: 2 },
            ...(failedStage === "token" ? { code: 502, msg: "token 失败" } : {}),
          }),
        )
        .mockResolvedValueOnce(
          ok({ songId: 1, ...(failedStage === "info" ? { code: 502, msg: "info 失败" } : {}) }),
        )
        .mockResolvedValueOnce(
          ok(failedStage === "publish" ? { code: 502, msg: "publish 失败" } : {}),
        );
      await expect(uploadCloudSong("song.mp3", vi.fn())).rejects.toThrow(`${failedStage} 失败`);
      expect(api.call).toHaveBeenCalledTimes({ token: 2, info: 3, publish: 4 }[failedStage]);
    });
  }

  it("真实上传成功需通过发布校验", async () => {
    api.call
      .mockResolvedValueOnce(ok({ needUpload: true, songId: 1 }))
      .mockResolvedValueOnce(ok({ result: { objectKey: "key", token: "token", resourceId: 2 } }))
      .mockResolvedValueOnce(ok({ songId: 3 }))
      .mockResolvedValueOnce(ok());
    await expect(uploadCloudSong("song.mp3", vi.fn())).resolves.toEqual({
      success: true,
      instant: false,
      songId: "3",
    });
    expect(api.call.mock.calls[3]).toEqual(["cloud_pub", { songid: 3 }]);
  });
});
