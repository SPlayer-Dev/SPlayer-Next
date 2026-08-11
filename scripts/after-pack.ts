import { type AfterPackContext, Arch } from "electron-builder";
import { join } from "path";
import { rm } from "node:fs/promises";

let hasWarnedCleanupOnce = false;
const printCleanupWarningOnce = () => {
  if (!hasWarnedCleanupOnce) {
    hasWarnedCleanupOnce = true;
    console.warn(
      `[AfterPack] 部分文件清理失败。这不会影响 App 构建和运行，但可能导致包体积略大于预期。`,
    );
  }
};

const tryRm = async (path: string, options?: object): Promise<void> => {
  try {
    await rm(path, options);
  } catch (error: any) {
    printCleanupWarningOnce();
    console.warn(`[AfterPack] 清理失败 "${path}": ${error.message}`);
  }
};

const afterPack = async (context: AfterPackContext): Promise<void> => {
  const resourceDir = join(
    context.appOutDir,
    context.packager.platform.name === "mac"
      ? `${context.packager.appInfo.productFilename}.app/Contents/Resources`
      : "resources",
  );

  await Promise.all([
    trimBetterSqlite3(resourceDir, context),
    trimFontListLibs(resourceDir, context),
  ]);
};

const trimBetterSqlite3 = async (resourceDir: string, context: AfterPackContext) => {
  const dir = join(resourceDir, "app.asar.unpacked/node_modules/better-sqlite3/");
  const allPlatform = ["win32", "darwin", "linux", "linuxmusl"];
  const allArch = ["x64", "arm64"];
  const keepPlatform = new Set<string>([context.electronPlatformName]); // 暂时不考虑 linuxmusl
  const keepArch = new Set<string>();

  switch (context.arch) {
    case Arch.x64:
      keepArch.add("x64");
      break;
    case Arch.arm64:
      keepArch.add("arm64");
      break;
    case Arch.universal:
      keepArch.add("x64");
      keepArch.add("arm64");
      break;
    default:
      printCleanupWarningOnce();
      console.error("[AfterPack] 未知架构: " + context.arch);
      return;
  }

  const deletePromises: Promise<void>[] = [];
  for (const platform of allPlatform) {
    for (const arch of allArch) {
      if (keepPlatform.has(platform) && keepArch.has(arch)) continue;
      const fileName = `${platform}-${arch}`;
      deletePromises.push(
        tryRm(join(dir, "prebuilds", `${fileName}.node`), { force: true }),
        tryRm(join(dir, "lib", `${fileName}.js`), { force: true }),
      );
    }
  }

  await Promise.all(deletePromises);
};

const trimFontListLibs = async (resourceDir: string, context: AfterPackContext) => {
  const dir = join(resourceDir, "app.asar.unpacked/node_modules/font-list/libs/");
  const allPlatform = ["win32", "darwin", "linux"];
  const keepPlatform = new Set<string>([context.electronPlatformName]);

  const deletePromises: Promise<void>[] = [];
  for (const platform of allPlatform) {
    if (keepPlatform.has(platform)) continue;
    deletePromises.push(tryRm(join(dir, platform), { recursive: true, force: true }));
  }

  await Promise.all(deletePromises);
};

export default afterPack;
