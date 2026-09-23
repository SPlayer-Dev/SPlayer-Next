import { getKgAppid, getKgClientver } from "../core/config";
import { getDeviceMid, signatureWebParams } from "../core/crypto";
import type { KGModule, KGParams } from "../core/types";
import { getSessionCookies, saveSessionCookies } from "@main/database/sessions";

const BASE_URL = "https://login-user.kugou.com";
const SRC_APPID = 2919;

const request = async (path: string, input: Record<string, unknown>): Promise<any> => {
  const params: Record<string, unknown> = {
    dfid: "-",
    mid: getDeviceMid(),
    uuid: "-",
    appid: 1001,
    clientver: getKgClientver(),
    clienttime: Math.floor(Date.now() / 1000),
    ...input,
  };
  params.signature = signatureWebParams(params);
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  );
  const response = await fetch(`${BASE_URL}${path}?${query}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`KG login HTTP ${response.status}`);
  return await response.json();
};

export const loginQrKey: KGModule = async () => {
  const appid = getKgAppid();
  const body = await request("/v2/qrcode", {
    type: 1,
    plat: 4,
    qrcode_txt: `https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=${appid}&`,
    srcappid: SRC_APPID,
  });
  const key = body?.data?.qrcode;
  if (!key) throw new Error("KG QR key missing");
  return {
    code: 200,
    key,
    content: `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${key}`,
  };
};

export const loginQrCheck: KGModule = async (params: KGParams) => {
  const key = String(params.key ?? "");
  if (!key) throw new Error("KG QR key missing");
  const body = await request("/v2/get_userinfo_qrcode", {
    plat: 4,
    appid: getKgAppid(),
    srcappid: SRC_APPID,
    qrcode: key,
  });
  const data = body?.data ?? {};
  const nickname = data.username ?? data.nickname ?? data.nick_name ?? data.user_name;
  const avatarUrl =
    data.userpic ?? data.user_pic ?? data.avatar ?? data.avatar_url ?? data.pic ?? data.user_img;
  if (Number(data.status) === 4) {
    saveSessionCookies("kugou", {
      ...getSessionCookies("kugou"),
      token: String(data.token ?? ""),
      userid: String(data.userid ?? ""),
      vip_token: String(data.vip_token ?? ""),
      vip_type: String(data.vip_type ?? 0),
      nickname: String(nickname ?? `KG ${data.userid ?? ""}`),
      avatar: String(avatarUrl ?? "").replace(/^http:\/\//, "https://"),
    });
  }
  return {
    code: 200,
    status: Number(data.status ?? 1),
    nickname,
    avatarUrl:
      typeof avatarUrl === "string" ? avatarUrl.replace(/^http:\/\//, "https://") : undefined,
  };
};
