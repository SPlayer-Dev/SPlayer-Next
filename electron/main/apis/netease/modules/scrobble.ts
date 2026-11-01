import { createWebOption } from "../core/option";
import { WEB_LOG_DOMAIN } from "../core/config";
import type { NeteaseModule } from "../core/types";

/**
 * 按官方网页的动作与字段发送单条日志，开始和结束由播放流程分别调用
 * @param query - 资源标识、日志动作和实际收听秒数
 * @param request - 公共请求层
 * @returns 服务端原始日志响应
 */
const scrobble: NeteaseModule = async (query, request) => {
  const id = String(query.id || "");
  if (!/^\d+$/.test(id) || id === "0")
    return { status: 400, body: { code: 400, msg: "缺少有效的资源 ID" }, cookie: [] };
  const action = query.action ?? "play";
  if (action !== "startPlay" && action !== "play")
    return { status: 400, body: { code: 400, msg: "播放日志动作无效" }, cookie: [] };
  const time = Number(query.time);
  if (action === "play" && (!Number.isFinite(time) || time <= 0))
    return { status: 400, body: { code: 400, msg: "缺少有效的播放时长" }, cookie: [] };
  const json = {
    mainSite: "2",
    mainSiteWeb: "2",
    id,
    type: query.resourceType === "dj" ? "dj" : "song",
    content: "",
    ...(action === "play" ? { time, wifi: 0, download: 0 } : {}),
  };
  return request(
    "/api/feedback/weblog",
    { logs: JSON.stringify([{ action, json }]) },
    { ...createWebOption(query), domain: WEB_LOG_DOMAIN },
  );
};
export default scrobble;
