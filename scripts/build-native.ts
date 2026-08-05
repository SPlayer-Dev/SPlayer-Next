import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

interface NativeModule {
  name: string;
  enabled?: boolean;
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
  {
    name: "taskbar-thumbnail",
    enabled: process.platform === "win32",
  },
];

const isRustAvailable = () => {
  const result = spawnSync("cargo", ["--version"], {
    stdio: "ignore",
  });

  return !result.error && !result.signal && result.status === 0;
};

if (process.env.SKIP_NATIVE_BUILD === "true" || process.env.SKIP_NATIVE_BUILD === "1") {
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

const parseArgs = () => {
  const options: {
    isDev: boolean;
    passing?: string[];
  } = {
    isDev: false,
  };

  const argv = process.argv;
  let index = 2;

  while (index < argv.length) {
    switch (argv[index]) {
      case "--dev": {
        options.isDev = true;
        index += 1;
        break;
      }
      case "--": {
        options.passing = argv.slice(index + 1);
        index = argv.length;
        break;
      }
      default: {
        console.error(`[BuildNative] 错误：未知参数 ${argv[index]}`);
        process.exit(1);
      }
    }
  }

  return options;
};

const napiArgs = ["--no-const-enum"];
const napiCli = join(process.cwd(), "node_modules", "@napi-rs", "cli", "dist", "cli.js");
const generatedDts = "index.generated.d.ts";
const options = parseArgs();

if (!options.isDev) napiArgs.push("--release");
if (options.passing) napiArgs.push(...options.passing);

for (const mod of modules) {
  if (mod.enabled === false) {
    continue;
  }
  const cwd = `native/${mod.name}`;
  const generatedDtsPath = join(cwd, generatedDts);
  const finalDtsPath = join(cwd, "index.d.ts");
  if (existsSync(generatedDtsPath)) unlinkSync(generatedDtsPath);

  const buildType = options.isDev ? "debug" : "release";
  console.log(`[BuildNative] 构建 ${mod.name} (${buildType})`);

  const result = spawnSync(
    process.execPath,
    [napiCli, "build", ...napiArgs, "--dts", generatedDts],
    {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: "pipe",
      shell: false,
      cwd,
    },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) {
    console.error("[BuildNative] 模块构建失败，进程启动失败", result.error);
    process.exit(1);
  }
  if (result.signal) {
    console.error("[BuildNative] 模块构建失败，进程被信号终止", result.signal);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error("[BuildNative] 模块构建失败，进程异常退出", result.status);
    process.exit(result.status ?? 1);
  }
  if (!existsSync(generatedDtsPath)) {
    console.error(`[BuildNative] ${mod.name} 未生成类型声明，拒绝把退出码 0 视为成功`);
    process.exit(1);
  }
  const typeDefinition = readFileSync(generatedDtsPath);
  if (typeDefinition.length === 0) {
    console.error(`[BuildNative] ${mod.name} 生成了空类型声明`);
    process.exit(1);
  }
  let written = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      writeFileSync(finalDtsPath, typeDefinition);
      written = true;
      break;
    } catch (error) {
      if (attempt === 4) {
        console.error(`[BuildNative] ${mod.name} 类型声明替换失败`, error);
        process.exit(1);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
  if (written) unlinkSync(generatedDtsPath);
}
