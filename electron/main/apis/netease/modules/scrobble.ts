/**
 * 听歌打卡
 *
 * 更新网易云听歌排行数据，需要登录态。
 */

import { createOption } from "../core/option";
import { CLIENT_LOG_DOMAIN } from "../core/config";
import type { NeteaseModule } from "../core/types";

const scrobble: NeteaseModule = async (query, request) => {
  let cookie: string | Record<string, string> = query.cookie || "";
  if (typeof cookie === "object") {
    cookie = Object.assign({ os: "osx" }, cookie);
  } else if (typeof cookie === "string") {
    cookie = cookie.includes("os=") ? cookie.replace(/os=[^;]+/g, "os=osx") : `${cookie}; os=osx`;
  } else {
    cookie = "os=osx";
  }
  query.cookie = cookie;
  const resourceId = String(query.id || "");
  if (!/^\d+$/.test(resourceId) || resourceId === "0") {
    return { status: 400, body: { code: 400, msg: "缺少有效的资源 ID" }, cookie: [] };
  }
  const playTime = Number(query.time);
  if (Number.isNaN(playTime) || playTime <= 0) {
    return { status: 400, body: { code: 400, msg: "缺少有效的播放时长" }, cookie: [] };
  }

  const resourceType = query.resourceType === "dj" ? "dj" : "song";
  const sourceType = typeof query.sourceType === "string" ? query.sourceType : "song";
  const sourceName =
    resourceType === "dj"
      ? "djradio"
      : sourceType === "song"
        ? "track"
        : sourceType === "radio"
          ? "djradio"
          : sourceType;
  const sourceId = String(query.sourceid || query.sourceId || resourceId);
  const categoryId = Number(query.categoryId);
  const sourceFields = {
    sourceId,
    source: sourceName,
    sourcetype: sourceName,
    ...(resourceType === "dj" && Number.isFinite(categoryId) ? { categoryId } : {}),
  };

  const startplayData = {
    logs: JSON.stringify([
      {
        action: "startplay",
        json: {
          id: resourceId,
          type: resourceType,
          mainsite: "1",
          mainsiteWeb: "1",
          content: `id=${sourceId}`,
          ...sourceFields,
        },
      },
    ]),
  };

  const playData = {
    logs: JSON.stringify([
      {
        action: "play",
        json: {
          download: 0,
          end: "playend",
          id: resourceId,
          time: playTime,
          type: resourceType,
          wifi: 0,
          mainsite: "1",
          mainsiteWeb: "1",
          content: `id=${sourceId}`,
          ...sourceFields,
        },
      },
    ]),
  };

  const option = createOption(query, "eapi");
  option.domain = CLIENT_LOG_DOMAIN;

  const startplay = await request("/api/feedback/weblog", startplayData, option);
  const play = await request("/api/feedback/weblog", playData, option);
  const succeeded = [startplay, play].every(
    ({ body }) => body?.code === 200 || body?.data === "success",
  );

  return {
    status: succeeded ? 200 : 502,
    body: {
      code: succeeded ? 200 : 502,
      ...(succeeded ? { data: "success" } : { msg: "原版日志上报失败" }),
      details: {
        startplay: startplay.body,
        play: play.body,
      },
    },
    cookie: [],
  };
};

export default scrobble;
