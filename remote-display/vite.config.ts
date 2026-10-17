import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const fromCore = createRequire(require.resolve("@applemusic-like-lyrics/core"));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/display/",
  resolve: {
    alias: {
      "@ungap/structured-clone": fromCore.resolve("@ungap/structured-clone"),
      "bezier-easing": fromCore.resolve("bezier-easing"),
    },
  },
  build: { target: "es2022", sourcemap: true },
});
