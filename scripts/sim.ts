/**
 * Headless soup — run this and come back later.
 *
 *   node scripts/sim.ts [w] [h] [epochs] [mutation] [steps] [mixed]
 *
 * mixed=1 gives the paper's 0-D "primordial soup" (any two programs can meet),
 * mixed=0 the 2-D lattice of §2.2.
 */
import { Soup } from "../src/engine/soup.ts";

const w = Number(process.argv[2] ?? 96);
const h = Number(process.argv[3] ?? 54);
const epochs = Number(process.argv[4] ?? 4000);
const mutation = Number(process.argv[5] ?? 0.00024);
const steps = Number(process.argv[6] ?? 8192);
const mixed = (process.argv[7] ?? "0") === "1";

const soup = new Soup({ w, h, mutation, steps, radius: 2, mixed, density: 0, seed: (Math.random() * 1e9) | 0 });
console.log(
  `${w}x${h} = ${soup.n} tapes · ${mixed ? "well-mixed" : "lattice"} · mutation ${(mutation * 100).toFixed(3)}% · ${steps} steps`,
);

const t0 = Date.now();
let ops = 0;
for (let e = 1; e <= epochs; e++) {
  soup.step();
  if (e % 100 === 0) {
    const s = soup.stats(1 << 13);
    ops = soup.totalOps;
    const dt = (Date.now() - t0) / 1000;
    console.log(
      `epoch ${String(e).padStart(6)}  lineage ${(s.top1 * 100).toFixed(1)}%  ` +
        `distinct ${String(s.distinct).padStart(6)}  entropy ${s.entropy.toFixed(3)}  ` +
        `code ${(s.code * 100).toFixed(1)}%  ${(e / dt).toFixed(0)} ep/s  ${(ops / dt / 1e6).toFixed(1)} Mops/s`,
    );
    if (s.top1 > 0.5) console.log(`>>> state transition around epoch ${e}`);
  }
}
