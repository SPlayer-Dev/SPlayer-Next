/**
 * xeapi 公钥获取与会话状态
 *
 * 反爬接口（如游客注册）走 xeapi：先向 /api/gorilla/anti/crawler/security/key/get
 * 拉取 X25519 公钥包（缓存于进程），首次请求后服务端经响应头下发会话密钥，后续请求复用。
 */

import { API_DOMAIN, UA_MAP } from "./config";
import { xeapiSign, xeapiDecryptPublicKey, type XeapiPublicKey } from "./crypto";
import { fetchWithProxy } from "@main/utils/proxy";

let publicKeyState: XeapiPublicKey | null = null;
let sessionId = "";
let sessionKey = "";

/** 16 位数字 nonce */
const generateNonce = (): string => {
  let nonce = "";
  for (let i = 0; i < 16; i++) nonce += Math.floor(Math.random() * 10).toString();
  return nonce;
};

/** 向反爬接口拉取并解密公钥包 */
const fetchPublicKey = async (
  deviceId: string,
  currentKeyVersion: string,
): Promise<XeapiPublicKey> => {
  const nonce = generateNonce();
  const timestamp = String(Date.now());
  const data: Record<string, string> = {
    appVersion: "9.1.65",
    currentKeyVersion,
    deviceId,
    nonce,
    os: "android",
    requestType: "active",
    signature: xeapiSign(timestamp, nonce),
    t1: "",
    t2: "",
    timestamp,
    uid: "",
  };

  const res = await fetchWithProxy(`${API_DOMAIN}/api/gorilla/anti/crawler/security/key/get`, {
    method: "POST",
    headers: {
      "User-Agent": UA_MAP.api.android,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: deviceId ? `deviceId=${encodeURIComponent(deviceId)}` : "",
    },
    body: new URLSearchParams(data).toString(),
    signal: AbortSignal.timeout(8000),
  });

  const json = (await res.json()) as {
    code?: number;
    data?: { encryptedData?: string; signature?: string; timestamp?: string };
  };
  const payload = json?.data;
  if (json?.code !== 200 || !payload?.encryptedData) {
    throw new Error("xeapi public key request failed");
  }
  if (!payload.signature || xeapiSign(payload.timestamp ?? "", nonce) !== payload.signature) {
    throw new Error("xeapi public key response signature mismatch");
  }
  const key = xeapiDecryptPublicKey(payload.encryptedData);
  if (!key.sk) throw new Error("xeapi public key response missing sk");
  return key;
};

/** 确保已有公钥（缺失则拉取并缓存），返回当前公钥状态 */
export const ensureXeapiKey = async (deviceId: string): Promise<XeapiPublicKey> => {
  if (publicKeyState?.sk) return publicKeyState;
  const key = await fetchPublicKey(deviceId, publicKeyState?.version ?? "");
  if (!key.sk && publicKeyState?.sk) key.sk = publicKeyState.sk;
  publicKeyState = key;
  return key;
};

/** 读取当前会话（首次请求为空） */
export const getXeapiSession = (): { sessionId: string; sessionKey: string } => ({
  sessionId,
  sessionKey,
});

/** 服务端响应头下发的会话密钥 */
export const updateXeapiSession = (id: string, key: string): void => {
  sessionId = id;
  sessionKey = key;
};

/** 失效时清空（下次重新拉取） */
export const resetXeapiKey = (): void => {
  publicKeyState = null;
  sessionId = "";
  sessionKey = "";
};
