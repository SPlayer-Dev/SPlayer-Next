import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

interface NativeModule {
  name: string;
  enabled?: boolean;
}

interface NativeBuildCache {
  mode: "debug" | "release";
  hash: string;
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

const readJson = <T>(path: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
};

const collectFiles = (dir: string): string[] => {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectFiles(path));
      continue;
    }

    if (entry.isFile()) {
      files.push(path);
    }
  }

  return files;
};

const hashFile = (hash: ReturnType<typeof createHash>, path: string) => {
  if (!existsSync(path)) {
    hash.update(`missing:${path}\n`);
    return;
  }

  hash.update(`file:${path}\n`);
  hash.update(readFileSync(path));
};

const getNativeBuildHash = (cwd: string) => {
  const hash = createHash("sha256");
  const inputs = ["Cargo.toml", "Cargo.lock", "package.json", "pnpm-lock.yaml"];

  hash.update(`platform:${process.platform}\n`);
  hash.update(`arch:${process.arch}\n`);

  for (const input of inputs) {
    hashFile(hash, input);
  }

  for (const input of ["Cargo.toml", "build.rs", "package.json"]) {
    hashFile(hash, join(cwd, input));
  }

  for (const file of collectFiles(join(cwd, "src")).sort()) {
    hashFile(hash, file);
  }

  return hash.digest("hex");
};

const getNativeOutputPath = (cwd: string, name: string) => join(cwd, `${name}.node`);

const getCachePath = (cwd: string) => join(cwd, ".build-native-cache.json");

const shouldSkipNativeBuild = (cwd: string, name: string, mode: NativeBuildCache["mode"]) => {
  const outputPath = getNativeOutputPath(cwd, name);
  const typePath = join(cwd, "index.d.ts");

  if (!existsSync(outputPath) || !existsSync(typePath)) {
    return false;
  }

  const outputStat = statSync(outputPath);
  if (outputStat.size === 0) {
    return false;
  }

  const cache = readJson<NativeBuildCache>(getCachePath(cwd));
  if (!cache || cache.mode !== mode) {
    return false;
  }

  return cache.hash === getNativeBuildHash(cwd);
};

const writeNativeBuildCache = (cwd: string, mode: NativeBuildCache["mode"]) => {
  const cache: NativeBuildCache = {
    mode,
    hash: getNativeBuildHash(cwd),
  };

  writeFileSync(getCachePath(cwd), `${JSON.stringify(cache, null, 2)}\n`);
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
const options = parseArgs();
const buildType = options.isDev ? "debug" : "release";
const canUseDevCache = options.isDev && !options.passing;
const projectRoot = process.cwd();
const napiCliPath = join(projectRoot, "node_modules", "@napi-rs", "cli", "dist", "cli.js");

if (!options.isDev) napiArgs.push("--release");
if (options.passing) napiArgs.push(...options.passing);

for (const mod of modules) {
  if (mod.enabled === false) {
    continue;
  }
  const cwd = `native/${mod.name}`;

  if (canUseDevCache && shouldSkipNativeBuild(cwd, mod.name, buildType)) {
    console.log(`[BuildNative] 跳过 ${mod.name} (${buildType})，原生输入未变化`);
    continue;
  }

  console.log(`[BuildNative] 构建 ${mod.name} (${buildType})`);

  const result = spawnSync(process.execPath, [napiCliPath, "build", ...napiArgs], {
    stdio: "inherit",
    shell: false,
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

  if (canUseDevCache) {
    writeNativeBuildCache(cwd, buildType);
  }
}
