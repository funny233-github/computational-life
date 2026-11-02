/** the view selector must change the output, and every view must be 1:1 */
import { Soup } from "../src/engine/soup.ts";
import { drawWindowBytes, drawWindowCells } from "../src/ui/canvas.ts";
import { BYTE_COLOR, cellColor } from "../src/ui/palette.ts";
import { BffSubstrate } from "../src/engine/bffsub.ts";

const soup = new Soup({ w: 24, h: 14, mutation: 0.001, steps: 512, radius: 2, mixed: false, density: 0, seed: 42 });
for (let i = 0; i < 40; i++) soup.step();

const sub = new BffSubstrate(soup, null);
const modes = ["content", "lineage", "code"] as const;
const OUT_W = 300;
const OUT_H = 200;

// 1. the three cell views must differ
const bufs = modes.map((m) => {
  const out = new Uint32Array(OUT_W * OUT_H);
  drawWindowCells(soup.w, soup.h, 8, 0, 0, OUT_W, OUT_H, (c) => cellColor(sub, c, m), 0xff000000, 0, 0, out);
  return out;
});
const distinct = new Set(bufs.map((b) => b.join())).size;
if (distinct !== 3) {
  console.error(`FAIL: the three cell views are not distinct (${distinct})`);
  process.exit(1);
}
console.log(`cell views: ${distinct} distinct renderings`);

// 2. bytes view: every byte must be exactly px x px device pixels
for (const px of [1, 2, 3, 5]) {
  const out = new Uint32Array(OUT_W * OUT_H);
  drawWindowBytes(soup.progs, soup.w, soup.h, 8, px, 0, 0, OUT_W, OUT_H, BYTE_COLOR, 0xff000000, false, 0, 0, out);
  let bad = 0;
  const cell = 8 * px;
  const cols = Math.floor(OUT_W / cell);
  const rows = Math.floor(OUT_H / cell);
  for (let cy = 0; cy < Math.min(rows, 3); cy++) {
   for (let cx = 0; cx < Math.min(cols, 8); cx++) {
    const c = cy * soup.w + cx;
    if (c >= soup.n) continue;
    const cellX = cx * cell;
    const cellY = cy * cell;
    for (let b = 0; b < 64; b++) {
      const want = BYTE_COLOR[soup.progs[c * 64 + b]];
      const x0 = cellX + (b % 8) * px;
      const y0 = cellY + ((b / 8) | 0) * px;
      for (let dy = 0; dy < px; dy++) {
        for (let dx = 0; dx < px; dx++) {
          if (out[(y0 + dy) * OUT_W + x0 + dx] !== want) bad++;
        }
      }
    }
   }
  }
  if (bad) {
    console.error(`FAIL: px=${px} produced ${bad} pixels that are not exact byte blocks`);
    process.exit(1);
  }
}
console.log("bytes view: every byte is exactly px x px device pixels (px = 1,2,3,5)");

// 3. panning by one cell shifts the image by exactly one cell
const a = new Uint32Array(OUT_W * OUT_H);
const b = new Uint32Array(OUT_W * OUT_H);
const px = 4;
const cell = 8 * px;
drawWindowBytes(soup.progs, soup.w, soup.h, 8, px, 0, 0, OUT_W, OUT_H, BYTE_COLOR, 0xff000000, false, 0, 0, a);
drawWindowBytes(soup.progs, soup.w, soup.h, 8, px, 1, 0, OUT_W, OUT_H, BYTE_COLOR, 0xff000000, false, 0, 0, b);
let moved = 0;
for (let y = 0; y < OUT_H; y++) {
  for (let x = 0; x + cell < OUT_W; x++) if (a[y * OUT_W + x + cell] === b[y * OUT_W + x]) moved++;
}
const total = OUT_H * (OUT_W - cell);
if (moved / total < 0.98) {
  console.error(`FAIL: panning by one cell did not shift the image (${((moved / total) * 100).toFixed(1)}% match)`);
  process.exit(1);
}
console.log(`panning: one cell shifts the bitmap by exactly ${cell} px (${((moved / total) * 100).toFixed(1)}% match)`);
