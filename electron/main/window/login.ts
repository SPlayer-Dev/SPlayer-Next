/**
 * 平台网页登录窗口管理
 *
 * 打开独立的 BrowserWindow 加载平台官方登录页，使用专属 session 分区隔离 cookie；
 * 用户登录成功后从该分区读取关键 cookie 并返回
 *
 * 同一时刻只允许一个登录窗口存在。
 */

import { BrowserWindow, session, type Session } from "electron";
import { getMainWindow } from "./main";
import { coreLog } from "@main/utils/logger";

/**
 * 伪装成普通桌面 Chrome
 * 默认 UA 含 "Electron/..."，部分平台会判定为不受支持环境，渲染极慢且无法跳转
 */
const FAKE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** 平台登录窗口配置 */
interface LoginPlatformConfig {
  title: string;
  url: string;
  partition: string;
  logTag: string;
  collectCookies: (ses: Session) => Promise<Record<string, string> | null>;
}

let activeWin: BrowserWindow | null = null;
let pollTimer: NodeJS.Timeout | null = null;

const stopPolling = (): void => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
};

/**
 * 通用平台登录窗口创建与轮询管理
 * @param config - 平台配置
 * @returns 登录成功返回 cookies 对象；用户关闭窗口返回 null
 */
const openLoginWindow = async (
  config: LoginPlatformConfig,
): Promise<Record<string, string> | null> => {
  // 已存在则先聚焦
  if (activeWin && !activeWin.isDestroyed()) {
    activeWin.focus();
    return null;
  }

  // 清除旧的登录会话数据，避免残留 cookie 干扰
  const ses = session.fromPartition(config.partition);
  await ses.clearStorageData({ storages: ["cookies", "localstorage", "indexdb"] });
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
    title: config.title,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    show: false,
    webPreferences: {
      session: ses,
      // sandbox 模式下部分音乐网站 JS 渲染极慢；登录窗口无自有业务代码，关闭沙箱影响可控
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  activeWin.webContents.setUserAgent(FAKE_UA);
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

    // ready-to-show 比 did-finish-load 更早，避免被大量异步资源拖住显示
    activeWin!.once("ready-to-show", () => activeWin?.show());

    activeWin!.webContents.once("dom-ready", () => {
      pollTimer = setInterval(async () => {
        try {
          const cookies = await config.collectCookies(ses);
          if (cookies) finish(cookies);
        } catch (err) {
          coreLog.warn(`${config.logTag} poll cookies failed:`, err);
        }
      }, 1000);
    });

    activeWin!.on("closed", () => finish(null));

    activeWin!.loadURL(config.url, { userAgent: FAKE_UA }).catch((err) => {
      coreLog.error(`${config.logTag} loadURL failed:`, err);
      finish(null);
    });
  });
};

/** NCM 关心的关键 cookie；未取到 MUSIC_U 视为未登录 */
const NETEASE_COOKIE_KEYS = ["MUSIC_U", "__csrf", "NMTID", "MUSIC_A"];

/** 网易云音乐登录配置 */
const NETEASE_CONFIG: LoginPlatformConfig = {
  title: "登录网易云音乐",
  url: "https://music.163.com/#/login",
  partition: "persist:netease-login",
  logTag: "[login]",
  collectCookies: async (ses) => {
    // 按 URL 取，能拿到 domain 和 .domain 两种维度，否则部分 cookie 漏取
    const all = await ses.cookies.get({ url: "https://music.163.com" });
    const musicU = all.find((c) => c.name === "MUSIC_U");
    if (!musicU?.value) return null;
    const out: Record<string, string> = {};
    for (const key of NETEASE_COOKIE_KEYS) {
      const hit = all.find((c) => c.name === key);
      if (hit?.value) out[key] = hit.value;
    }
    return out;
  },
};

/**
 * 打开 NCM 网页登录窗口
 * @returns 登录成功返回 cookies 对象；用户关闭窗口返回 null
 */
export const openNeteaseLoginWindow = async (): Promise<Record<string, string> | null> => {
  return await openLoginWindow(NETEASE_CONFIG);
};
