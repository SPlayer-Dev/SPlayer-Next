/**
 * Netease API 通用常量
 * 来源：@neteasecloudmusicapienhanced/api util/crypto.js + util/request.js + util/config.json
 */

/** AES-CBC 初始向量 */
export const IV = "0102030405060708";
/** weapi 第一层 AES 预设密钥 */
export const PRESET_KEY = "0CoJUm6Qyw8W8jud";
/** linuxapi AES 密钥 */
export const LINUX_API_KEY = "rFgB&h#%2?^eDg:Q";
/** eapi AES 密钥 */
export const EAPI_KEY = "e82ckenh8dichen8";
/** weapi 随机 secretKey 字符集 */
export const BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
/** weapi RSA 公钥（1024bit） */
export const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`;

/** web 域名（weapi） */
export const DOMAIN = "https://music.163.com";
/** 客户端接口域名（api/eapi） */
export const API_DOMAIN = "https://interface.music.163.com";
/** 是否默认对响应体做 eapi 加密（e_r） */
export const ENCRYPT_RESPONSE = false;

/** 这些业务码视作 HTTP 200 成功（接口层的登录/重定向/限流语义） */
export const SPECIAL_STATUS_CODES: ReadonlySet<number> = new Set([201, 302, 400, 502, 800, 801, 802, 803]);

/** 客户端伪装：不同 os 标识对应的 appver / osver / channel */
export const OS_MAP = {
  pc: {
    os: "pc",
    appver: "3.1.17.204416",
    osver: "Microsoft-Windows-10-Professional-build-19045-64bit",
    channel: "netease",
  },
  linux: {
    os: "linux",
    appver: "1.2.1.0428",
    osver: "Deepin 20.9",
    channel: "netease",
  },
  android: {
    os: "android",
    appver: "8.20.20.231215173437",
    osver: "14",
    channel: "xiaomi",
  },
  iphone: {
    os: "iPhone OS",
    appver: "9.0.90",
    osver: "16.2",
    channel: "distribution",
  },
} as const;

/** 不同加密方式 + 设备类型下的 User-Agent */
export const UA_MAP = {
  weapi: {
    pc: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  },
  linuxapi: {
    linux:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36",
  },
  api: {
    pc: "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/3.0.18.203152",
    android:
      "NeteaseMusic/9.1.65.240927161425(9001065);Dalvik/2.1.0 (Linux; U; Android 14; 23013RK75C Build/UKQ1.230804.001)",
    iphone: "NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)",
  },
} as const;

/** 支持的加密方式 */
export type CryptoMode = "weapi" | "linuxapi" | "eapi" | "api";
