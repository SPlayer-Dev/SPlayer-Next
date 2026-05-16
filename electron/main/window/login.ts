/**
 * NCM 网页登录窗口
 *
 * 打开一个独立的 BrowserWindow 加载网易云官方登录页，使用专属 session 分区
 * 隔离 cookie；用户登录成功后从该分区读取 MUSIC_U 等关键 cookie 返回。
 *
 * 同一时刻只允许一个登录窗口存在。
 */

import { BrowserWindow, session } from "electron";
import { getMainWindow } from "./main";
import { coreLog } from "@main/utils/logger";

const LOGIN_PARTITION = "persist:netease-login";
const LOGIN_URL = "https://music.163.com/#/login";

/** 关心的关键 cookie；未取到 MUSIC_U 视为未登录 */
const COOKIE_KEYS = ["MUSIC_U", "__csrf", "NMTID", "MUSIC_A"];

/**
 * 伪装成普通桌面 Chrome
 * 默认 UA 含 "Electron/..."，NCM 会判定为不受支持环境，渲染极慢且无法跳转
 */
const FAKE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let activeWin: BrowserWindow | null = null;
let pollTimer: NodeJS.Timeout | null = null;

const getLoginSession = (): Electron.Session => session.fromPartition(LOGIN_PARTITION);

const stopPolling = (): void => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
};

/**
 * 收集登录会话中的 cookies
 * @returns 含 MUSIC_U 时返回完整 cookies 对象，否则 null
 */
const collectCookies = async (): Promise<Record<string, string> | null> => {
  const ses = getLoginSession();
  // 按 URL 取，能拿到 domain 和 .domain 两种维度，否则部分 cookie 漏取
  const all = await ses.cookies.get({ url: "https://music.163.com" });
  const musicU = all.find((c) => c.name === "MUSIC_U");
  if (!musicU?.value) return null;
  const out: Record<string, string> = {};
  for (const key of COOKIE_KEYS) {
    const hit = all.find((c) => c.name === key);
    if (hit?.value) out[key] = hit.value;
  }
  return out;
};

/**
 * 打开 NCM 网页登录窗口
 * @returns 登录成功返回 cookies 对象；用户关闭窗口返回 null
 */
export const openNeteaseLoginWindow = async (): Promise<Record<string, string> | null> => {
  // 已存在则先聚焦
  if (activeWin && !activeWin.isDestroyed()) {
    activeWin.focus();
    return null;
  }

  // 清掉旧的登录会话，避免残留 cookie 干扰
  const ses = getLoginSession();
  await ses.clearStorageData({ storages: ["cookies", "localstorage", "indexdb"] });
  // 整个分区都伪装 UA，否则部分 XHR 仍会被识别成 Electron
  ses.setUserAgent(FAKE_UA);

  const parent = getMainWindow() ?? undefined;

  activeWin = new BrowserWindow({
    parent,
    modal: false,
    width: 1024,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    center: true,
    title: "登录网易云音乐",
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    show: false,
    webPreferences: {
      session: ses,
      // sandbox 模式下 NCM 的 JS 渲染极慢；登录窗口里没有自家代码，关闭沙箱影响可控
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 顶层导航和 XHR 都使用伪装 UA
  activeWin.webContents.setUserAgent(FAKE_UA);

  // 阻止新窗口
  activeWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  return await new Promise<Record<string, string> | null>((resolve) => {
    let settled = false;
    const finish = (result: Record<string, string> | null): void => {
      if (settled) return;
      settled = true;
      stopPolling();
      if (activeWin && !activeWin.isDestroyed()) activeWin.destroy();
      activeWin = null;
      resolve(result);
    };

    // ready-to-show 比 did-finish-load 更早，避免被 NCM 大量异步资源拖住显示
    activeWin!.once("ready-to-show", () => activeWin?.show());

    activeWin!.webContents.once("dom-ready", () => {
      pollTimer = setInterval(async () => {
        try {
          const cookies = await collectCookies();
          if (cookies) finish(cookies);
        } catch (err) {
          coreLog.warn("[login] poll cookies failed:", err);
        }
      }, 1000);
    });

    activeWin!.on("closed", () => finish(null));

    activeWin!.loadURL(LOGIN_URL, { userAgent: FAKE_UA }).catch((err) => {
      coreLog.error("[login] loadURL failed:", err);
      finish(null);
    });
  });
};
