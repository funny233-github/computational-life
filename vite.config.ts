import fs from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Single self-contained index.html so the game runs from file:// (just open it).
/** inline module scripts are fine on file://, but a classic script is bullet-proof */
function classicScript(): Plugin {
  return {
    name: "classic-script",
    closeBundle() {
      const p = "dist/index.html";
      let html = fs
        .readFileSync(p, "utf8")
        .replace('<script type="module" crossorigin>', "<script>");
      // A classic script has no implicit `defer`, and Vite injects the entry
      // into <head> — so move it to the end of <body>, or getElementById()
      // runs before the DOM exists.
      const m = html.match(/<script>[\s\S]*?<\/script>/);
      if (m) {
        // NB: use function replacers — the bundle contains "$&", which would be
        // expanded as a replacement pattern and corrupt the script
        const tag = m[0];
        html = html.replace(tag, "").replace("</body>", () => tag + "</body>");
      }
      fs.writeFileSync(p, html);
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [viteSingleFile(), classicScript()],
  build: {
    target: "es2022",
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    // classic script (no ES module) so the single file also runs from file://
    rollupOptions: { output: { format: "iife", inlineDynamicImports: true } },
  },
});
