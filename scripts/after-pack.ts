import type { AfterPackContext } from "electron-builder";
import { readdir, unlink } from "fs/promises";
import { join } from "path";

/** 保留的 locale */
const keepLocales = new Set(["en-US.pak", "zh-CN.pak"]);

/** 打包后清理多余的 Chromium locale 文件 */
const afterPack = async (context: AfterPackContext): Promise<void> => {
  const localeDir = join(
    context.appOutDir,
    context.packager.platform.name === "mac"
      ? `${context.packager.appInfo.productFilename}.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources`
      : "locales",
  );
  try {
    const files = await readdir(localeDir);
    await Promise.all(
      files
        .filter((f) => f.endsWith(".pak") && !keepLocales.has(f))
        .map((f) => unlink(join(localeDir, f))),
    );
  } catch {}
};

export default afterPack;
