/**
 * Rough performance profile of the hot paths. Not a pass/fail test: numbers
 * move with the machine, so this is for comparing two commits on one box.
 *
 *   npm run bench
 *
 * The 240×135 case is the paper-sized soup; 96×54 is the default.
 */
import { Soup } from "../src/engine/soup.ts";
import { BffSubstrate } from "../src/engine/bffsub.ts";
import { drawWindowBytes, drawWindowCells } from "../src/ui/canvas.ts";
import { BYTE_COLOR } from "../src/ui/palette.ts";

const now = () => performance.now();
const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
const fmt = (xs: number[]) => `${median(xs).toFixed(2)} ms`;

const base = { mutation: 1 / 4096, steps: 8192, radius: 2, mixed: false, density: 0, seed: 12345 };

function benchSize(w: number, h: number) {
  console.log(`\n=== ${w}×${h} (${w * h} tapes) ===`);
  const soup = new Soup({ ...base, w, h });
  const sub = new BffSubstrate(soup, null);
  const n = soup.n;

  // warm the JIT; the first epoch pays for compilation
  soup.step();
  soup.step();
  const steps: number[] = [];
  for (let e = 0; e < 8; e++) {
    const t = now();
    soup.step();
    steps.push(now() - t);
  }
  console.log(`step (serial):        ${fmt(steps)}`);

  const plans: number[] = [];
  for (let e = 0; e < 12; e++) {
    const t = now();
    soup.plan();
    plans.push(now() - t);
  }
  console.log(`plan:                 ${fmt(plans)}`);

  // stats() + chart() on a fresh epoch: the pair the panel actually calls
  const stats: number[] = [];
  for (let e = 0; e < 8; e++) {
    soup.step();
    const t = now();
    sub.stats();
    sub.chart();
    stats.push(now() - t);
  }
  console.log(`stats + chart:        ${fmt(stats)}`);

  const keys: number[] = [];
  for (let e = 0; e < 8; e++) {
    const t = now();
    let acc = 0;
    for (let c = 0; c < n; c++) acc += sub.cellKey(c, "code");
    keys.push(now() - t);
    if (acc === 0) throw new Error("unreachable");
  }
  console.log(`cellKey (all cells):  ${fmt(keys)}`);

  const sw = w * 8;
  const sh = h * 8;
  const bytes = new Uint32Array(sw * sh);
  const rasterBytes: number[] = [];
  for (let e = 0; e < 8; e++) {
    const t = now();
    drawWindowBytes(soup.progs, w, h, 8, 1, 0, 0, sw, sh, BYTE_COLOR, 0xff1d1c1a, false, 0, 0, bytes);
    rasterBytes.push(now() - t);
  }
  console.log(`raster bytes:         ${fmt(rasterBytes)}  (${sw}×${sh} = ${((sw * sh) / 1e6).toFixed(2)} MP)`);

  const cells = new Uint32Array(n);
  const rasterCells: number[] = [];
  for (let e = 0; e < 8; e++) {
    const t = now();
    drawWindowCells(w, h, 1, 0, 0, w, h, (c) => sub.cellKey(c, "code"), 0xff1d1c1a, 0, 0, cells);
    rasterCells.push(now() - t);
  }
  console.log(`raster cells (code):  ${fmt(rasterCells)}`);

  // how evenly the current fixed slices split the epoch (why work stealing
  // is or is not worth it)
  const cores = 8;
  const ratios: number[] = [];
  for (let e = 0; e < 3; e++) {
    const { pairs } = soup.plan();
    const slots = pairs.length / 2;
    const times: number[] = [];
    for (let k = 0; k < cores; k++) {
      const from = Math.floor((k * slots) / cores) * 2;
      const to = Math.floor(((k + 1) * slots) / cores) * 2;
      const t = now();
      soup.runPairs(pairs, from, to);
      times.push(now() - t);
    }
    const mean = times.reduce((a, b) => a + b, 0) / cores;
    ratios.push(Math.max(...times) / mean);
  }
  console.log(`fixed-slice imbalance: ${median(ratios).toFixed(2)}× (max / mean)`);
}

benchSize(96, 54);
benchSize(240, 135);
