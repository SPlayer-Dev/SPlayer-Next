import { z } from "zod/v4";
import type { Track } from "@shared/types/player";
import type { PluginSearchArgs, PluginSearchResult } from "@shared/types/plugin";
import { PluginErrorCodes } from "@shared/defaults/plugin-api";
import { pluginRegistry } from "./registry";
import { callMusicSearch } from "./router";

const searchSchema = z.strictObject({
  pluginId: z.string().min(1).max(256),
  source: z.string().min(1).max(128),
  keyword: z.string().trim().min(1).max(200),
  page: z.number().int().min(1).max(1000).default(1),
  limit: z.number().int().min(1).max(50).default(20),
});

const candidateSchema = z.looseObject({
  id: z.string().min(1).max(512),
  name: z.string().trim().min(1).max(512),
  singer: z.string().max(1024).optional(),
  album: z.string().max(1024).optional(),
  durationMs: z.number().finite().nonnegative().optional(),
  cover: z.string().max(2048).optional(),
});

/**
 * 搜索独立插件来源并转换为可持久化的曲目
 * @param args - 插件、来源、关键词与分页参数
 * @returns 曲目列表及分页信息
 */
export const searchPluginTracks = async (args: PluginSearchArgs): Promise<PluginSearchResult> => {
  const { pluginId, source, keyword, page, limit } = searchSchema.parse(args);
  const rt = pluginRegistry.getRuntime(pluginId);
  if (!rt?.enabled || rt.status.state !== "ready" || rt.hostSession?.signal.aborted) {
    throw Object.assign(new Error("Plugin source is not ready"), {
      code: PluginErrorCodes.NOT_READY,
    });
  }
  const capability = rt.status.sources[source];
  if (!capability?.actions.includes("musicSearch")) {
    throw Object.assign(new Error("Plugin source does not support searchable tracks"), {
      code: PluginErrorCodes.ACTION_UNSUPPORTED,
    });
  }
  const hostSession = rt.hostSession;
  const result = await callMusicSearch(rt, { source, keyword, page, limit });
  if (
    pluginRegistry.getRuntime(pluginId) !== rt ||
    rt.hostSession !== hostSession ||
    hostSession?.signal.aborted ||
    !rt.enabled ||
    rt.status.state !== "ready" ||
    !rt.status.sources[source]?.actions.includes("musicSearch")
  ) {
    throw Object.assign(new Error("Plugin search was cancelled"), {
      code: PluginErrorCodes.CANCELLED,
    });
  }
  if (!Array.isArray(result?.list)) throw new Error("Invalid plugin search result");

  const items: Track[] = [];
  const seen = new Set<string>();
  for (const candidate of result.list.slice(0, limit)) {
    try {
      // 队列会保留取数参数，限制单曲大小，避免把完整接口响应一并持久化。
      const serialized = JSON.stringify(candidate);
      if (!serialized || Buffer.byteLength(serialized, "utf8") > 8192) continue;
      const parsed = candidateSchema.safeParse(JSON.parse(serialized));
      if (!parsed.success || seen.has(parsed.data.id)) continue;
      const musicInfo = parsed.data;
      seen.add(musicInfo.id);
      items.push({
        id: `plugin:${[pluginId, source, musicInfo.id].map(encodeURIComponent).join(":")}`,
        source: "plugin",
        plugin: { pluginId, source, musicInfo },
        title: musicInfo.name,
        artists: musicInfo.singer ? [{ name: musicInfo.singer }] : [],
        album: musicInfo.album ? { name: musicInfo.album } : undefined,
        duration: musicInfo.durationMs ?? 0,
        cover: musicInfo.cover,
      });
    } catch {
      // 不可序列化的候选无法在重启后恢复，忽略该条结果。
    }
  }
  const offset = (page - 1) * limit;
  const reportedTotal =
    Number.isSafeInteger(result.total) && result.total! >= 0 ? result.total! : undefined;
  const total = reportedTotal ?? offset + items.length;
  const hasMore =
    typeof result.hasMore === "boolean"
      ? result.hasMore
      : reportedTotal !== undefined
        ? page * limit < total
        : result.list.length >= limit;
  return { items, total, hasMore };
};
