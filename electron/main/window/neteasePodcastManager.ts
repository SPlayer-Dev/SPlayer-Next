import { shell } from "electron";
import { callNetease } from "@main/apis/netease";

const NETEASE_SSO_URL = "https://music.163.com/sso/login";
const PODCAST_MANAGER_PATH = "/radio/my/#/plist";

/**
 * 使用应用登录态在系统浏览器打开网易云播客管理页
 * @param userId - 当前网易云用户 ID
 */
export const openNeteasePodcastManager = async (userId: number): Promise<void> => {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("invalid netease user id");

  const { body } = await callNetease("sso_login_token");
  const token = typeof body.token === "string" ? body.token : "";
  if (!token) throw new Error("netease sso token missing");

  const url = new URL(NETEASE_SSO_URL);
  url.searchParams.set("token", token);
  url.searchParams.set("uid", String(userId));
  url.searchParams.set("url", PODCAST_MANAGER_PATH);
  url.searchParams.set("forceReplaceLogin", "true");
  await shell.openExternal(url.toString());
};
