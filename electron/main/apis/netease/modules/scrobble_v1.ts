/**
 * 听歌打卡 - NCBL 加密版
 *
 * 仿桌面客户端 PLV/PLD 上报。
 */

import type { NeteaseModule } from "../core/types";
import {
  buildCookieStr,
  buildMetaJson,
  buildRecords,
  doUpload,
  extractContext,
} from "../core/ncbl";
import {
  buildPld,
  buildPlv,
  parseCookie,
  toNcblSourceType,
  type PlaybackLogResource,
} from "../core/playLog";

const scrobbleV1: NeteaseModule = async (query) => {
  const resourceId = Number(query.id);
  if (!resourceId || Number.isNaN(resourceId)) {
    return { status: 400, body: { code: 400, msg: "缺少有效的资源 ID" }, cookie: [] };
  }
  const playTime = Number(query.time);
  if (Number.isNaN(playTime) || playTime <= 0) {
    return { status: 400, body: { code: 400, msg: "缺少有效的 time (播放时长)" }, cookie: [] };
  }

  const totalTime = Number(query.total) || playTime;
  const sourceId = String(query.sourceid || query.sourceId || "");
  const resourceType = query.resourceType === "dj" ? "dj" : "song";
  const sourceType = typeof query.sourceType === "string" ? query.sourceType : "song";
  const ncblSourceType = toNcblSourceType(resourceType, sourceType);
  const rawFee = Number(query.fee);
  const fee = rawFee === 1 || rawFee === 4 || rawFee === 8 ? rawFee : 0;
  const rawCookie = query.cookie || "";
  const cookieObj = parseCookie(rawCookie);
  cookieObj.os = "pc";
  const ctx = extractContext(cookieObj);
  if (!ctx.auth.token) {
    return { status: 401, body: { code: 401, msg: "缺少 MUSIC_U 鉴权令牌" }, cookie: [] };
  }

  const resource: PlaybackLogResource = {
    id: resourceId,
    type: resourceType,
    categoryId: Number.isFinite(Number(query.categoryId)) ? Number(query.categoryId) : undefined,
    name: typeof query.name === "string" ? query.name : "",
    artist: typeof query.artist === "string" ? query.artist : "",
    bitrate: Number(query.bitrate) || 320,
    level: typeof query.level === "string" ? query.level : "exhigh",
    fee,
    time: totalTime,
  };
  const source = {
    id: sourceId || String(resourceId),
    type: ncblSourceType,
    name: ncblSourceType,
  };
  const metaJson = buildMetaJson(ctx);
  const cookieStr = buildCookieStr(ctx);
  const ts = Math.floor(Date.now() / 1000);
  const played = Math.min(playTime, totalTime);
  const plvBody = buildRecords([
    { time: ts, action: "_plv", data: buildPlv(ctx, resource, source) },
  ]);
  const pldBody = buildRecords([
    { time: ts, action: "_pld", data: buildPld(ctx, resource, source, played) },
  ]);

  try {
    const plv = await doUpload(ctx, metaJson, plvBody, cookieStr);
    if (!plv.success) {
      const rate = plv.respBody?.data?.rate;
      return {
        status: 502,
        body: {
          code: 502,
          msg: `PLV 上报失败${rate != null ? ` (rate=${rate})` : ""}`,
          details: plv.respBody,
        },
        cookie: [],
      };
    }

    const pld = await doUpload(ctx, metaJson, pldBody, cookieStr);
    if (!pld.success) {
      return {
        status: 502,
        body: {
          code: 502,
          msg: "PLV 成功但 PLD 失败",
          details: { plv: plv.respBody, pld: pld.respBody },
        },
        cookie: [],
      };
    }

    return {
      status: 200,
      body: {
        code: 200,
        data: "scrobble_v1 上报成功",
        details: {
          plv: { fileName: plv.fileName, payloadSize: plv.payload.length },
          pld: { fileName: pld.fileName, payloadSize: pld.payload.length },
        },
      },
      cookie: [],
    };
  } catch (err) {
    return {
      status: 502,
      body: { code: 502, msg: `请求异常: ${err instanceof Error ? err.message : String(err)}` },
      cookie: [],
    };
  }
};

export default scrobbleV1;
