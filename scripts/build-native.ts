import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import os from "node:os";

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

/** Windows 下加载 MSVC + Windows SDK 环境，避免 C/C++ 依赖找不到 errno.h。 */
const configureMsvcEnvironment = () => {
  if (process.platform !== "win32") return;
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const candidates = [
    join(
      programFiles,
      "Microsoft Visual Studio",
      "18",
      "Insiders",
      "VC",
      "Auxiliary",
      "Build",
      "vcvars64.bat",
    ),
    join(
      programFiles,
      "Microsoft Visual Studio",
      "2022",
      "Community",
      "VC",
      "Auxiliary",
      "Build",
      "vcvars64.bat",
    ),
    join(
      programFiles,
      "Microsoft Visual Studio",
      "2022",
      "BuildTools",
      "VC",
      "Auxiliary",
      "Build",
      "vcvars64.bat",
    ),
  ];
  const vcvars = candidates.find((candidate) => existsSync(candidate));
  if (!vcvars || process.env.VCToolsInstallDir) return;
  const tempDir = mkdtempSync(join(os.tmpdir(), "splayer-vcvars-"));
  const batchFile = join(tempDir, "env.bat");
  try {
    writeFileSync(batchFile, `@call "${vcvars}"\r\n@set\r\n`, "utf8");
    const output = execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", batchFile], {
      encoding: "utf8",
      windowsHide: true,
    });
    for (const line of output.split(/\r?\n/)) {
      const separator = line.indexOf("=");
      if (separator <= 0) continue;
      process.env[line.slice(0, separator)] = line.slice(separator + 1);
    }
    console.log(`[BuildNative] 使用 MSVC: ${vcvars}`);
  } catch (error) {
    console.warn(`[BuildNative] 加载 MSVC 环境失败: ${String(error)}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
};

/** Windows 下自动寻找 bindgen 所需的 libclang，优先尊重用户显式配置。 */
const configureLibclang = () => {
  if (process.platform !== "win32") return;
  const roots = [process.env.MSYS2_ROOT, "C:\\msys64", "C:\\msys2"].filter((root): root is string =>
    Boolean(root),
  );
  const candidates = roots.map((root) => join(root, "clang64", "bin"));
  const libclangPath =
    process.env.LIBCLANG_PATH ??
    candidates.find((candidate) => existsSync(join(candidate, "libclang.dll")));
  if (libclangPath) {
    process.env.LIBCLANG_PATH = libclangPath;
    const pathEntries = (process.env.PATH ?? "").split(";");
    if (!pathEntries.some((entry) => entry.toLowerCase() === libclangPath.toLowerCase())) {
      // 放在 PATH 末尾，避免 MSYS2 clang 抢走 MSVC/FFmpeg 的 C/C++ 工具链。
      process.env.PATH = `${process.env.PATH ?? ""};${libclangPath}`;
    }
    console.log(`[BuildNative] 使用 libclang: ${libclangPath}`);
  }
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

configureMsvcEnvironment();
configureLibclang();

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
const options = parseArgs();

if (!options.isDev) napiArgs.push("--release");
if (options.passing) napiArgs.push(...options.passing);

for (const mod of modules) {
  if (mod.enabled === false) {
    continue;
  }
  const cwd = `native/${mod.name}`;

  const buildType = options.isDev ? "debug" : "release";
  console.log(`[BuildNative] 构建 ${mod.name} (${buildType})`);

  const result = spawnSync("napi", ["build", ...napiArgs], {
    stdio: "inherit",
    shell: process.platform === "win32",
    cwd,
  });

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
}
