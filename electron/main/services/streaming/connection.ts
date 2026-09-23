import type {
  StreamingConnectResult,
  StreamingErrorCode,
  StreamingPingResult,
  StreamingServerInput,
} from "@shared/types/streaming";
import { streamingLog } from "@main/utils/logger";
import type { StreamingAdapter } from "./adapters/types";
import { invalidateStreamingSession, resolveStreamingAdapter } from "./adapters/resolve";
import {
  createTestStreamingServer,
  getStreamingServer,
  markStreamingServerConnected,
} from "./config";
import type { StreamingRuntimeConfig } from "@shared/types/streaming";

/**
 * 归类连接错误
 * @param error - 原始错误
 * @returns 错误类型
 */
const classifyError = (error: unknown): StreamingErrorCode => {
  const message = error instanceof Error ? error.message : String(error);
  if (/HTTP 401|HTTP 403|auth|token|password|credential/i.test(message)) return "auth";
  if (/fetch|network|timeout|ECONN|ENOTFOUND/i.test(message)) return "network";
  if (/HTTP|响应|protocol/i.test(message)) return "protocol";
  return "unknown";
};

/**
 * 使用指定服务器执行协议请求
 * @param serverId - 服务器 ID
 * @param request - 协议请求
 * @returns 请求结果
 */
export const withStreamingAdapter = async <T>(
  serverId: string,
  request: (config: StreamingRuntimeConfig, adapter: StreamingAdapter) => Promise<T>,
): Promise<T> => {
  const config = getStreamingServer(serverId);
  const resolved = await resolveStreamingAdapter(config);
  try {
    return await request(resolved.config, resolved.adapter);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      (config.type !== "jellyfin" && config.type !== "emby") ||
      !/HTTP 401|HTTP 403/.test(message)
    ) {
      throw error;
    }
    invalidateStreamingSession(serverId);
    const retried = await resolveStreamingAdapter(config);
    return request(retried.config, retried.adapter);
  }
};

/**
 * 测试服务器连接
 * @param input - 服务器表单
 * @param serverId - 编辑中的服务器 ID
 * @returns 连通性结果
 */
export const testStreamingConnection = async (
  input: StreamingServerInput,
  serverId?: string,
): Promise<StreamingPingResult> => {
  const config = createTestStreamingServer(input, serverId);
  try {
    const resolved = await resolveStreamingAdapter(config);
    const result = await resolved.adapter.ping(resolved.config);
    if (result.ok) return result;
    const code = result.code ?? classifyError(result.error);
    streamingLog.warn(`${input.type} 测试连接失败 [${input.name}]: ${result.error}`);
    return { ...result, code };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    streamingLog.warn(`${input.type} 测试连接失败 [${input.name}]: ${message}`);
    return { ok: false, error: message, code: classifyError(error) };
  } finally {
    invalidateStreamingSession(config.id);
  }
};

/**
 * 连接服务器
 * @param serverId - 服务器 ID
 * @returns 连接结果
 */
export const connectStreamingServer = async (serverId: string): Promise<StreamingConnectResult> => {
  let config: StreamingRuntimeConfig;
  try {
    config = getStreamingServer(serverId);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: "unknown",
    };
  }
  try {
    const resolved = await resolveStreamingAdapter(config);
    const ping = await resolved.adapter.ping(resolved.config);
    if (!ping.ok) {
      streamingLog.warn(`${config.type} 连接失败 [${config.name}]: ${ping.error}`);
      return {
        ok: false,
        error: ping.error ?? "连接失败",
        code: ping.code ?? classifyError(ping.error),
      };
    }
    const server = markStreamingServerConnected(serverId);
    streamingLog.info(`${config.type} 连接成功 [${config.name}]`);
    return { ok: true, server };
  } catch (error) {
    streamingLog.warn(`${config.type} 连接失败 [${config.name}]:`, error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: classifyError(error),
    };
  }
};
