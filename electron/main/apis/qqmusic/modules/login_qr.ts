/**
 * QM 二维码登录模块
 *
 * 支持 QQ 扫码与微信扫码两种原生扫码登录协议
 */

import { randomUUID } from "node:crypto";
import { qmRequest, mergeQQMusicCookies } from "../core/request";
import {
  credentialToSession,
  getCredentialMusicId,
  type QQMusicCredential,
} from "../core/credential";
import { coreLog } from "@main/utils/logger";
import type { QMModule, QMParams } from "../core/types";

const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** QQ 系哈希算法（用于 ptqrtoken 及 g_tk 计算） */
const hash33 = (str: string, seed = 0): number => {
  let h = seed;
  for (let i = 0; i < str.length; i++) {
    h = (((h << 5) + h + str.charCodeAt(i)) & 0xffffffff) >>> 0;
  }
  return h & 2147483647;
};

/** 从 HTTP 响应中提取 Set-Cookie 并与已有 Cookies 合并 */
const extractCookies = (
  res: Response,
  existingCookies: Record<string, string> = {},
): Record<string, string> => {
  const cookieMap: Record<string, string> = { ...existingCookies };
  const rawList = res.headers.getSetCookie?.() ?? [];
  if (rawList.length > 0) {
    for (const raw of rawList) {
      const first = raw.split(";")[0];
      const eqIdx = first.indexOf("=");
      if (eqIdx > 0) {
        const name = first.slice(0, eqIdx).trim();
        const value = first.slice(eqIdx + 1).trim();
        if (name && value) cookieMap[name] = value;
      }
    }
  } else {
    const single = res.headers.get("set-cookie");
    if (single) {
      for (const part of single.split(/,\s*(?=[a-zA-Z0-9_-]+=)/)) {
        const first = part.split(";")[0];
        const eqIdx = first.indexOf("=");
        if (eqIdx > 0) {
          const name = first.slice(0, eqIdx).trim();
          const value = first.slice(eqIdx + 1).trim();
          if (name && value) cookieMap[name] = value;
        }
      }
    }
  }
  return cookieMap;
};

/** 序列化 Cookie 对象为 Header 字符串 */
const stringifyCookies = (cookies: Record<string, string>): string =>
  Object.entries(cookies)
    .filter(([_, v]) => !!v)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

/**
 * 获取二维码 Key 及图片内容
 * @param params.type 扫码类型，'qq' 或 'wx'，默认 'qq'
 */
export const login_qr_key: QMModule = async (params: QMParams) => {
  const type = String(params.type ?? "qq").toLowerCase();

  if (type === "wx") {
    const searchParams = new URLSearchParams({
      appid: "wx48db31d50e334801",
      redirect_uri: "https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/",
      response_type: "code",
      scope: "snsapi_login",
      state: "STATE",
      href: "https://y.qq.com/mediastyle/music_v17/src/css/popup_wechat.css#wechat_redirect",
    });
    const res = await fetch(`https://open.weixin.qq.com/connect/qrconnect?${searchParams}`, {
      headers: { "User-Agent": WEB_UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`获取微信登录页面失败: HTTP ${res.status}`);
    const html = await res.text();
    const match = /uuid=([^"]+)"/.exec(html) || /uuid=([a-zA-Z0-9_-]+)/.exec(html);
    if (!match) throw new Error("获取微信登录二维码 uuid 失败");
    const uuid = match[1];

    const qrRes = await fetch(`https://open.weixin.qq.com/connect/qrcode/${uuid}`, {
      headers: {
        Referer: "https://open.weixin.qq.com/connect/qrconnect",
        "User-Agent": WEB_UA,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!qrRes.ok) throw new Error(`获取微信登录二维码图片失败: HTTP ${qrRes.status}`);
    const qrBuffer = await qrRes.arrayBuffer();
    const base64 = Buffer.from(qrBuffer).toString("base64");

    return {
      code: 200,
      key: uuid,
      content: `data:image/jpeg;base64,${base64}`,
      type: "wx",
    };
  }

  // 默认 QQ 扫码
  const url = `https://ssl.ptlogin2.qq.com/ptqrshow?appid=716027609&e=2&l=M&s=3&d=72&v=4&t=${Math.random()}&daid=383&pt_3rd_aid=100497308`;
  const res = await fetch(url, {
    headers: {
      Referer: "https://xui.ptlogin2.qq.com/",
      "User-Agent": WEB_UA,
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`获取 QQ 登录二维码失败: HTTP ${res.status}`);
  const cookies = extractCookies(res);
  const qrsig = cookies.qrsig;
  if (!qrsig) throw new Error("未能获取到 QQ 登录 qrsig");

  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");

  return {
    code: 200,
    key: qrsig,
    content: `data:image/png;base64,${base64}`,
    type: "qq",
  };
};

/**
 * 轮询二维码扫描状态
 * @param params.key 二维码 Key（QQ 为 qrsig，微信为 uuid）
 * @param params.type 扫码类型，'qq' 或 'wx'
 */
export const login_qr_check: QMModule = async (params: QMParams) => {
  const key = String(params.key ?? "");
  const type = String(params.type ?? "qq").toLowerCase();
  if (!key) throw new Error("缺少二维码 key");

  if (type === "wx") {
    const query = new URLSearchParams({
      uuid: key,
      _: String(Date.now()),
    });
    const res = await fetch(`https://lp.open.weixin.qq.com/connect/l/qrconnect?${query}`, {
      headers: {
        Referer: "https://open.weixin.qq.com/",
        "User-Agent": WEB_UA,
      },
      signal: AbortSignal.timeout(35000),
    });
    const text = await res.text();
    const match = /window\.wx_errcode=(\d+);window\.wx_code='([^']*)'/.exec(text);
    if (!match) {
      return { code: 200, status: 1 };
    }
    const errcode = Number(match[1]);
    const wxCode = match[2];

    if (errcode === 404) {
      return { code: 200, status: 2 }; // 已扫码待确认
    }
    if (errcode === 402 || errcode === 403) {
      return { code: 200, status: 0 }; // 已过期或已取消
    }
    if (errcode === 405 && wxCode) {
      const wxLoginData = await qmRequest<QQMusicCredential>(
        "music.login.LoginServer",
        "Login",
        { code: wxCode, strAppid: "wx48db31d50e334801" },
        { session: false, comm: { tmeLoginType: 1 } },
      );

      const uinStr = getCredentialMusicId(wxLoginData);
      if (!uinStr || !wxLoginData.musickey) throw new Error("微信登录响应缺少有效凭据");
      const savedCookies = credentialToSession(wxLoginData, 1);
      mergeQQMusicCookies(savedCookies);
      coreLog.info(`[qm-login] 微信扫码登录成功 (uin: ${uinStr})`);

      return {
        code: 200,
        status: 4,
        nickname: wxLoginData.nick || wxLoginData.nickname,
        avatarUrl: wxLoginData.logo || wxLoginData.avatarUrl,
      };
    }

    return { code: 200, status: 1 };
  }

  // QQ 扫码检查
  const ptqrtoken = hash33(key, 0);
  const query = new URLSearchParams({
    u1: "https://graph.qq.com/oauth2.0/login_jump",
    ptqrtoken: String(ptqrtoken),
    ptredirect: "0",
    h: "1",
    t: "1",
    g: "1",
    from_ui: "1",
    ptlang: "2052",
    action: `0-0-${Date.now()}`,
    js_ver: "20102616",
    js_type: "1",
    pt_uistyle: "40",
    aid: "716027609",
    daid: "383",
    pt_3rd_aid: "100497308",
    has_onekey: "1",
  });
  const res = await fetch(`https://ssl.ptlogin2.qq.com/ptqrlogin?${query}`, {
    headers: {
      Referer: "https://xui.ptlogin2.qq.com/",
      Cookie: `qrsig=${key};`,
      "User-Agent": WEB_UA,
    },
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  const match = /ptuiCB\((.*?)\)/.exec(text);
  if (!match) return { code: 200, status: 1 };

  const args = [...match[1].matchAll(/'((?:\\.|[^'])*)'/g)].map((m) => m[1]);
  const statusCode = args[0];
  const nickname = args[5] || "";

  if (statusCode === "65") {
    return { code: 200, status: 0 }; // 已失效
  }
  if (statusCode === "67") {
    return { code: 200, status: 2, nickname }; // 正在验证中
  }
  if (statusCode === "0") {
    const jumpUrl = args[2] ?? "";
    if (!jumpUrl || !jumpUrl.startsWith("http")) {
      throw new Error(`无效的跳转链接: ${jumpUrl}`);
    }

    // 收集 ptqrlogin 返回的所有 cookies 并附带 qrsig
    const initialCookies = extractCookies(res, { qrsig: key });

    // 请求 check_sig 校验跳转并建立会话 Cookie
    coreLog.info("[qm-login] 正在执行 check_sig 授权...", { jumpUrl });
    const checkSigRes = await fetch(jumpUrl, {
      headers: {
        Referer: "https://xui.ptlogin2.qq.com/",
        Cookie: stringifyCookies(initialCookies),
        "User-Agent": WEB_UA,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });

    const sessionCookies = extractCookies(checkSigRes, initialCookies);
    const p_skey =
      sessionCookies.p_skey || sessionCookies.p_sKey || sessionCookies.skey || sessionCookies.pskey;

    if (!p_skey) {
      coreLog.warn("[qm-login] check_sig 未提取到 p_skey:", {
        status: checkSigRes.status,
        headers: Object.fromEntries(checkSigRes.headers.entries()),
        cookies: sessionCookies,
      });
      throw new Error("获取 p_skey 失败");
    }

    // 请求 authorize 换取授权 code
    const authBody = new URLSearchParams({
      response_type: "code",
      client_id: "100497308",
      redirect_uri: "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/",
      scope: "get_user_info,get_app_friends",
      state: "state",
      switch: "",
      from_ptlogin: "1",
      src: "1",
      update_auth: "1",
      openapi: "1010_1030",
      g_tk: String(hash33(p_skey, 5381)),
      auth_time: String(Date.now()),
      ui: randomUUID(),
    });
    const authRes = await fetch("https://graph.qq.com/oauth2.0/authorize", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: "https://xui.ptlogin2.qq.com/",
        Cookie: stringifyCookies(sessionCookies),
        "User-Agent": WEB_UA,
      },
      body: authBody.toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    const location = authRes.headers.get("Location") || authRes.headers.get("location") || "";
    const codeMatch = /(?<=code=)(.+?)(?=&|$)/.exec(location);
    if (!codeMatch) {
      coreLog.warn("[qm-login] authorize 未返回 code:", {
        status: authRes.status,
        location,
      });
      throw new Error("获取 QQ 授权 code 失败");
    }
    const code = codeMatch[1];

    // QQLogin 换取音乐凭据
    const qqLoginData = await qmRequest<QQMusicCredential>(
      "QQConnectLogin.LoginServer",
      "QQLogin",
      { code },
      { session: false, comm: { tmeLoginType: 2 } },
    );

    const uinMatch = /(?:\?|&)uin=(.+?)&/.exec(jumpUrl);
    const uin = uinMatch?.[1] || "";
    const uinStr = getCredentialMusicId(qqLoginData, uin);
    if (!uinStr || !qqLoginData.musickey) throw new Error("QQ 登录响应缺少有效凭据");
    const savedCookies = credentialToSession(qqLoginData, 2, uin);
    mergeQQMusicCookies(savedCookies);
    coreLog.info(`[qm-login] QQ 扫码登录成功 (uin: ${uinStr})`);

    return {
      code: 200,
      status: 4,
      nickname: qqLoginData.nick || qqLoginData.nickname || nickname,
      avatarUrl:
        qqLoginData.logo ||
        qqLoginData.avatarUrl ||
        `https://q.qlogo.cn/headimg_dl?dst_uin=${uinStr}&spec=100`,
    };
  }

  return { code: 200, status: 1 };
};
