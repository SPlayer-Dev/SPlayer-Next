import type { ForgeConfig } from "@electron-forge/shared-types";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { SUPPORTED_AUDIO_EXTENSIONS } from "./shared/utils/audioFile";
import { packageAfterCopy } from "./scripts/forge/hooks";
import { ElectronBuilderMaker } from "./scripts/forge/maker";

/** 音频后缀注册为 mac 文件关联，Windows / Linux 由 electron-builder 的 fileAssociations 处理 */
const documentTypes = [...SUPPORTED_AUDIO_EXTENSIONS].map((extension) => {
  const ext = extension.slice(1);
  return {
    CFBundleTypeName: ext,
    CFBundleTypeExtensions: [ext],
    CFBundleTypeRole: "Viewer",
    LSHandlerRank: "Default",
  };
});

const config: ForgeConfig = {
  packagerConfig: {
    name: "SPlayer-Next",
    executableName: "SPlayer-Next",
    appBundleId: "top.imsyy.splayer-next",
    appCopyright: "Copyright © imsyy 2025",
    appCategoryType: "public.app-category.music",
    icon: process.platform === "darwin" ? "public/icons/icon.icns" : "public/icons/logo.ico",
    darwinDarkModeSupport: true,
    protocols: [{ name: "Orpheus Protocol", schemes: ["orpheus"] }],
    asar: { unpack: "**/{public,node_modules/better-sqlite3,node_modules/font-list}/**" },
    // 原生依赖由 packageAfterCopy 复制，package.json 由 Vite 插件写入
    ignore: (file) => !!file && !/^\/(\.vite|public)(\/|$)/.test(file),
    prune: false,
    download: { mirrorOptions: { mirror: "https://npmmirror.com/mirrors/electron/" } },
    win32metadata: {
      CompanyName: "imsyy",
      ProductName: "SPlayer-Next",
      FileDescription: "SPlayer-Next",
    },
    extendInfo: {
      NSCameraUsageDescription: "Application requests access to the device's camera.",
      NSMicrophoneUsageDescription: "Application requests access to the device's microphone.",
      NSDocumentsFolderUsageDescription:
        "Application requests access to the user's Documents folder.",
      NSDownloadsFolderUsageDescription:
        "Application requests access to the user's Downloads folder.",
      CFBundleDocumentTypes: documentTypes,
    },
  },
  // better-sqlite3 使用 N-API 预编译文件，postinstall 已处理，无需 Forge 重编译
  rebuildConfig: { onlyModules: [] },
  makers: [new ElectronBuilderMaker()],
  hooks: { packageAfterCopy },
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: {
            index: "electron/main/index.ts",
            "host.worker": "electron/main/plugins/host.worker.ts",
            "fingerprint.worker": "electron/main/services/recognition/fingerprint.worker.ts",
          },
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: { preload: "electron/preload/index.ts" },
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
    }),
  ],
};

export default config;
