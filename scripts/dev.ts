#!/usr/bin/env node

/**
 * 跨平台开发启动脚本
 * 自动检测操作系统并设置相应的字符编码
 */

import { spawn } from "child_process";
import os from "os";

// 检测操作系统平台
const platform = os.platform();
const isWindows = platform === "win32";
const isMacOS = platform === "darwin";

console.log(`检测到操作系统: ${platform}`);

// 设置环境变量
const env: NodeJS.ProcessEnv = { ...process.env };

const startForge = (): void => {
  console.log("正在启动 Electron Forge 开发服务器...");

  // 设置 Node.js 选项
  env.NODE_OPTIONS = "--max-old-space-size=4096";

  // 传递给 electron-forge 的参数
  const runArgs = ["start"];
  // 前两个参数分别是 node 和此脚本的路径，丢弃它们
  const args = process.argv.slice(2);
  // 添加参数
  if (args.length > 0) {
    runArgs.push(...args);
  }

  const forge = spawn("electron-forge", runArgs, {
    stdio: "inherit",
    shell: true,
    env,
  });

  forge.on("close", (code) => {
    console.log(`\n开发服务器已停止 (退出码: ${code})`);
    process.exit(code ?? 0);
  });

  forge.on("error", (err) => {
    console.error("启动失败:", err.message);
    process.exit(1);
  });

  // 优雅退出处理
  process.on("SIGINT", () => {
    console.log("\n正在停止开发服务器...");
    forge.kill("SIGINT");
  });

  process.on("SIGTERM", () => {
    console.log("\n正在停止开发服务器...");
    forge.kill("SIGTERM");
  });
};

if (isWindows) {
  console.log("Windows 环境 - 正在设置代码页为 UTF-8");
  // Windows 环境下先执行 chcp 65001
  const chcp = spawn("chcp", ["65001"], {
    stdio: "inherit",
    shell: true,
    env,
  });

  chcp.on("close", (code) => {
    if (code === 0) {
      console.log("代码页设置成功");
      startForge();
    } else {
      console.warn("代码页设置失败，继续启动...");
      startForge();
    }
  });
} else {
  // macOS 和 Linux 环境
  console.log(`${isMacOS ? "macOS" : "Linux"} 环境 - 正在设置 UTF-8 编码`);
  const langVar = env.LC_ALL || env.LANG || "";
  if (langVar.endsWith("UTF-8")) {
    console.log("当前环境已设置 UTF-8 编码");
  } else {
    if (langVar.startsWith("zh_CN")) {
      env.LC_ALL = "zh_CN.UTF-8";
      env.LANG = "zh_CN.UTF-8";
    } else {
      env.LC_ALL = "en_US.UTF-8";
      env.LANG = "en_US.UTF-8";
    }
  }
  setTimeout(() => startForge(), 0);
}
