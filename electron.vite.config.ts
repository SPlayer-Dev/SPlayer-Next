import { resolve } from "path";
import { defineConfig } from "electron-vite";
import UnoCSS from "unocss/vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Icons from "unplugin-icons/vite";
import IconsResolver from "unplugin-icons/resolver";
import { FileSystemIconLoader } from "unplugin-icons/loaders";
import RekaResolver from "reka-ui/resolver";
import Components from "unplugin-vue-components/vite";

export default defineConfig({
  main: {
    publicDir: resolve(__dirname, "public"),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "electron/main/index.ts"),
          // 插件沙箱 worker（utilityProcess 入口）
          "sandbox.worker": resolve(__dirname, "electron/main/plugins/sandbox.worker.ts"),
        },
        // Netease API 包内部用 fs.readdirSync 动态加载 module/*.js，
        // 无法被 rollup 打包，必须标记为外部依赖由 node_modules 运行时解析
        external: ["@neteasecloudmusicapienhanced/api"],
      },
    },
    resolve: {
      alias: {
        "@main": resolve(__dirname, "electron/main"),
        "@shared": resolve(__dirname, "shared"),
        "@splayer/audio-engine": resolve(__dirname, "native/audio-engine"),
        "@splayer/media-ctrl": resolve(__dirname, "native/media-ctrl"),
        "@splayer/taskbar-lyric": resolve(__dirname, "native/taskbar-lyric"),
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "electron/preload/index.ts"),
        },
      },
    },
  },
  renderer: {
    root: ".",
    server: {
      port: 14558,
      watch: {
        ignored: ["**/native/**/target/**"],
      },
    },
    publicDir: resolve(__dirname, "public"),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "index.html"),
          "desktop-lyric": resolve(__dirname, "windows/desktop-lyric/index.html"),
          "dynamic-island": resolve(__dirname, "windows/dynamic-island/index.html"),
          "taskbar-lyric": resolve(__dirname, "windows/taskbar-lyric/index.html"),
        },
      },
    },
    resolve: {
      alias: {
        "@": resolve("src"),
        "@shared": resolve(__dirname, "shared"),
        "@windows": resolve(__dirname, "windows"),
      },
    },
    plugins: [
      vue(),
      UnoCSS(),
      AutoImport({
        imports: ["vue", "pinia", "vue-router", "@vueuse/core", "vue-i18n"],
        eslintrc: {
          enabled: true,
          filepath: "./auto-eslint.mjs",
        },
      }),
      Icons({
        compiler: "vue3",
        scale: 1,
        customCollections: {
          sp: FileSystemIconLoader("./src/assets/icons"),
        },
      }),
      Components({
        dirs: ["src/components", "src/layouts/components"],
        resolvers: [RekaResolver(), IconsResolver({ prefix: "icon", customCollections: ["sp"] })],
      }),
    ],
  },
});
