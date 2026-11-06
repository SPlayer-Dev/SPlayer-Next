import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        format: "es",
        entryFileNames: "[name].mjs",
        chunkFileNames: "[name].mjs",
      },
    },
  },
});
