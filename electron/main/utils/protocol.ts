import path from "node:path";
import { net, protocol, session } from "electron";
import { getAppCacheDir } from "./config";

/** cache:// 协议方案名 */
const SCHEME = "cache";

/**
 * 注册 cache:// 协议方案
 * 必须在 app.whenReady 之前调用
 */
export const registerCacheScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        secure: true,
        supportFetchAPI: true,
        bypassCSP: true,
        stream: true,
      },
    },
  ]);
};

/** cache:// 协议的处理函数 */
const cacheHandler = (request: Request): Response | Promise<Response> => {
  const relativePath = decodeURIComponent(request.url.slice(`${SCHEME}://`.length));
  const filePath = path.join(getAppCacheDir(), relativePath);
  return net.fetch(`file://${filePath.replace(/\\/g, "/")}`);
};

/**
 * 注册 cache:// 协议处理
 * 在 app.whenReady 之后调用
 * 格式：cache://covers/xxx.jpg、cache://artists/xxx.jpg
 */
export const handleCacheProtocol = (): void => {
  protocol.handle(SCHEME, cacheHandler);
};

/**
 * 在指定 partition 的 session 上注册 cache:// 协议处理
 */
export const handleCacheProtocolOnPartition = (partition: string): void => {
  session.fromPartition(partition).protocol.handle(SCHEME, cacheHandler);
};

/**
 * 将 app-cache 下的磁盘路径转为 cache:// 协议 URL
 * @param filePath 磁盘路径（如 C:/.../app-cache/covers/xxx.jpg）
 * @returns cache://covers/xxx.jpg 或 undefined
 */
export const toCacheUrl = (filePath: string | undefined | null): string | undefined => {
  if (!filePath) return undefined;
  const relative = path.relative(getAppCacheDir(), filePath).replace(/\\/g, "/");
  return `${SCHEME}://${relative}`;
};
