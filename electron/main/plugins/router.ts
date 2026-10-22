/**
 * 插件动作路由
 *
 * 把渲染端 / 主进程内部的 action 请求转发给共享 host 里的对应插件，并处理超时、取消。
 * 新增动作时，在 `shared/types/plugin.ts` 的 `PluginAction` / `ActionIO` 里登记，
 * 然后在这里补一个公共入口函数即可（callOn 是泛型）。
 */

import type {
  MenuClickReq,
  MenuClickRes,
  MusicLyricReq,
  MusicLyricRes,
  MusicCommentReq,
  MusicCommentRes,
  MusicPicReq,
  MusicPicRes,
  MusicSearchReq,
  MusicSearchRes,
  MusicUrlReq,
  MusicUrlRes,
  PluginAction,
  PluginInvokeMenuArgs,
  PluginResolveUrlArgs,
} from "@shared/types/plugin";
import { ACTION_TIMEOUTS, PluginErrorCodes } from "@shared/defaults/plugin-api";
import { pluginRegistry, type PluginRuntime } from "./registry";
import { pluginHost } from "./host-process";
import { pluginLog } from "@main/utils/logger";

let reqSeq = 0;
const nextRequestId = (): string => `r${Date.now().toString(36)}-${++reqSeq}`;

/** 在某个插件上调用一个动作，返回结果 */
const callOn = <T>(
  rt: PluginRuntime,
  action: PluginAction,
  params: unknown,
  timeoutMs: number,
): Promise<T> => {
  const id = rt.manifest.id;
  if (!pluginHost.isReady(id)) {
    return Promise.reject(
      Object.assign(new Error(`plugin ${id} not ready`), {
        code: PluginErrorCodes.NOT_READY,
      }),
    );
  }
  const requestId = nextRequestId();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      rt.pending.delete(requestId);
      pluginHost.sendCancel(id, requestId);
      reject(
        Object.assign(new Error(`plugin ${id} request timeout`), {
          code: PluginErrorCodes.REQUEST_TIMEOUT,
        }),
      );
    }, timeoutMs);
    rt.pending.set(requestId, {
      resolve: (v) => resolve(v as T),
      reject,
      timer,
    });
    pluginHost.sendCall(id, requestId, action, params);
  });
};

export const resolveUrl = async (args: PluginResolveUrlArgs): Promise<MusicUrlRes> => {
  const rt = pluginRegistry.getRuntime(args.pluginId);
  if (!rt) {
    throw Object.assign(new Error(`plugin ${args.pluginId} not found`), {
      code: PluginErrorCodes.NOT_FOUND,
    });
  }
  if (rt.status.state !== "ready") {
    throw Object.assign(new Error(`plugin ${args.pluginId} not ready`), {
      code: PluginErrorCodes.NOT_READY,
    });
  }
  // 不卡 inited 声明，调到 sandbox 让脚本自己判 source；handler 没注册时 sandbox 端回 ACTION_UNREGISTERED
  const params: MusicUrlReq = {
    source: args.source ?? "",
    quality: args.quality ?? "hq",
    musicInfo: args.musicInfo,
  };
  try {
    return await callOn<MusicUrlRes>(rt, "musicUrl", params, ACTION_TIMEOUTS.musicUrl);
  } catch (err) {
    pluginLog.warn("resolveUrl rejected", args.pluginId, (err as Error)?.message);
    throw err;
  }
};

/**
 * 校验实时授权并执行插件歌曲菜单
 * @param args - 插件、菜单标识与当前曲目
 * @returns 插件菜单执行结果
 */
export const invokeMenu = async (args: PluginInvokeMenuArgs): Promise<MenuClickRes> => {
  if (!pluginRegistry.getGrantedPermissions(args.pluginId).includes("ui")) {
    throw Object.assign(new Error("Plugin UI permission denied"), {
      code: PluginErrorCodes.PERMISSION_DENIED,
    });
  }
  const rt = pluginRegistry.getRuntime(args.pluginId);
  if (!rt) {
    throw Object.assign(new Error(`plugin ${args.pluginId} not found`), {
      code: PluginErrorCodes.NOT_FOUND,
    });
  }
  if (rt.status.state !== "ready") {
    throw Object.assign(new Error(`plugin ${args.pluginId} not ready`), {
      code: PluginErrorCodes.NOT_READY,
    });
  }
  const params: MenuClickReq = { menuId: args.menuId, track: args.track };
  const result = await callOn<MenuClickRes>(rt, "menuClick", params, ACTION_TIMEOUTS.menuClick);
  if (!pluginRegistry.getGrantedPermissions(args.pluginId).includes("ui")) {
    throw Object.assign(new Error("Plugin UI permission denied"), {
      code: PluginErrorCodes.PERMISSION_DENIED,
    });
  }
  return result;
};

/** 在某插件上搜某源候选（host 元数据匹配用） */
export const callMusicSearch = (rt: PluginRuntime, req: MusicSearchReq): Promise<MusicSearchRes> =>
  callOn<MusicSearchRes>(rt, "musicSearch", req, ACTION_TIMEOUTS.musicSearch);

/** 在某插件上取某条已匹配候选的歌词 */
export const callMusicLyric = (rt: PluginRuntime, req: MusicLyricReq): Promise<MusicLyricRes> =>
  callOn<MusicLyricRes>(rt, "musicLyric", req, ACTION_TIMEOUTS.musicLyric);

/** 在某插件上取某条已匹配候选的封面 */
export const callMusicPic = (rt: PluginRuntime, req: MusicPicReq): Promise<MusicPicRes> =>
  callOn<MusicPicRes>(rt, "musicPic", req, ACTION_TIMEOUTS.musicPic);

/** 在某插件上取某条已匹配候选的评论 */
export const callMusicComment = (
  rt: PluginRuntime,
  req: MusicCommentReq,
): Promise<MusicCommentRes> =>
  callOn<MusicCommentRes>(rt, "musicComment", req, ACTION_TIMEOUTS.musicComment);
