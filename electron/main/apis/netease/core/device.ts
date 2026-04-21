/**
 * 进程级设备信息
 * - deviceId：52 位大写十六进制字符，进程启动时生成一次
 * - anonymous token：匿名态下注入 header 的 MUSIC_A（由 register_anonimous 接口返回后刷新）
 */

import { randomBytes } from "node:crypto";

const generate = (): string => randomBytes(26).toString("hex").toUpperCase();

let deviceId = generate();
let anonymousToken = "";

export const getDeviceId = (): string => deviceId;

export const setDeviceId = (id: string): void => {
  deviceId = id;
};

export const regenerateDeviceId = (): string => {
  deviceId = generate();
  return deviceId;
};

export const getAnonymousToken = (): string => anonymousToken;

export const setAnonymousToken = (token: string): void => {
  anonymousToken = token;
};
