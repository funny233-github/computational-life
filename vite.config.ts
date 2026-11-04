import { defineConfig } from "vite";

// SharedArrayBuffer only exists in a cross-origin-isolated page. `npm run play`
// sends these from scripts/serve.mjs; dev and preview need them too, or the
// same build silently runs single-threaded depending on how it was started.
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export default defineConfig({
  // relative asset URLs, so dist/ can be served from any sub-path
  base: "./",
  server: { headers: isolation },
  preview: { headers: isolation },
  build: {
    target: "es2022",
    // the wasm is a real asset on purpose: it is bigger than the default
    // inline limit and a real file keeps the browser cache (and the devtools
    // network panel) honest
    assetsInlineLimit: 0,
  },
  worker: { format: "es" },
});
