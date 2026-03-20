import type { Configuration } from "electron-builder";

const config: Configuration = {
  appId: "com.imsyy.splayer-next",
  productName: "SPlayer Next",
  copyright: "Copyright © imsyy 2025",
  directories: {
    buildResources: "build",
  },
  files: [
    "!**/.vscode/*",
    "!src/*",
    "!native/*",
    "!scripts/*",
    "!electron.vite.config.{js,ts,mjs,cjs}",
    "!{.eslintcache,eslint.config.mjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}",
    "!{.env,.env.*,.npmrc,pnpm-lock.yaml}",
    "!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}",
  ],
  asarUnpack: ["resources/**"],
  extraResources: [
    {
      from: "native/audio-engine",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/media-ctrl",
      to: "native",
      filter: ["*.node"],
    },
  ],
  win: {
    executableName: "SPlayer-Next",
    artifactName: "${productName}-${version}-${arch}.${ext}",
    // 未配置证书时跳过签名
    signAndEditExecutable: false,
    forceCodeSigning: false,
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
  },
  nsis: {
    oneClick: false,
    guid: "com.imsyy.splayer-next",
    artifactName: "${productName}-${version}-${arch}-setup.${ext}",
    shortcutName: "${productName}",
    uninstallDisplayName: "${productName}",
    createDesktopShortcut: "always",
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
  },
  portable: {
    artifactName: "${productName}-${version}-${arch}-portable.${ext}",
  },
  mac: {
    executableName: "SPlayer-Next",
    artifactName: "${productName}-${version}-${arch}.${ext}",
    identity: null,
    hardenedRuntime: false,
    notarize: false,
    darkModeSupport: true,
    category: "public.app-category.music",
    entitlementsInherit: "build/entitlements.mac.plist",
    extendInfo: {
      NSCameraUsageDescription: "Application requests access to the device's camera.",
      NSMicrophoneUsageDescription: "Application requests access to the device's microphone.",
      NSDocumentsFolderUsageDescription:
        "Application requests access to the user's Documents folder.",
      NSDownloadsFolderUsageDescription:
        "Application requests access to the user's Downloads folder.",
    },
    target: [
      {
        target: "dmg",
        arch: ["x64", "arm64"],
      },
      {
        target: "zip",
        arch: ["x64", "arm64"],
      },
    ],
  },
  dmg: {
    artifactName: "${productName}-${version}-${arch}.${ext}",
  },
  linux: {
    executableName: "SPlayer-Next",
    artifactName: "${name}-${version}-${arch}.${ext}",
    maintainer: "imsyy.top",
    category: "Audio;Music;AudioVideo;",
    target: [
      {
        target: "AppImage",
        arch: ["x64", "arm64"],
      },
      {
        target: "deb",
        arch: ["x64", "arm64"],
      },
      {
        target: "rpm",
        arch: ["x64", "arm64"],
      },
      {
        target: "tar.gz",
        arch: ["x64", "arm64"],
      },
    ],
  },
  appImage: {
    artifactName: "${name}-${version}-${arch}.${ext}",
  },
  npmRebuild: false,
  electronDownload: {
    mirror: "https://npmmirror.com/mirrors/electron/",
  },
  publish: [],
};

export default config;
