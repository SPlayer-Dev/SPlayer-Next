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
        standard: true,
        corsEnabled: true,
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
  // 剥离查询串：?v=xxx 仅用于封面替换后的缓存失效，不参与路径解析
  const withoutQuery = request.url.split("?")[0];
  const relativePath = decodeURIComponent(withoutQuery.slice(`${SCHEME}://`.length));
  const root = getAppCacheDir();
  const resolved = path.resolve(root, relativePath);
  // 防 cache://../ 逃逸：解析后的绝对路径必须仍在缓存根目录内
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    return new Response(null, { status: 403 });
  }
  return net.fetch(`file://${resolved.replace(/\\/g, "/")}`);
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
  const relative = path.relative(getAppCacheDir(), filePath);
  // 路径不在缓存根目录下时拒绝生成 URL，避免产出可逃逸的 cache:// 链接
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return `${SCHEME}://${relative.replace(/\\/g, "/")}`;
};
