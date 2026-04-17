import { execSync } from "node:child_process";
import process from "node:process";

interface NativeModule {
  name: string;
  enabled?: boolean;
}

const isRustAvailable = () => {
  try {
    execSync("cargo --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

if (process.env.SKIP_NATIVE_BUILD === "true") {
  console.log("[BuildNative] SKIP_NATIVE_BUILD 已设置，跳过原生模块构建");
  process.exit(0);
}

if (!isRustAvailable()) {
  console.error("[BuildNative] 错误：检测不到 Rust 工具链");
  console.error("[BuildNative] 未设置 SKIP_NATIVE_BUILD，因此必须包含 Rust 环境才能继续");
  console.error(
    "[BuildNative] 安装 Rust (https://rust-lang.org/tools/install/) 或者设置环境变量 SKIP_NATIVE_BUILD=true",
  );
  process.exit(1);
}

const modules: NativeModule[] = [
  {
    name: "audio-engine",
  },
  {
    name: "media-ctrl",
  },
  {
    name: "taskbar-lyric",
    enabled: process.platform === "win32",
  },
];

try {
  const args = process.argv.slice(2);
  const isDev = args.includes("--dev");
  const napiArgs = isDev ? "" : "--release";

  for (const mod of modules) {
    if (mod.enabled === false) {
      continue;
    }
    const cwd = `native/${mod.name}`;
    console.log(`[BuildNative] 构建 ${mod.name} (${isDev ? "debug" : "release"})`);
    execSync(`napi build --no-const-enum ${napiArgs}`.trim(), {
      stdio: "inherit",
      cwd,
    });
  }
} catch (error) {
  console.error("[BuildNative] 模块构建失败", error);
  process.exit(1);
}
