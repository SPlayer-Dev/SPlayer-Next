import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { app } from "electron";
import type { McpAgentApp, McpClientConfigParams } from "@shared/types/settings";
import { nativeLog } from "@main/utils/logger";
import { isLinux, isMac, isWin } from "@main/utils/config";

interface AgentDefinition {
  id: string;
  name: string;
  getConfigPath: () => string;
  getInstallPaths: () => string[];
  format?: "json" | "toml" | "antigravity";
  injectable?: boolean;
}

const getAppDataPath = () => app.getPath("appData");

const SUPPORTED_AGENTS: AgentDefinition[] = [
  {
    id: "codex",
    name: "Codex",
    getConfigPath: () => path.join(os.homedir(), ".codex", "config.toml"),
    getInstallPaths: () => [
      path.join(os.homedir(), ".codex"),
      ...(isWin ? [path.join(getAppDataPath(), "..", "Local", "OpenAI", "Codex")] : []),
    ],
    format: "toml",
  },
  {
    id: "claudecode",
    name: "Claude Code",
    getConfigPath: () => path.join(os.homedir(), ".claude.json"),
    getInstallPaths: () => [path.join(os.homedir(), ".claude")],
  },
  {
    id: "cursor",
    name: "Cursor",
    getConfigPath: () => path.join(os.homedir(), ".cursor", "mcp.json"),
    getInstallPaths: () => [
      path.join(os.homedir(), ".cursor"),
      ...(isWin ? [path.join(getAppDataPath(), "..", "Local", "Programs", "cursor")] : []),
    ],
  },
  {
    id: "claudedesktop",
    name: "Claude Desktop",
    getConfigPath: () => {
      if (isWin) {
        return path.join(getAppDataPath(), "Claude", "claude_desktop_config.json");
      }
      return path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json",
      );
    },
    getInstallPaths: () => [
      isWin
        ? path.join(getAppDataPath(), "Claude")
        : path.join(os.homedir(), "Library", "Application Support", "Claude"),
    ],
    injectable: false,
  },
  {
    id: "codebuddy",
    name: "CodeBuddy",
    getConfigPath: () => path.join(os.homedir(), ".codebuddy", "mcp.json"),
    getInstallPaths: () => [path.join(os.homedir(), ".codebuddy")],
  },
  {
    id: "antigravity",
    name: "Antigravity IDE / CLI",
    getConfigPath: () => path.join(os.homedir(), ".gemini", "config", "mcp_config.json"),
    getInstallPaths: () => {
      const userInstallPaths = [
        path.join(os.homedir(), ".gemini", "antigravity"),
        path.join(os.homedir(), ".gemini", "antigravity-ide"),
        path.join(os.homedir(), ".gemini", "antigravity-cli"),
      ];
      if (isWin) {
        return [
          ...userInstallPaths,
          path.join(getAppDataPath(), "Antigravity"),
          path.join(getAppDataPath(), "..", "Local", "Programs", "Antigravity"),
          path.join(getAppDataPath(), "..", "Local", "Antigravity"),
        ];
      }
      if (isMac) {
        return [
          ...userInstallPaths,
          "/Applications/Antigravity.app",
          path.join(os.homedir(), "Applications", "Antigravity.app"),
        ];
      }
      if (isLinux) {
        return [
          ...userInstallPaths,
          path.join(os.homedir(), ".config", "Antigravity"),
          "/opt/Antigravity",
        ];
      }
      return userInstallPaths;
    },
    format: "antigravity",
  },
];

/**
 * 探测本地已安装的 AI Agent 及配置状态
 */
export const detectMcpAgents = async (): Promise<McpAgentApp[]> => {
  const detected: McpAgentApp[] = [];

  for (const agent of SUPPORTED_AGENTS) {
    const configPath = agent.getConfigPath();
    const installed = await Promise.any(
      [configPath, ...agent.getInstallPaths()].map((candidate) => fs.stat(candidate)),
    ).then(
      () => true,
      () => false,
    );

    if (!installed) continue;

    let configured = false;
    try {
      const stats = await fs.stat(configPath);
      if (stats.isFile()) {
        const content = await fs.readFile(configPath, "utf-8");
        configured =
          agent.format === "toml"
            ? /^\s*\[mcp_servers\.splayer-next\]\s*$/m.test(content)
            : !!JSON.parse(content || "{}")?.mcpServers?.["splayer-next"];
      }
    } catch (error) {
      const e = error as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") {
        nativeLog.warn(`Failed to read config for ${agent.name} at ${configPath}: ${e.message}`);
      }
    }

    detected.push({
      id: agent.id,
      name: agent.name,
      configPath,
      configured,
      injectable: agent.injectable !== false,
    });
  }

  return detected;
};

/**
 * 将 SPlayer-Next 的 MCP 配置注入到目标 Agent 中
 */
export const injectMcpAgentConfig = async (
  agentId: string,
  params: McpClientConfigParams,
): Promise<boolean> => {
  const agent = SUPPORTED_AGENTS.find((a) => a.id === agentId);
  if (!agent) {
    throw new Error(`Unsupported agent: ${agentId}`);
  }
  if (agent.injectable === false) {
    throw new Error(`Automatic configuration is not supported for ${agent.name}`);
  }

  const configPath = agent.getConfigPath();

  if (agent.format === "toml") {
    let content = "";
    try {
      content = await fs.readFile(configPath, "utf-8");
    } catch (error) {
      const e = error as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") throw error;
    }

    if (/^\s*\[mcp_servers\.splayer-next\]\s*$/m.test(content)) return true;

    const section = [
      "[mcp_servers.splayer-next]",
      `url = "http://127.0.0.1:${params.port}/mcp"`,
      `http_headers = { "X-MCP-Key" = ${JSON.stringify(params.accessKey)} }`,
    ].join("\n");
    const nextContent = `${content.trimEnd()}${content.trim() ? "\n\n" : ""}${section}\n`;

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, nextContent, "utf-8");
    return true;
  }

  let json: any = {};

  try {
    const content = await fs.readFile(configPath, "utf-8");
    json = JSON.parse(content || "{}");
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      json = {};
    } else {
      throw new Error(`Failed to parse agent config: ${e.message}`);
    }
  }

  if (!json.mcpServers) {
    json.mcpServers = {};
  }

  json.mcpServers["splayer-next"] =
    agent.format === "antigravity"
      ? {
          serverUrl: `http://127.0.0.1:${params.port}/mcp`,
          headers: { "X-MCP-Key": params.accessKey },
        }
      : {
          type: "http",
          url: `http://127.0.0.1:${params.port}/mcp`,
          headers: { "X-MCP-Key": params.accessKey },
        };

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(json, null, 2), "utf-8");

  return true;
};
