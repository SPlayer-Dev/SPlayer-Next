/**
 * Host API 主进程侧实现
 *
 * 当 sandbox 收到 worker 的 hostCall 消息，调用本模块的 dispatch()，
 * dispatch 根据 method 去做真实工作（网络/存储），再通过 sandbox.sendHostResult 回传。
 */

import type { HostCallMethod, HostRequestOptions, PluginGrant } from "@shared/types/plugin";
import { PluginErrorCodes } from "@shared/defaults/plugin-api";
import { coreLog } from "@main/utils/logger";
import { pluginHost } from "./host-process";
import { hostRequest } from "./net";
import {
  pluginStorageGet,
  pluginStorageKeys,
  pluginStorageRemove,
  pluginStorageSet,
} from "./storage";
import { playerControl } from "@main/services/playerControl";

/** 处理一次 plugin→host 调用 */
export const dispatchHostCall = async (
  pluginId: string,
  grant: PluginGrant[],
  callId: string,
  method: HostCallMethod,
  args: unknown[],
): Promise<void> => {
  try {
    // 权限门控
    if (method === "request" && !grant.includes("network")) {
      throw Object.assign(new Error(`plugin "${pluginId}" lacks "network" grant`), {
        code: PluginErrorCodes.PERMISSION_DENIED,
      });
    }
    if (method.startsWith("player.") && !grant.includes("control")) {
      coreLog.warn(`[plugin:${pluginId}] 缺少 "control" 权限，拒绝调用 ${method}`);
      throw Object.assign(new Error(`plugin "${pluginId}" lacks "control" grant`), {
        code: PluginErrorCodes.PERMISSION_DENIED,
      });
    }
    let data: unknown;
    switch (method) {
      case "request":
        data = await hostRequest(args[0] as string, (args[1] ?? {}) as HostRequestOptions);
        break;
      case "storage.get":
        data = pluginStorageGet(pluginId, args[0] as string);
        break;
      case "storage.set":
        pluginStorageSet(pluginId, args[0] as string, args[1]);
        data = undefined;
        break;
      case "storage.remove":
        pluginStorageRemove(pluginId, args[0] as string);
        data = undefined;
        break;
      case "storage.keys":
        data = pluginStorageKeys(pluginId);
        break;
      case "player.play":
        playerControl.play();
        data = undefined;
        break;
      case "player.pause":
        playerControl.pause();
        data = undefined;
        break;
      case "player.next":
        playerControl.next();
        data = undefined;
        break;
      case "player.prev":
        playerControl.prev();
        data = undefined;
        break;
      case "player.seek": {
        const positionMs = Number(args[0]);
        // 插件侧即发即忘：吞掉引擎 rejection，不阻塞 hostCall 返回
        if (Number.isFinite(positionMs) && positionMs >= 0) {
          void playerControl.seek(positionMs).catch(() => {});
        }
        data = undefined;
        break;
      }
      case "player.setVolume": {
        const volume = Number(args[0]);
        if (Number.isFinite(volume) && volume >= 0 && volume <= 1) playerControl.setVolume(volume);
        data = undefined;
        break;
      }
      case "player.getPosition":
        data = playerControl.getPosition();
        break;
      default:
        throw Object.assign(new Error(`unknown host method: ${method}`), {
          code: PluginErrorCodes.UNKNOWN,
        });
    }
    pluginHost.sendHostResult(pluginId, callId, true, data);
  } catch (err) {
    pluginHost.sendHostResult(pluginId, callId, false, undefined, {
      code: ((err as any)?.code as string) ?? PluginErrorCodes.UNKNOWN,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
