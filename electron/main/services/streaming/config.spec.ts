import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  available: true,
  reEncrypt: false,
  backend: "gnome_libsecret",
  syncLegacy: true,
  persisted: "",
  initial: "",
  writes: vi.fn(),
}));
vi.mock("electron", () => ({
  safeStorage: {
    isAsyncEncryptionAvailable: async () => state.available,
    getSelectedStorageBackend: () => state.backend,
    encryptStringAsync: async (text: string) => Buffer.from(`cipher:${text}`),
    decryptString: (buffer: Buffer) => {
      if (!state.syncLegacy) throw new Error("sync decryption unavailable");
      if (!buffer.toString().startsWith("cipher:")) throw new Error("invalid ciphertext");
      return buffer.toString().slice(7);
    },
    decryptStringAsync: async (buffer: Buffer) => {
      if (!buffer.toString().startsWith("cipher:")) throw new Error("invalid ciphertext");
      return { result: buffer.toString().slice(7), shouldReEncrypt: state.reEncrypt };
    },
  },
}));
vi.mock("node:fs", () => ({
  default: {
    readFileSync: () => {
      if (!state.initial) throw new Error("missing");
      return state.initial;
    },
    existsSync: () => true,
  },
}));
vi.mock("atomically", () => ({
  writeFileSync: (_path: string, text: string) => {
    state.persisted = text;
    state.writes(text);
  },
}));
vi.mock("@main/utils/paths", () => ({ configDir: "test-config" }));
beforeEach(() => {
  vi.resetModules();
  state.available = true;
  state.reEncrypt = false;
  state.backend = "gnome_libsecret";
  state.syncLegacy = true;
  state.initial = "";
  state.persisted = "";
  state.writes.mockClear();
});
const input = {
  name: "测试",
  type: "navidrome" as const,
  url: "https://server",
  username: "user",
  password: "secret",
};

describe("流媒体凭据存储", () => {
  it("改名称保留媒体身份，改账号或密码推进媒体代次", async () => {
    const service = await import("./config");
    const server = await service.addStreamingServer(input);
    expect(server.mediaRevision).toBe(0);
    expect(
      (await service.updateStreamingServer(server.id, { ...input, name: "新名称", password: "" }))
        .mediaRevision,
    ).toBe(0);
    expect(
      (
        await service.updateStreamingServer(server.id, {
          ...input,
          username: "other",
          password: "",
        })
      ).mediaRevision,
    ).toBe(1);
    expect(
      (await service.updateStreamingServer(server.id, { ...input, username: "other" }))
        .mediaRevision,
    ).toBe(2);
  });
  it("新密码带加密版本标识，renderer 视图没有凭据", async () => {
    const service = await import("./config");
    const server = await service.addStreamingServer(input);
    expect(JSON.parse(state.persisted).servers[0].encryptedPassword).toMatch(/^safe:v1:/);
    expect((await service.getStreamingServer(server.id)).password).toBe("secret");
    expect(server).not.toHaveProperty("password");
    expect(server).not.toHaveProperty("encryptedPassword");
  });

  it("安全存储不可用时拒绝保存，不写入 base64 明文", async () => {
    const service = await import("./config");
    state.available = false;
    await expect(service.addStreamingServer(input)).rejects.toThrow("安全存储不可用");
    expect(service.getStreamingConfig().servers).toHaveLength(0);
    expect(state.writes).not.toHaveBeenCalled();
  });

  it("加密不可用时无法把旧密文误当成明文密码", async () => {
    const service = await import("./config");
    const server = await service.addStreamingServer(input);
    state.available = false;
    await expect(service.getStreamingServer(server.id)).rejects.toThrow("无法读取");
    state.available = true;
    expect((await service.getStreamingServer(server.id)).password).toBe("secret");
  });

  it("系统要求轮换密钥时重新加密并回写", async () => {
    const service = await import("./config");
    const server = await service.addStreamingServer(input);
    state.writes.mockClear();
    state.reEncrypt = true;
    expect((await service.getStreamingServer(server.id)).password).toBe("secret");
    expect(state.writes).toHaveBeenCalledOnce();
    expect(JSON.parse(state.persisted).servers[0].encryptedPassword).toMatch(/^safe:v1:/);
  });

  it("1.1.0 同步密文自动迁移为 safe:v1", async () => {
    state.initial = JSON.stringify({
      servers: [
        { ...input, id: "server", encryptedPassword: Buffer.from("cipher:old").toString("base64") },
      ],
      activeServerId: "server",
    });
    const service = await import("./config");
    expect((await service.getStreamingServer("server")).password).toBe("old");
    expect(JSON.parse(state.persisted).servers[0].encryptedPassword).toMatch(/^safe:v1:/);
  });

  it("1.1.0 base64 明文自动迁移为 safe:v1", async () => {
    state.initial = JSON.stringify({
      servers: [
        { ...input, id: "server", encryptedPassword: Buffer.from("old").toString("base64") },
      ],
      activeServerId: "server",
    });
    const service = await import("./config");
    expect((await service.getStreamingServer("server")).password).toBe("old");
    expect(JSON.parse(state.persisted).servers[0].encryptedPassword).toMatch(/^safe:v1:/);
  });

  it("无前缀异步密文在同步解密不可用时也能迁移", async () => {
    state.syncLegacy = false;
    state.initial = JSON.stringify({
      servers: [
        { ...input, id: "server", encryptedPassword: Buffer.from("cipher:old").toString("base64") },
      ],
      activeServerId: "server",
    });
    const service = await import("./config");
    expect((await service.getStreamingServer("server")).password).toBe("old");
    expect(JSON.parse(state.persisted).servers[0].encryptedPassword).toMatch(/^safe:v1:/);
  });

  it("损坏的 base64 旧值要求重新输入", async () => {
    state.initial = JSON.stringify({
      servers: [{ ...input, id: "server", encryptedPassword: "not base64!" }],
      activeServerId: "server",
    });
    const service = await import("./config");
    await expect(service.getStreamingServer("server")).rejects.toThrow("重新输入密码");
  });

  it("无法识别的旧密文要求重新输入而不是当成认证失败", async () => {
    state.initial = JSON.stringify({
      servers: [
        {
          ...input,
          id: "server",
          encryptedPassword: Buffer.from([0xff, 0xfe, 0x00, 0x01]).toString("base64"),
        },
      ],
      activeServerId: "server",
    });
    const service = await import("./config");
    await expect(service.getStreamingServer("server")).rejects.toThrow("重新输入密码");
  });

  it("解密结果不是合法明文时要求重新输入", async () => {
    state.initial = JSON.stringify({
      servers: [
        {
          ...input,
          id: "server",
          encryptedPassword: `safe:v1:${Buffer.from("cipher:\uFFFD\u0001").toString("base64")}`,
        },
      ],
      activeServerId: "server",
    });
    const service = await import("./config");
    await expect(service.getStreamingServer("server")).rejects.toThrow("重新输入密码");
  });

  it("Linux basic_text 后端仍允许保存密码", async () => {
    state.backend = "basic_text";
    const service = await import("./config");
    const server = await service.addStreamingServer(input);
    expect(JSON.parse(state.persisted).servers[0].encryptedPassword).toMatch(/^safe:v1:/);
    expect((await service.getStreamingServer(server.id)).password).toBe("secret");
  });
});
