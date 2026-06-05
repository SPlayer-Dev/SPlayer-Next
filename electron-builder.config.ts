import type { Configuration } from "electron-builder";

const config: Configuration = {
  appId: "com.imsyy.splayer-next",
  productName: "SPlayer Next",
  copyright: "Copyright © imsyy 2025",
  directories: { buildResources: "public" },
  // afterPack: "./scripts/after-pack.ts",
  compression: "maximum",
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
    "!**/*.{d.ts,map,md}",
    "!**/{CHANGELOG,LICENSE,license,README,readme}*",
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
      from: "native/media-ctrl",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/taskbar-lyric",
      to: "native",
      filter: ["*.node"],
    },
  ],
  win: {
    executableName: "SPlayer-Next",
    icon: "public/icons/logo.ico",
    artifactName: "${productName}-${version}-${arch}.${ext}",
    forceCodeSigning: false,
    target: ["nsis"],
  },
  nsis: {
    oneClick: false,
    guid: "com.imsyy.splayer-next",
    installerIcon: "public/icons/favicon.ico",
    uninstallerIcon: "public/icons/favicon.ico",
    artifactName: "${productName}-${version}-${arch}-setup.${ext}",
    shortcutName: "${productName}",
    uninstallDisplayName: "${productName}",
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
    target: ["AppImage", "deb", "rpm", "tar.gz"],
  },
  appImage: {
    artifactName: "${name}-${version}-${arch}.${ext}",
  },
  npmRebuild: false,
  electronDownload: {
    mirror: "https://npmmirror.com/mirrors/electron/",
  },
  publish: {
    provider: "github",
    owner: "SPlayer-Dev",
    repo: "SPlayer-Next",
  },
};

export default config;
