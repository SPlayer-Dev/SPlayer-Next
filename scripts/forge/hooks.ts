import { existsSync, realpathSync } from "node:fs";
import { cp, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { ForgeHookFn } from "@electron-forge/shared-types";

/** 运行时从 node_modules 加载的原生依赖，主进程构建时设为外部依赖，打包时由钩子复制 */
export const NATIVE_DEPENDENCIES = ["better-sqlite3", "font-list"] as const;

type NativeDependency = (typeof NATIVE_DEPENDENCIES)[number];

/** 复制到 resources/native 的原生模块，对应 native/<name>/<name>.node */
const NATIVE_MODULES = [
  "audio-engine",
  "audio-capture",
  "media-ctrl",
  "taskbar-lyric",
  "taskbar-thumbnail",
  "opencc",
];

/** 保留的 Chromium 语言 */
const KEPT_LOCALES = ["zh-cn", "en-us"];

/**
 * 判断原生依赖中的文件是否需要复制进安装包
 * @param dependency - 依赖包名
 * @param relativePath - 相对包根目录的路径，以 / 分隔
 * @param target - 目标平台与架构，例如 darwin-arm64
 * @returns 是否复制
 */
export const shouldCopyDependencyFile = (
  dependency: NativeDependency,
  relativePath: string,
  target: string,
): boolean => {
  if (/\.(d\.[cm]?ts|md)$/.test(relativePath)) return false;
  const [top, second = ""] = relativePath.split("/");
  if (dependency === "better-sqlite3") {
    if (["deps", "src", "binding.gyp"].includes(top)) return false;
    if (top === "prebuilds" && second) return second === `${target}.node`;
    if (top === "lib" && /^(win32|darwin|linux|linuxmusl)-/.test(second)) {
      return second === `${target}.js`;
    }
    return true;
  }
  if (top === "libs" && ["win32", "darwin", "linux"].includes(second)) {
    return target.startsWith(`${second}-`);
  }
  return true;
};

/**
 * 判断 Chromium 语言文件是否保留，区域语言可匹配 mac 的无区域目录（en-US 保留 en.lproj）
 * @param fileName - locales 下的 .pak 文件名或 mac 的 .lproj 目录名
 * @returns 是否保留
 */
export const isKeptLocale = (fileName: string): boolean => {
  const language = path.parse(fileName).name.toLowerCase().replace(/_/g, "-");
  return KEPT_LOCALES.some((wanted) => wanted === language || wanted.startsWith(`${language}-`));
};

/**
 * 删除未使用的 Chromium 语言文件
 * @param dir - 语言文件所在目录
 * @param ext - 语言文件后缀
 */
const pruneLocales = async (dir: string, ext: ".pak" | ".lproj"): Promise<void> => {
  const unused = (await readdir(dir)).filter((name) => name.endsWith(ext) && !isKeptLocale(name));
  await Promise.all(
    unused.map((name) => rm(path.join(dir, name), { recursive: true, force: true })),
  );
};

/**
 * 补齐 Vite 产物之外的运行时文件，替代 electron-builder 打包阶段的 files / extraResources / afterPack
 * @param _config - Forge 配置
 * @param buildPath - 打包中的 app 目录
 * @param _electronVersion - Electron 版本
 * @param platform - 目标平台
 * @param arch - 目标架构
 */
export const packageAfterCopy: ForgeHookFn<"packageAfterCopy"> = async (
  _config,
  buildPath,
  _electronVersion,
  platform,
  arch,
) => {
  const root = process.cwd();
  const resourcesDir = path.dirname(buildPath);
  const contentDir = path.dirname(resourcesDir);
  const target = `${platform}-${arch}`;

  await Promise.all(
    NATIVE_DEPENDENCIES.map((dependency) => {
      const source = realpathSync(path.join(root, "node_modules", dependency));
      return cp(source, path.join(buildPath, "node_modules", dependency), {
        recursive: true,
        filter: (file) =>
          shouldCopyDependencyFile(
            dependency,
            path.relative(source, file).split(path.sep).join("/"),
            target,
          ),
      });
    }),
  );

  // 部分原生模块只在特定平台构建
  const nativeFiles = NATIVE_MODULES.map((name) => path.join(root, "native", name, `${name}.node`));
  await Promise.all(
    nativeFiles
      .filter((file) => existsSync(file))
      .map((file) => cp(file, path.join(resourcesDir, "native", path.basename(file)))),
  );

  await cp(path.join(root, "resources/afp"), path.join(resourcesDir, "afp"), { recursive: true });
  // electron-updater 下载更新需要其中的 updaterCacheDirName，prepackaged 模式下 electron-builder 不会生成
  await cp(path.join(root, "dev-app-update.yml"), path.join(resourcesDir, "app-update.yml"));

  if (platform === "darwin") {
    await pruneLocales(resourcesDir, ".lproj");
    await pruneLocales(
      path.join(contentDir, "Frameworks", "Electron Framework.framework", "Resources"),
      ".lproj",
    );
  } else {
    await rename(path.join(contentDir, "LICENSE"), path.join(contentDir, "LICENSE.electron.txt"));
    await pruneLocales(path.join(contentDir, "locales"), ".pak");
  }
  await cp(path.join(root, "LICENSE"), path.join(contentDir, "LICENSE"));
};
