import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import Icons from "unplugin-icons/vite";
import AutoImport from "unplugin-auto-import/vite";
import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_REPO_URL__: JSON.stringify(pkg.repository.url),
    __APP_REPO_NAME__: JSON.stringify(pkg.productName),
    __APP_AUTHOR__: JSON.stringify(pkg.author.name),
    __APP_HOMEPAGE__: JSON.stringify(pkg.homepage),
    __APP_AUTHOR_URL__: JSON.stringify(pkg.author.url),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@main": fileURLToPath(new URL("./electron/main", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      "@windows": fileURLToPath(new URL("./windows", import.meta.url)),
      "@root": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  plugins: [
    vue(),
    Icons({ compiler: "vue3" }),
    AutoImport({
      imports: ["vue", "pinia", "vue-router", "@vueuse/core", "vue-i18n"],
    }),
  ],
  test: {
    environment: "happy-dom",
    include: [
      "electron/**/*.spec.ts",
      "src/**/*.spec.ts",
      "windows/**/*.spec.ts",
      "docs/**/*.spec.ts",
    ],
    clearMocks: true,
    restoreMocks: true,
  },
});
