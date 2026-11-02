import { defineConfig } from "vite";

export default defineConfig({
  // relative asset URLs, so dist/ can be served from any sub-path
  base: "./",
  build: {
    target: "es2022",
    // the wasm is a real asset on purpose: it is bigger than the default
    // inline limit and a real file keeps the browser cache (and the devtools
    // network panel) honest
    assetsInlineLimit: 0,
  },
  worker: { format: "es" },
});
