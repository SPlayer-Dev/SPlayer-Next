/**
 * Netease API 加解密层（完整移植自 @neteasecloudmusicapienhanced/api util/crypto.js）
 *
 * - 三套加密：weapi（web 端）、linuxapi（Linux 客户端）、eapi（桌面/移动客户端）
 * - 对应三把对称密钥 + 一把 RSA 公钥
 * - 原实现依赖 crypto-js + node-forge，这里用 Node 原生 node:crypto 等价重写
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  publicEncrypt,
  constants,
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
