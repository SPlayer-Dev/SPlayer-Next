import { ipcMain } from "electron";
import { getMcpClientConfigParams, getMcpStatus, restartMcpServer } from "@main/services/mcp/http";
import { detectMcpAgents, injectMcpAgentConfig } from "@main/services/mcp/injector";
import type { McpClientConfigParams } from "@shared/types/settings";

/** 注册 MCP 服务状态与重启接口 */
export const registerMcpIpc = (): void => {
  ipcMain.handle("mcp:restart", () => restartMcpServer());
  ipcMain.handle("mcp:getStatus", () => getMcpStatus());
  ipcMain.handle("mcp:getClientConfigParams", () => getMcpClientConfigParams());
  ipcMain.handle("mcp:detectAgents", () => detectMcpAgents());
  ipcMain.handle("mcp:injectAgentConfig", (_e, agentId: string, params: McpClientConfigParams) =>
    injectMcpAgentConfig(agentId, params),
  );
};
