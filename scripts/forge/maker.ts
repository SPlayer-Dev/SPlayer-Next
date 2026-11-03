import path from "node:path";
import { MakerBase, type EmptyConfig, type MakerOptions } from "@electron-forge/maker-base";
import type { ForgePlatform } from "@electron-forge/shared-types";
import { Arch, build, Platform } from "electron-builder";

/** 各平台交给 electron-builder 生成的安装包目标 */
const TARGETS = {
  win32: { platform: Platform.WINDOWS, targets: ["nsis", "portable"] },
  darwin: { platform: Platform.MAC, targets: ["dmg", "zip"] },
  linux: { platform: Platform.LINUX, targets: ["AppImage", "deb", "rpm", "tar.gz", "pacman"] },
};

/** 以 prepackaged 模式调用 electron-builder，沿用其安装包与更新元数据 */
export class ElectronBuilderMaker extends MakerBase<EmptyConfig> {
  name = "electron-builder";
  defaultPlatforms: ForgePlatform[] = ["win32", "darwin", "linux"];

  /**
   * electron-builder 自行下载所需工具，所有平台均可运行
   * @returns 始终为 true
   */
  isSupportedOnCurrentPlatform(): boolean {
    return true;
  }

  /**
   * 生成目标平台的全部安装包
   * @param options - Forge 传入的打包输出目录与目标平台架构
   * @returns 生成的产物路径
   */
  async make({ dir, appName, targetPlatform, targetArch }: MakerOptions): Promise<string[]> {
    const { platform, targets } = TARGETS[targetPlatform as keyof typeof TARGETS];
    return build({
      targets: platform.createTarget(targets, Arch[targetArch as keyof typeof Arch]),
      // mac 的 prepackaged 需指向 .app 本身
      prepackaged: targetPlatform === "darwin" ? path.join(dir, `${appName}.app`) : dir,
      config: "electron-builder.config.ts",
      publish: "never",
    });
  }
}
