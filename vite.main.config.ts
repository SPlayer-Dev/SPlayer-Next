import { resolve } from "path";
import { defineConfig, type ConfigEnv, type LibraryOptions } from "vite";
import { NATIVE_DEPENDENCIES } from "./scripts/forge/hooks";

/** Forge 传入的构建目标，入口统一定义在 forge.config.ts */
type ForgeEnv = ConfigEnv & { forgeConfigSelf: { entry: LibraryOptions["entry"] } };

export default defineConfig((env) => ({
  resolve: {
    alias: {
      "@main": resolve(__dirname, "electron/main"),
      "@shared": resolve(__dirname, "shared"),
      "@splayer/audio-engine": resolve(__dirname, "native/audio-engine"),
      "@splayer/audio-capture": resolve(__dirname, "native/audio-capture"),
      "@splayer/media-ctrl": resolve(__dirname, "native/media-ctrl"),
      "@splayer/taskbar-lyric": resolve(__dirname, "native/taskbar-lyric"),
      "@splayer/taskbar-thumbnail": resolve(__dirname, "native/taskbar-thumbnail"),
      "@splayer/opencc": resolve(__dirname, "native/opencc"),
    },
  },
  build: {
    lib: {
      entry: (env as ForgeEnv).forgeConfigSelf.entry,
      formats: ["es"],
      fileName: (_format, name) => `${name}.js`,
    },
    // 与 Forge 默认的 rollupOptions 合并，external 数组会拼接
    rollupOptions: {
      platform: "node",
      external: [...NATIVE_DEPENDENCIES],
      output: { chunkFileNames: "[name]-[hash].js" },
    },
  },
}));
