/**
 * 插件动作路由
 *
 * 把渲染端 / 主进程内部的 action 请求转发给对应插件的 sandbox，
 * 并处理超时、取消。目前支持 musicUrl / lyric / pic 三个动作。
 */

import type {
  MusicUrlReq,
  MusicUrlRes,
  PluginAction,
  PluginResolveUrlArgs,
  SourceCapability,
} from "@shared/types/plugin";
import { ACTION_TIMEOUTS, PluginErrorCodes } from "@shared/defaults/plugin-api";
import { pluginRegistry, type PluginRuntime } from "./registry";

let reqSeq = 0;
const nextRequestId = (): string => `r${Date.now().toString(36)}-${++reqSeq}`;

/** 在某个插件上调用一个动作，返回结果 */
const callOn = <T>(
  rt: PluginRuntime,
  action: PluginAction,
  params: unknown,
  timeoutMs: number,
): Promise<T> => {
  if (!rt.sandbox?.isAlive()) {
    return Promise.reject(
      Object.assign(new Error(`plugin ${rt.manifest.id} not ready`), {
        code: PluginErrorCodes.NOT_READY,
      }),
    );
  }
  const requestId = nextRequestId();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      rt.pending.delete(requestId);
      rt.sandbox?.sendCancel(requestId);
      reject(
        Object.assign(new Error(`plugin ${rt.manifest.id} request timeout`), {
          code: PluginErrorCodes.REQUEST_TIMEOUT,
        }),
      );
    }, timeoutMs);
    rt.pending.set(requestId, {
      resolve: (v) => resolve(v as T),
      reject,
      timer,
    });
    rt.sandbox!.sendCall(requestId, action, params);
  });
};

/** 判断某插件的指定源是否支持该动作 */
const supportsAction = (
  rt: PluginRuntime,
  source: string | undefined,
  action: PluginAction,
): { ok: boolean; source?: string } => {
  if (rt.status.state !== "ready") return { ok: false };
  const sources = rt.status.sources;
  if (source) {
    const cap: SourceCapability | undefined = sources[source];
    if (!cap) return { ok: false };
    return { ok: cap.actions.includes(action), source };
  }
  // 未指定 source：拿第一个支持此动作的
  for (const [key, cap] of Object.entries(sources)) {
    if (cap.actions.includes(action)) return { ok: true, source: key };
  }
  return { ok: false };
};

export const resolveUrl = async (args: PluginResolveUrlArgs): Promise<MusicUrlRes> => {
  const rt = pluginRegistry.getRuntime(args.pluginId);
  if (!rt) {
    throw Object.assign(new Error(`plugin ${args.pluginId} not found`), {
      code: PluginErrorCodes.NOT_FOUND,
    });
  }
  const check = supportsAction(rt, args.source, "musicUrl");
  if (!check.ok) {
    throw Object.assign(
      new Error(`plugin ${args.pluginId} does not support musicUrl on source ${args.source}`),
      { code: PluginErrorCodes.ACTION_UNSUPPORTED },
    );
  }
  const params: MusicUrlReq = {
    source: check.source!,
    quality: args.quality ?? "hq",
    musicInfo: args.musicInfo,
  };
  return callOn<MusicUrlRes>(rt, "musicUrl", params, ACTION_TIMEOUTS.musicUrl);
};
