/**
 * KG 加密与签名工具
 */

import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { getKgAppid, getKgClientver, isKugouConceptMode } from "./config";

/** KG Android 签名盐值（标准版） */
const ANDROID_SIGN_SALT = "OIlwieks28dk2k092lksi2UIkp";
/** KG Android 签名盐值（概念版） */
const LITE_SIGN_SALT = "LnT6xpN3khm36zse0QzvmgTZ3waWdRSA";
/** KG Web 签名盐值 */
const WEB_SIGN_SALT = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt";
/** KG key 签名盐值（标准版） */
const SIGN_KEY_SALT = "57ae12eb6890223e355ccfcb74edf70d";
/** KG key 签名盐值（概念版） */
const LITE_SIGN_KEY_SALT = "185672dd44712f60bb1736df5a377e82";
const KG_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIAG7QOELSYoIJvTFJhMpe1s/gbjDJX51HBNnEl5HXqTW6lQ7LC8jr9fWZTwusknp+sVGzwd40MwP6U5yDE27M/X1+UR4tvOGOqp94TJtQ1EPnWGWXngpeIW5GxoQGao1rmYWAu6oi1z9XkChrsUdC6DJE5E221wf/4WLFxwAtRQIDAQAB
-----END PUBLIC KEY-----`;
const KG_LITE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDECi0Np2UR87scwrvTr72L6oO01rBbbBPriSDFPxr3Z5syug0O24QyQO8bg27+0+4kBzTBTBOZ/WWU0WryL1JSXRTXLgFVxtzIY41Pe7lPOgsfTCn5kZcvKhYKJesKnnJDNr5/abvTGf+rHG3YRwsCHcQ08/q6ifSioBszvb3QiwIDAQAB
-----END PUBLIC KEY-----`;

/** 概念版模式下的签名盐值集合 */
const currentSalts = () => ({
  androidSign: isKugouConceptMode() ? LITE_SIGN_SALT : ANDROID_SIGN_SALT,
  signKey: isKugouConceptMode() ? LITE_SIGN_KEY_SALT : SIGN_KEY_SALT,
  publicKey: isKugouConceptMode() ? KG_LITE_PUBLIC_KEY : KG_PUBLIC_KEY,
});

/**
 * 按 KG 客户端协议执行无填充 RSA 加密
 * @param data - 待加密对象
 * @returns 十六进制密文
 */
export const rsaEncryptKugou = (data: Record<string, unknown>): string => {
  const input = Buffer.from(JSON.stringify(data));
  const block = Buffer.alloc(128);
  input.copy(block);
  return publicEncrypt(
    { key: currentSalts().publicKey, padding: constants.RSA_NO_PADDING },
    block,
  ).toString("hex");
};

export const rsaEncryptKugouPkcs1 = (data: Record<string, unknown>): string =>
  publicEncrypt(
    { key: currentSalts().publicKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(JSON.stringify(data)),
  ).toString("hex");

export const encryptKugouDeviceData = (
  data: Record<string, unknown>,
): { key: string; content: string } => {
  const key = randomBytes(3).toString("hex");
  const digest = cryptoMd5(key);
  const cipher = createCipheriv("aes-128-cbc", digest.slice(0, 16), digest.slice(16, 32));
  const content = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]).toString(
    "base64",
  );
  return { key, content };
};

export const decryptKugouDeviceData = (content: Buffer, key: string): unknown => {
  const digest = cryptoMd5(key);
  const decipher = createDecipheriv("aes-128-cbc", digest.slice(0, 16), digest.slice(16, 32));
  const text = Buffer.concat([decipher.update(content), decipher.final()]).toString("utf8");
  return JSON.parse(text);
};

/**
 * 计算 MD5 哈希（32位小写 hex）
 * @param data - 要计算哈希的数据
 * @returns 32位小写 hex 哈希串
 */
export const cryptoMd5 = (data: string | Buffer | Record<string, unknown>): string => {
  const content =
    typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data ?? {});
  return createHash("md5").update(content).digest("hex");
};

/**
 * 根据 GUID 计算设备 MID（大整数进制转换）
 * @param guid - 设备 GUID 字符串
 * @returns MID 十进制字符串
 */
export const calculateMid = (guid = "550e8400-e29b-41d4-a716-446655440000"): string => {
  const digest = cryptoMd5(guid);
  return BigInt(`0x${digest}`).toString(10);
};

let cachedMid: string | null = null;

/**
 * 获取或生成设备 MID
 * @returns 设备 MID 十进制字符串
 */
export const getDeviceMid = (): string => {
  if (!cachedMid) {
    cachedMid = calculateMid("splayer-next-kugou-device-mid");
  }
  return cachedMid;
};

/**
 * Android 版 API 请求签名
 * 算法：MD5(salt + 排序后的 key=value + data + salt)
 * @param params - 查询或请求参数
 * @param data - 可选的请求体数据
 * @returns 32位签名字符串
 */
export const signatureAndroidParams = (
  params: Record<string, unknown>,
  data: string | Buffer = "",
): string => {
  const paramsString = Object.keys(params)
    .sort()
    .map((key) => {
      const val = typeof params[key] === "object" ? JSON.stringify(params[key]) : params[key];
      return `${key}=${val ?? ""}`;
    })
    .join("");
  const bodyStr = typeof data === "string" ? data : data.toString("utf8");
  return cryptoMd5(
    `${currentSalts().androidSign}${paramsString}${bodyStr}${currentSalts().androidSign}`,
  );
};

/**
 * Web 版 API 请求签名
 * @param params - 请求参数
 * @returns 32位签名字符串
 */
export const signatureWebParams = (params: Record<string, unknown>): string => {
  const paramsString = Object.keys(params)
    .map((key) => `${key}=${params[key] ?? ""}`)
    .sort()
    .join("");
  return cryptoMd5(`${WEB_SIGN_SALT}${paramsString}${WEB_SIGN_SALT}`);
};

/**
 * 参数密钥签名（signParamsKey）
 * 算法：MD5(appid + salt + clientver + data)
 * @param data - 签名数据（时间戳或 hash）
 * @param appid - 应用 ID
 * @param clientver - 客户端版本号
 * @returns 32位签名字符串
 */
export const signParamsKey = (
  data: string | number,
  appid = getKgAppid(),
  clientver = getKgClientver(),
): string => {
  return cryptoMd5(`${appid}${currentSalts().androidSign}${clientver}${data}`);
};

/**
 * 请求密钥签名（signKey）
 * 算法：MD5(hash + salt + appid + mid + userid)
 * @param hash - 音频 hash
 * @param mid - 设备 MID
 * @param userid - 用户 ID
 * @param appid - 应用 ID
 * @returns 32位签名字符串
 */
export const signKey = (
  hash: string,
  mid = getDeviceMid(),
  userid: number | string = 0,
  appid = getKgAppid(),
): string => {
  return cryptoMd5(`${hash}${currentSalts().signKey}${appid}${mid}${userid}`);
};

/**
 * 清除KG响应文本中的标签包裹（<!--KG_TAG_RES_START--> 等）
 * @param text - 原始响应文本
 * @returns 纯 JSON 文本
 */
export const cleanKgResponse = (text: string): string => {
  return text
    .trim()
    .replace(/^<!--KG_TAG_RES_START-->/, "")
    .replace(/<!--KG_TAG_RES_END-->$/, "");
};
