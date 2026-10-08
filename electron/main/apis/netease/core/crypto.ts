/**
 * Netease API 加解密层
 *
 * - 加密方式：weapi（web 端）、linuxapi（Linux 客户端）、eapi（桌面/移动客户端）、xeapi（反爬）
 * - 各对应对称密钥 + RSA 公钥；全部用 Node 原生 node:crypto 实现，不引第三方加密库
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  publicEncrypt,
  constants,
  randomBytes,
  randomInt,
} from "node:crypto";
import { gunzipSync } from "node:zlib";
import { BASE62, EAPI_KEY, IV, LINUX_API_KEY, PRESET_KEY, PUBLIC_KEY } from "./config";

/**
 * AES 加密
 * @param text 明文
 * @param mode 加密模式
 * @param key 密钥
 * @param iv 初始化向量
 * @param format 输出格式
 * @returns 加密后的文本
 */
export const aesEncrypt = (
  text: string | Buffer,
  mode: "cbc" | "ecb",
  key: string,
  iv: string,
  format: "base64" | "hex" = "base64",
): string => {
  const algorithm = mode === "cbc" ? "aes-128-cbc" : "aes-128-ecb";
  const ivBuf = mode === "cbc" ? Buffer.from(iv, "utf8") : Buffer.alloc(0);
  const cipher = createCipheriv(algorithm, Buffer.from(key, "utf8"), ivBuf);
  const encrypted = Buffer.concat([
    cipher.update(typeof text === "string" ? Buffer.from(text, "utf8") : text),
    cipher.final(),
  ]);
  return format === "base64"
    ? encrypted.toString("base64")
    : encrypted.toString("hex").toUpperCase();
};

/**
 * AES 解密
 * @param ciphertext 密文
 * @param key 密钥
 * @param format 输出格式
 * @returns 解密后的文本
 */
export const aesDecrypt = (
  ciphertext: string,
  key: string,
  format: "base64" | "hex" = "base64",
): Buffer => {
  const decipher = createDecipheriv("aes-128-ecb", Buffer.from(key, "utf8"), Buffer.alloc(0));
  const input = Buffer.from(ciphertext, format);
  return Buffer.concat([decipher.update(input), decipher.final()]);
};

/**
 * RSA 加密
 *
 * 网易云的 weapi 要求「裸 RSA」：将明文左侧补 0 到 128 字节（1024bit 模长），
 * 再用公钥做一次模幂运算，输出 hex。node:crypto 的 RSA_NO_PADDING 正好对应
 */
export const rsaEncrypt = (str: string, publicKey: string = PUBLIC_KEY): string => {
  const buffer = Buffer.alloc(128);
  const data = Buffer.from(str, "utf8");
  data.copy(buffer, 128 - data.length);
  const encrypted = publicEncrypt({ key: publicKey, padding: constants.RSA_NO_PADDING }, buffer);
  return encrypted.toString("hex");
};

/**
 * weapi 加密
 * 1) 生成 16 字节随机 base62 secretKey
 * 2) 明文经 AES-CBC(PRESET_KEY) 加密一次，再用 secretKey 再加密一次
 * 3) secretKey 倒序后用 RSA 加密为 encSecKey
 * @param object 业务参数
 * @returns 加密后的参数
 */
export const weapi = (object: unknown): { params: string; encSecKey: string } => {
  const text = JSON.stringify(object);
  let secretKey = "";
  for (let i = 0; i < 16; i++) {
    secretKey += BASE62.charAt(randomInt(0, 62));
  }
  const first = aesEncrypt(text, "cbc", PRESET_KEY, IV);
  const params = aesEncrypt(first, "cbc", secretKey, IV);
  const encSecKey = rsaEncrypt(secretKey.split("").reverse().join(""));
  return { params, encSecKey };
};

/**
 * linuxapi 加密
 * @param object 业务参数
 * @returns 加密后的参数
 */
export const linuxapi = (object: unknown): { eparams: string } => {
  const text = JSON.stringify(object);
  return { eparams: aesEncrypt(text, "ecb", LINUX_API_KEY, "", "hex") };
};

/**
 * eapi 加密
 * 1) 用 url + 明文 + 固定盐拼接后 MD5 作为签名 digest
 * 2) 整串 `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}` 经 AES-ECB(hex) 加密
 * @param url 接口路径
 * @param object 业务参数
 * @returns 加密后的参数
 */
export const eapi = (url: string, object: unknown): { params: string } => {
  const text = typeof object === "object" ? JSON.stringify(object) : String(object);
  const message = `nobody${url}use${text}md5forencrypt`;
  const digest = createHash("md5").update(message).digest("hex");
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  return { params: aesEncrypt(data, "ecb", EAPI_KEY, "", "hex") };
};

/**
 * eapi 响应解密
 * @param encryptedHex 加密后的文本
 * @param aeapi 是否是 gzip 压缩的
 * @returns 解密后的文本
 */
export const eapiResDecrypt = (encryptedHex: string, aeapi = false): unknown => {
  try {
    const decrypted = aesDecrypt(encryptedHex, EAPI_KEY, "hex");
    if (aeapi) {
      const decompressed = gunzipSync(decrypted);
      return JSON.parse(decompressed.toString("utf8"));
    }
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return null;
  }
};

/**
 * eapi 请求体解密
 * @param encryptedHex 加密后的文本
 * @returns 解密后的文本
 */
export const eapiReqDecrypt = (encryptedHex: string): { url: string; data: unknown } | null => {
  const text = aesDecrypt(encryptedHex, EAPI_KEY, "hex").toString("utf8");
  const match = text.match(/(.*?)-36cd479b6b5-(.*?)-36cd479b6b5-(.*)/);
  if (!match) return null;
  return { url: match[1], data: JSON.parse(match[2]) };
};

// ---- xeapi（反爬加密）----

/** xeapi 固定对称密钥（AES-256-ECB） */
const XEAPI_STATIC_KEY = Buffer.from(
  "ab1d5a430f6bb04a3f01e81ddd72bd916d5ce591248ac128714806d7f8fb1b84",
  "hex",
);
/** xeapi 签名密钥（HMAC-SHA256，按字符串原样作为 key，不解码） */
const XEAPI_SIGN_KEY =
  "mUHCwVNWJbunMqAHf5MImuirT6plvs6VSFW62MGHstFQxhBGdEoIhLItH3djc4+FB/OKty3+lL2rGeoFBpVe5g==";
/** X25519 公钥的 RFC 8410 SPKI 固定前缀（裸 32 字节前补此头再导入） */
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

/** xeapi 服务端公钥状态（反爬接口返回并缓存） */
export interface XeapiPublicKey {
  version: string;
  publicKey: string;
  sk?: string;
  [key: string]: unknown;
}

/** xeapi 加密可选参数 */
export interface XeapiOptions {
  publicKeyState: XeapiPublicKey;
  sessionId?: string;
  sessionKey?: string;
  os?: string;
  appver?: string;
  deviceId?: string;
  uid?: string;
  method?: string;
  contentType?: string;
}

/** 变长密钥 AES-ECB 加密（按密钥长度选 128/256，PKCS7 padding） */
const aesEcbEncrypt = (key: Buffer, plaintext: Buffer): Buffer => {
  const cipher = createCipheriv(`aes-${key.length * 8}-ecb`, key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
};

/** 变长密钥 AES-ECB 解密 */
const aesEcbDecrypt = (key: Buffer, ciphertext: Buffer): Buffer => {
  const decipher = createDecipheriv(`aes-${key.length * 8}-ecb`, key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
};

/** 裸 32 字节 X25519 公钥补 SPKI 头后导入为 KeyObject */
const createX25519PublicKey = (raw: Buffer) =>
  createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });

/** 由 ECDH 共享密钥 + 临时公钥派生 16 字节 AES 密钥（HKDF 风格） */
const deriveX25519AesKey = (sharedSecret: Buffer, ephemeralPublicKey: Buffer): Buffer => {
  const prk = createHmac("sha256", Buffer.alloc(32))
    .update(sharedSecret.length ? sharedSecret : Buffer.alloc(32))
    .digest();
  return createHmac("sha256", prk)
    .update(Buffer.concat([ephemeralPublicKey, Buffer.from([1])]))
    .digest()
    .subarray(0, 16);
};

/** xeapi 反爬签名：HMAC-SHA256(signKey, timestamp+nonce) → base64 */
export const xeapiSign = (timestamp: string | number, nonce: string): string =>
  createHmac("sha256", XEAPI_SIGN_KEY)
    .update(String(timestamp) + nonce)
    .digest("base64");

/** 中间层变换：随机 XOR → base64 → 随机旋转 */
const xeapiMidTransform = (ciphertext: Buffer): Buffer => {
  const random = randomBytes(16);
  const xored = Buffer.alloc(ciphertext.length);
  for (let i = 0; i < ciphertext.length; i++) xored[i] = ciphertext[i] ^ random[i & 0x0f];
  const b64 = Buffer.from(xored.toString("base64"));
  const rot = b64.length ? (random[0] & 0x0f) % b64.length : 0;
  return Buffer.concat([random, b64.subarray(rot), b64.subarray(0, rot)]);
};

/** 用 X25519 ECDH + AES-GCM 封装动态密钥（S 字段） */
const xeapiEncryptS = (dynamicKey: Buffer, publicKeyState: XeapiPublicKey, os: string): Buffer => {
  const peerKey = createX25519PublicKey(Buffer.from(publicKeyState.publicKey, "base64"));
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const ephemeralRaw = Buffer.from(publicKey.export({ format: "der", type: "spki" })).subarray(-32);
  const sharedSecret = diffieHellman({ privateKey, publicKey: peerKey });
  const aesKey = deriveX25519AesKey(sharedSecret, ephemeralRaw);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-128-gcm", aesKey, iv);
  const plaintext = Buffer.from(
    `${dynamicKey.toString("base64")}|${os}|${publicKeyState.sk || ""}`,
  );
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([ephemeralRaw, iv, encrypted, cipher.getAuthTag()]);
};

/** 构造 xeapi 明文（JSON：body/queryString/...） */
const buildXeapiPlaintext = (
  uri: string,
  data: Record<string, unknown>,
  options: XeapiOptions,
): string => {
  const fields: Record<string, string> = {};
  const contentType = options.contentType || "application/x-www-form-urlencoded;charset=utf-8";
  if (contentType.split(";", 1)[0].toLowerCase() !== "application/x-www-form-urlencoded") {
    fields.contentType = contentType;
  }
  const method = (options.method || "POST").toUpperCase();
  if (method !== "POST") fields.method = method;
  const url = new URL(uri, "https://interface.music.163.com");
  if (url.search) fields.queryString = url.search.slice(1);
  if (data !== undefined && data !== null) {
    const bodyData = { ...data };
    delete bodyData.e_r;
    const body = new URLSearchParams(bodyData as Record<string, string>).toString();
    fields.body = Buffer.from(body).toString("base64");
  }
  fields.queryString = fields.queryString ? `${fields.queryString}&e_r=true` : "e_r=true";
  return JSON.stringify(fields);
};

/** xeapi 加密：返回 B / S / R 三段 base64 */
export const xeapi = (
  uri: string,
  data: Record<string, unknown>,
  options: XeapiOptions,
): { B: string; S: string; R: string } => {
  const { publicKeyState } = options;
  const activeSessionKey = options.sessionKey ? Buffer.from(String(options.sessionKey)) : null;
  const activeSessionId = options.sessionId || "";
  const dynamicKey = activeSessionKey || randomBytes(16);
  const plaintext = Buffer.from(buildXeapiPlaintext(uri, data, options));
  const b = aesEcbEncrypt(
    dynamicKey,
    xeapiMidTransform(aesEcbEncrypt(XEAPI_STATIC_KEY, plaintext)),
  );
  const s = xeapiEncryptS(dynamicKey, publicKeyState, options.os || "android");
  const r = aesEcbEncrypt(
    XEAPI_STATIC_KEY,
    Buffer.from(`${publicKeyState.version}|${activeSessionKey ? activeSessionId : ""}`),
  );
  return { B: b.toString("base64"), S: s.toString("base64"), R: r.toString("base64") };
};

/** xeapi 响应解密：AES-ECB(eapiKey) + 可选 gunzip + JSON */
export const xeapiResDecrypt = (body: Buffer): unknown => {
  const decrypted = aesEcbDecrypt(Buffer.from(EAPI_KEY, "utf8"), body);
  const plaintext =
    decrypted[0] === 0x1f && decrypted[1] === 0x8b ? gunzipSync(decrypted) : decrypted;
  return JSON.parse(plaintext.toString());
};

/** 解密反爬接口返回的公钥包 */
export const xeapiDecryptPublicKey = (encryptedData: string): XeapiPublicKey =>
  JSON.parse(aesEcbDecrypt(XEAPI_STATIC_KEY, Buffer.from(encryptedData, "base64")).toString());
