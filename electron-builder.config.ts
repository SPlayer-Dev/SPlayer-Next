import type { Configuration } from "electron-builder";
import { readFileSync } from "node:fs";
import { SUPPORTED_AUDIO_EXTENSIONS } from "./shared/utils/audioFile";

/** 音频后缀注册为文件关联 */
const fileAssociations = [...SUPPORTED_AUDIO_EXTENSIONS].map((extension) => {
  const ext = extension.slice(1);
  return {
    ext,
    description: `${ext.toUpperCase()} Audio File`,
    role: "Viewer" as const,
  };
});

const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version as string;
const prereleaseChannel = /-(alpha|beta)(?:\.|$)/.exec(packageVersion)?.[1];
const inferredUpdateChannel = prereleaseChannel ?? "latest";
const updateChannel = process.env.UPDATE_CHANNEL ?? inferredUpdateChannel;

if (updateChannel !== "latest" && updateChannel !== "beta" && updateChannel !== "alpha") {
  throw new Error(`不支持的更新通道: ${updateChannel}`);
}
if (packageVersion.includes("-") && !prereleaseChannel) {
  throw new Error(`不支持的预发布版本格式: ${packageVersion}`);
}
if (updateChannel !== inferredUpdateChannel) {
  throw new Error(`版本 ${packageVersion} 与更新通道 ${updateChannel} 不匹配`);
}

const config: Configuration = {
  appId: "top.imsyy.splayer-next",
  productName: "SPlayer-Next",
  copyright: "Copyright © imsyy 2025",
  directories: { buildResources: "public" },
  fileAssociations,
  afterPack: "./scripts/after-pack.ts",
  compression: "maximum",
  generateUpdatesFilesForAllChannels: true,
  files: [
    "public/**",
    "out/**",
    "!**/.vscode/*",
    "!src/**",
    "!native/**",
    "!scripts/**",
    "!electron/**",
    "!shared/**",
    "!electron.vite.config.{js,ts,mjs,cjs}",
    "!electron-builder.config.{js,ts,mjs,cjs}",
    "!uno.config.{js,ts,mjs,cjs}",
    "!{.eslintcache,eslint.config.mjs,auto-eslint.mjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}",
    "!{components.d.ts,auto-imports.d.ts}",
    "!{.env,.env.*,.npmrc,pnpm-lock.yaml}",
    "!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}",
    "!**/*.{d.ts,ts,map,md}",
    "!**/{CHANGELOG,README,readme}*",
    "!**/node_modules/better-sqlite3/{deps,src}/**",
  ],
  // 保留的语言
  electronLanguages: ["zh-CN", "en-US"],
  asarUnpack: ["public/**"],
  extraResources: [
    {
      from: "native/audio-engine",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/audio-capture",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "resources/afp",
      to: "afp",
      filter: ["afp.mjs", "afp.wasm.mjs"],
    },
    {
      from: "native/media-ctrl",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/linux-portal",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/taskbar-lyric",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/taskbar-thumbnail",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/opencc",
      to: "native",
      filter: ["*.node"],
    },
  ],
  win: {
    executableName: "SPlayer-Next",
    icon: "public/icons/logo.ico",
    artifactName: "${productName}-${version}-${arch}.${ext}",
    forceCodeSigning: false,
    target: ["nsis", "portable"],
    protocols: [{ name: "Orpheus Protocol", schemes: ["orpheus"] }],
  },
  nsis: {
    oneClick: false,
    guid: "top.imsyy.splayer-next",
    installerIcon: "public/icons/favicon.ico",
    uninstallerIcon: "public/icons/favicon.ico",
    artifactName: "${productName}-${version}-${arch}-setup.${ext}",
    shortcutName: "SPlayer Next",
    uninstallDisplayName: "SPlayer Next",
    createDesktopShortcut: "always",
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    license: "build/license.txt",
  },
  portable: {
    artifactName: "${productName}-${version}-${arch}-portable.${ext}",
  },
  mac: {
    executableName: "SPlayer-Next",
    icon: "public/icons/icon.icns",
    artifactName: "${productName}-${version}-${arch}.${ext}",
    identity: null,
    hardenedRuntime: false,
    notarize: false,
    darkModeSupport: true,
    category: "public.app-category.music",
    entitlementsInherit: "public/entitlements.mac.plist",
    extendInfo: {
      NSCameraUsageDescription: "Application requests access to the device's camera.",
      NSMicrophoneUsageDescription: "Application requests access to the device's microphone.",
      NSDocumentsFolderUsageDescription:
        "Application requests access to the user's Documents folder.",
      NSDownloadsFolderUsageDescription:
        "Application requests access to the user's Downloads folder.",
      CFBundleURLTypes: [{ CFBundleURLName: "Orpheus Protocol", CFBundleURLSchemes: ["orpheus"] }],
    },
    target: ["dmg", "zip"],
  },
  dmg: {
    artifactName: "${productName}-${version}-${arch}.${ext}",
  },
  linux: {
    executableName: "SPlayer-Next",
    icon: "public/icons/favicon-512x512.png",
    artifactName: "${name}-${version}-${arch}.${ext}",
    maintainer: "imsyy.top",
    category: "Audio;Music;AudioVideo;",
    target: ["AppImage", "deb", "rpm", "tar.gz", "pacman"],
    syncDesktopName: true,
    desktop: { entry: { MimeType: "x-scheme-handler/orpheus;" } },
  },
  appImage: {
    artifactName: "${name}-${version}-${arch}.${ext}",
  },
  pacman: {
    artifactName: "${name}-${version}-${arch}.${ext}",
    depends: [
      "gtk3",
      "libnotify",
      "nss",
      "libxss",
      "libxtst",
      "xdg-utils",
      "at-spi2-core",
      "libsecret",
    ],
  },
  npmRebuild: false,
  electronDownload: {
    mirror: "https://npmmirror.com/mirrors/electron/",
  },
  publish: {
    provider: "github",
    owner: "SPlayer-Dev",
    repo: "SPlayer-Next",
    channel: updateChannel,
  },
};

export default config;
