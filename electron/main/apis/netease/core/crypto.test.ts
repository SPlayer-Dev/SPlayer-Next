import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDecipheriv,
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
} from "node:crypto";
import { xeapi } from "./crypto";

const staticKey = Buffer.from(
  "ab1d5a430f6bb04a3f01e81ddd72bd916d5ce591248ac128714806d7f8fb1b84",
  "hex",
);
const pair = generateKeyPairSync("x25519");
const publicKeyState = {
  version: "test-version",
  publicKey: Buffer.from(pair.publicKey.export({ format: "der", type: "spki" }))
    .subarray(-32)
    .toString("base64"),
  sk: "test-sk",
};

const decryptEcb = (key: Buffer, encrypted: Buffer): Buffer => {
  const decipher = createDecipheriv(`aes-${key.length * 8}-ecb`, key, null);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
};

/** 模拟服务端按 CSR 协议解包，验证字节布局和首次请求的动态密钥 */
const unpack = (encrypted: ReturnType<typeof xeapi>) => {
  const s = Buffer.from(encrypted.S, "base64");
  const peer = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), s.subarray(0, 32)]),
    format: "der",
    type: "spki",
  });
  const secret = diffieHellman({ privateKey: pair.privateKey, publicKey: peer });
  const prk = createHmac("sha256", Buffer.alloc(32)).update(secret).digest();
  const key = createHmac("sha256", prk)
    .update(Buffer.concat([s.subarray(0, 32), Buffer.from([1])]))
    .digest()
    .subarray(0, 16);
  const decipher = createDecipheriv("aes-128-gcm", key, s.subarray(32, 44));
  decipher.setAuthTag(s.subarray(-16));
  const envelope = Buffer.concat([
    decipher.update(s.subarray(44, -16)),
    decipher.final(),
  ]).toString();
  const [dynamicKey, os, sk] = envelope.split("|");
  const transformed = decryptEcb(
    Buffer.from(dynamicKey, "base64"),
    Buffer.from(encrypted.C, "base64url"),
  );
  const random = transformed.subarray(0, 16);
  const rotated = transformed.subarray(16);
  const rotation = (random[0] & 15) % rotated.length;
  const xored = Buffer.concat([
    rotated.subarray(rotated.length - rotation),
    rotated.subarray(0, rotated.length - rotation),
  ]);
  const ciphertext = Buffer.from(xored.map((byte, index) => byte ^ random[index & 15]));
  return {
    fields: JSON.parse(decryptEcb(staticKey, ciphertext).toString()),
    metadata: decryptEcb(staticKey, Buffer.from(encrypted.R, "base64")).toString(),
    dynamicKey: Buffer.from(dynamicKey, "base64"),
    os,
    sk,
  };
};

describe("xeapi CSR 协议", () => {
  it("首次请求可由服务端解包，表单正文使用 content，C 使用无填充 base64url", () => {
    const encrypted = xeapi(
      "/api/song?source=player",
      { id: "123", text: "中文", e_r: false },
      { publicKeyState },
    );
    assert.deepEqual(Object.keys(encrypted).sort(), ["C", "R", "S"]);
    assert.match(encrypted.C, /^[A-Za-z0-9_-]+$/);
    const result = unpack(encrypted);
    assert.deepEqual(result.fields, {
      queryString: "source=player&e_r=true",
      content: "id=123&text=%E4%B8%AD%E6%96%87",
    });
    assert.equal(result.metadata, "test-version|");
    assert.equal(result.os, "android");
    assert.equal(result.sk, "test-sk");
    assert.equal(result.dynamicKey.length, 16);
  });

  it("后续请求复用会话密钥和会话 ID", () => {
    const sessionKey = "12345678901234567890123456789012";
    const result = unpack(
      xeapi("/api/song", { id: 1 }, { publicKeyState, sessionKey, sessionId: "session" }),
    );
    assert.equal(result.dynamicKey.toString(), sessionKey);
    assert.equal(result.metadata, "test-version|session");
    assert.deepEqual(result.fields, { content: "id=1", queryString: "e_r=true" });
  });

  it("空正文不添加 content/body，其他类型正文使用 base64 并保留方法", () => {
    assert.deepEqual(unpack(xeapi("/api/song", { e_r: true }, { publicKeyState })).fields, {
      queryString: "e_r=true",
    });
    assert.deepEqual(
      unpack(
        xeapi(
          "/api/song",
          { id: 1 },
          { publicKeyState, contentType: "application/json", method: "PUT" },
        ),
      ).fields,
      {
        contentType: "application/json",
        method: "PUT",
        body: Buffer.from("id=1").toString("base64"),
        queryString: "e_r=true",
      },
    );
  });
});
