import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ available: true, persisted: "", initial: "", writes: vi.fn() }));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: (text: string) => Buffer.from(`cipher:${text}`),
    decryptString: (buffer: Buffer) => {
      if (!buffer.toString().startsWith("cipher:")) throw new Error("invalid ciphertext");
      return buffer.toString().slice(7);
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
    const server = service.addStreamingServer(input);
    expect(server.mediaRevision).toBe(0);
    expect(
      service.updateStreamingServer(server.id, { ...input, name: "新名称", password: "" })
        .mediaRevision,
    ).toBe(0);
    expect(
      service.updateStreamingServer(server.id, { ...input, username: "other", password: "" })
        .mediaRevision,
    ).toBe(1);
    expect(
      service.updateStreamingServer(server.id, { ...input, username: "other" }).mediaRevision,
    ).toBe(2);
  });
  it("新密码带加密版本标识，renderer 视图没有凭据", async () => {
    const service = await import("./config");
    const server = service.addStreamingServer(input);
    expect(JSON.parse(state.persisted).servers[0].encryptedPassword).toMatch(/^safe:v1:/);
    expect(service.getStreamingServer(server.id).password).toBe("secret");
    expect(server).not.toHaveProperty("password");
    expect(server).not.toHaveProperty("encryptedPassword");
  });

  it("安全存储不可用时拒绝保存，不写入 base64 明文", async () => {
    const service = await import("./config");
    state.available = false;
    expect(() => service.addStreamingServer(input)).toThrow("安全存储不可用");
    expect(service.getStreamingConfig().servers).toHaveLength(0);
    expect(state.writes).not.toHaveBeenCalled();
  });

  it("加密不可用时无法把旧密文误当成明文密码", async () => {
    const service = await import("./config");
    const server = service.addStreamingServer(input);
    state.available = false;
    expect(() => service.getStreamingServer(server.id)).toThrow("无法读取");
    state.available = true;
    expect(service.getStreamingServer(server.id).password).toBe("secret");
  });

  it("兼容旧加密文件，历史明文回退要求重新输入而非错误解密", async () => {
    state.initial = JSON.stringify({
      servers: [
        { ...input, id: "server", encryptedPassword: Buffer.from("cipher:old").toString("base64") },
      ],
      activeServerId: "server",
    });
    const service = await import("./config");
    expect(service.getStreamingServer("server").password).toBe("old");
    vi.resetModules();
    state.initial = JSON.stringify({
      servers: [
        { ...input, id: "server", encryptedPassword: Buffer.from("old").toString("base64") },
      ],
      activeServerId: "server",
    });
    const legacy = await import("./config");
    expect(() => legacy.getStreamingServer("server")).toThrow("重新输入密码");
    legacy.updateStreamingServer("server", { ...input, password: "new" });
    expect(legacy.getStreamingServer("server").password).toBe("new");
  });
});
