import type { ForgeConfig } from "@electron-forge/shared-types";
import { VitePlugin } from "@electron-forge/plugin-vite";

const config: ForgeConfig = {
  // better-sqlite3 使用 N-API 预编译文件，postinstall 已处理，无需 Forge 重编译
  rebuildConfig: { onlyModules: [] },
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
