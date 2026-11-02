/**
 * The engine/frontend boundary must actually hold:
 *   engine/  knows nothing about the DOM or about colours
 *   ui/      reaches the engine only through its public surface
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../src/", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(root, p), "utf8");
const files = (dir: string) =>
  readdirSync(join(root, dir))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `${dir}/${f}`);

const engine = files("engine");
const ui = files("ui").concat(["main.ts"]);
let bad = 0;

// 1. the engine never touches the DOM, and never imports the ui
for (const f of engine) {
  const src = read(f);
  for (const forbidden of [/\bdocument\./, /\bwindow\./, /HTMLCanvasElement/, /CanvasRenderingContext2D/, /createImageData/]) {
    if (forbidden.test(src)) {
      console.error(`FAIL: ${f} touches the DOM (${forbidden})`);
      bad++;
    }
  }
  if (/from "\.\.\/ui\//.test(src)) {
    console.error(`FAIL: ${f} imports the frontend`);
    bad++;
  }
}

// 2. the ui only sees engine/index.ts and engine/factory.ts
const allowed = /^\.\.\/engine\/(index|factory|substrate)\.ts$/;
for (const f of ui) {
  const src = read(f);
  for (const m of src.matchAll(/from "(\.\.\/engine\/[^"]+)"/g)) {
    if (!allowed.test(m[1])) {
      console.error(`FAIL: ${f} reaches into the engine internals (${m[1]})`);
      bad++;
    }
  }
}

// 3. nothing in the ui implements the simulation
for (const f of ui) {
  const src = read(f);
  for (const forbidden of [/evalTape/, /class Exec/, /WebAssembly/, /loadZ80/]) {
    if (forbidden.test(src)) {
      console.error(`FAIL: ${f} contains simulation logic (${forbidden})`);
      bad++;
    }
  }
}

if (bad) {
  console.error(`FAIL: ${bad} layering violation(s)`);
  process.exit(1);
}
console.log(
  `layers: ${engine.length} engine modules are DOM-free, ${ui.length} ui modules use only the public engine surface`,
);
