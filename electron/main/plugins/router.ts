/**
 * 插件动作路由
 *
 * 把渲染端 / 主进程内部的 action 请求转发给对应插件的 sandbox，
 * 并处理超时、取消、优先级 fallback。
 *
 * MVP 只实现 search / musicUrl；lyric / meta 接入点在二期启用。
 */

import type {
  MusicUrlReq,
  MusicUrlRes,
  PluginAction,
  PluginSearchArgs,
  PluginResolveUrlArgs,
  SearchRes,
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

export const searchAcrossPlugins = async (args: PluginSearchArgs): Promise<SearchRes> => {
  const { keyword, page = 1, limit = 30, pluginId, source } = args;
  const candidates: PluginRuntime[] = [];

  if (pluginId) {
    const rt = pluginRegistry.getRuntime(pluginId);
    if (rt) candidates.push(rt);
  } else {
    // 按优先级 + 所有 ready 插件 fallback
    const priority = (pluginRegistry as unknown as { listInfo: () => unknown }).listInfo
      ? pluginRegistry.listInfo().map((i) => i.manifest.id)
      : [];
    for (const id of priority) {
      const rt = pluginRegistry.getRuntime(id);
      if (rt && rt.enabled && rt.status.state === "ready") candidates.push(rt);
    }
  }

  const errors: Error[] = [];
  for (const rt of candidates) {
    const check = supportsAction(rt, source, "search");
    if (!check.ok) continue;
    try {
      const res = await callOn<SearchRes>(
        rt,
        "search",
        { source: check.source, keyword, page, limit },
        ACTION_TIMEOUTS.search,
      );
      return res;
    } catch (err) {
      errors.push(err as Error);
    }
  }
  throw Object.assign(
    new Error(
      errors.length
        ? `all candidate plugins failed: ${errors.map((e) => e.message).join("; ")}`
        : "no plugin supports search",
    ),
    { code: PluginErrorCodes.ACTION_UNSUPPORTED },
  );
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
    quality: args.quality ?? "320k",
    musicInfo: args.musicInfo,
  };
  return callOn<MusicUrlRes>(rt, "musicUrl", params, ACTION_TIMEOUTS.musicUrl);
};
