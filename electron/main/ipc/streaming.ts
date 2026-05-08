import { ipcMain } from "electron";
import type { Track } from "@shared/types/player";
import type {
  StreamingServerConfig,
  StreamingServerInput,
} from "@shared/types/streaming";
import * as svc from "@main/services/streaming";
import {
  addConfig,
  getActiveId,
  getConfig,
  listConfigs,
  patchConfig,
  removeConfig,
  setActiveId,
  toSummary,
  updateConfig,
} from "@main/store/streaming";
import { streamingLog as log } from "@main/utils/logger";

/** 把任意 error 转成 IPC 字符串 */
const errStr = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** 输入校验 */
const validateInput = (input: StreamingServerInput): string | null => {
  if (!input.name?.trim()) return "服务器名称不能为空";
  if (!input.url?.trim()) return "URL 不能为空";
  if (!/^https?:\/\//i.test(input.url.trim())) return "URL 必须以 http:// 或 https:// 开头";
  if (!input.username) return "用户名不能为空";
  if (!input.password) return "密码不能为空";
  return null;
};

/**
 * 确保 Jellyfin/Emby 配置持有有效 accessToken；缺失时执行登录并写回。
 * Subsonic 系无需此步。
 */
const ensureAuthenticated = async (
  cfg: StreamingServerConfig,
): Promise<StreamingServerConfig> => {
  if (!svc.needsAccessToken(cfg.type)) return cfg;
  if (cfg.accessToken && cfg.userId) return cfg;
  const { accessToken, userId } = await svc.authenticate(cfg);
  patchConfig(cfg.id, { accessToken, userId, lastConnected: Date.now() });
  return { ...cfg, accessToken, userId, lastConnected: Date.now() };
};

export const registerStreamingIpc = (): void => {
  // 列出全部
  ipcMain.handle("streaming:listServers", () => {
    try {
      return { success: true, data: listConfigs().map(toSummary) };
    } catch (err) {
      return { success: false, error: errStr(err) };
    }
  });

  // 当前激活服务器
  ipcMain.handle("streaming:getActiveServer", () => {
    try {
      const id = getActiveId();
      if (!id) return { success: true, data: null };
      const cfg = getConfig(id);
      return { success: true, data: cfg ? toSummary(cfg) : null };
    } catch (err) {
      return { success: false, error: errStr(err) };
    }
  });

  ipcMain.handle("streaming:setActiveServer", (_e, id: string | null) => {
    try {
      setActiveId(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: errStr(err) };
    }
  });

  // 添加
  ipcMain.handle("streaming:addServer", (_e, input: StreamingServerInput) => {
    const invalid = validateInput(input);
    if (invalid) return { success: false, error: invalid };
    try {
      const cfg = addConfig(input);
      return { success: true, data: toSummary(cfg) };
    } catch (err) {
      return { success: false, error: errStr(err) };
    }
  });

  // 更新（局部）
  ipcMain.handle(
    "streaming:updateServer",
    (_e, id: string, patch: Partial<StreamingServerInput>) => {
      try {
        const cfg = updateConfig(id, patch);
        if (!cfg) return { success: false, error: "服务器配置不存在" };
        return { success: true, data: toSummary(cfg) };
      } catch (err) {
        return { success: false, error: errStr(err) };
      }
    },
  );

  // 移除
  ipcMain.handle("streaming:removeServer", (_e, id: string) => {
    try {
      const ok = removeConfig(id);
      return ok ? { success: true } : { success: false, error: "服务器配置不存在" };
    } catch (err) {
      return { success: false, error: errStr(err) };
    }
  });

  // 预飞行连通性测试（不写盘）
  ipcMain.handle("streaming:testConnection", async (_e, input: StreamingServerInput) => {
    const invalid = validateInput(input);
    if (invalid) return { success: false, error: invalid };
    try {
      // 临时 cfg，借用 addConfig 的密码加密但不落盘
      const tempCfg: StreamingServerConfig = {
        id: "__test__",
        name: input.name,
        type: input.type,
        url: input.url.replace(/\/+$/, ""),
        username: input.username,
        // 临时使用 raw 前缀让 decrypt 能还原
        passwordEncrypted: `raw:${Buffer.from(input.password, "utf8").toString("base64")}`,
      };
      // Jellyfin/Emby 需要登录后才知道账号有效
      if (svc.needsAccessToken(input.type)) {
        try {
          await svc.authenticate(tempCfg);
        } catch (err) {
          return { success: true, data: { ok: false, error: errStr(err) } };
        }
      }
      const result = await svc.ping(tempCfg);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: errStr(err) };
    }
  });

  // 解析播放 URL
  ipcMain.handle("streaming:resolveUrl", async (_e, track: Track) => {
    try {
      if (track.source !== "streaming") {
        return { success: false, error: "track.source 不是 streaming" };
      }
      if (!track.serverId || !track.originalId) {
        return { success: false, error: "track 缺少 serverId 或 originalId" };
      }
      const cfg = getConfig(track.serverId);
      if (!cfg) return { success: false, error: "服务器配置不存在" };
      const ready = await ensureAuthenticated(cfg);
      const url = svc.getStreamUrl(ready, track.originalId);
      return { success: true, data: url };
    } catch (err) {
      log.warn("resolveUrl 失败:", err);
      return { success: false, error: errStr(err) };
    }
  });

  // 获取歌词
  ipcMain.handle("streaming:getLyrics", async (_e, track: Track) => {
    try {
      if (track.source !== "streaming" || !track.serverId || !track.originalId) {
        return { success: true, data: null };
      }
      const cfg = getConfig(track.serverId);
      if (!cfg) return { success: true, data: null };
      const ready = await ensureAuthenticated(cfg);
      const text = await svc.getLyrics(ready, track.originalId, {
        artist: track.artists?.[0]?.name,
        title: track.title,
      });
      return { success: true, data: text };
    } catch (err) {
      log.debug("getLyrics 失败（视为无歌词）:", err);
      return { success: true, data: null };
    }
  });
};
