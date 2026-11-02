/**
 * Splitting the Z80 pair plan across cores must give byte-identical results to
 * running it on one core: the plan and the mutation flips stay on the main
 * thread, so only the per-pair work is redistributed.
 */
import { loadZ80, Z80_STEPS } from "../src/engine/z80core.ts";
import { Z80World, runPairs } from "../src/engine/z80soup.ts";

const coreA = await loadZ80();
const coreB = await loadZ80();
const base = { w: 48, h: 27, seed: 99, noise: 1 / 16, steps: Z80_STEPS };

const serial = new Z80World(coreA, base);

const state = new SharedArrayBuffer(Z80World.bufferSize(base.w * base.h));
const writes = new SharedArrayBuffer(base.w * base.h * 4);
const par = new Z80World(null, { ...base, buffer: state, writesBuffer: writes });
const plan = new Int32Array(8192 * 2);

const EPOCHS = 40;
for (let e = 0; e < EPOCHS; e++) {
  serial.step();

  const pairN = par.planInto(plan);
  const half = Math.ceil(pairN / 2);
  runPairs(coreA, par.soup, plan, 0, half, Z80_STEPS, par.writes);
  runPairs(coreB, par.soup, plan, half, pairN, Z80_STEPS, par.writes);
  par.finishEpoch(pairN);
}

let diff = 0;
for (let i = 0; i < serial.soup.length; i++) if (serial.soup[i] !== par.soup[i]) diff++;

const crypto = await import("node:crypto");
const h = crypto.createHash("sha256").update(par.soup).digest("hex").slice(0, 8);

if (diff !== 0) {
  console.error(`FAIL: 2-core split differs from serial in ${diff}/${serial.soup.length} bytes`);
  process.exit(1);
}
if (serial.epoch !== par.epoch) {
  console.error(`FAIL: epoch drift (${serial.epoch} vs ${par.epoch})`);
  process.exit(1);
}
console.log(`z80 parallel(2 slices) == serial over ${EPOCHS} epochs  [${h}]`);

// a single slice must also equal the plain serial path
const solo = new Z80World(null, { ...base, buffer: new SharedArrayBuffer(state.byteLength) });
const coreC = await loadZ80();
const soloPlan = new Int32Array(8192 * 2);
const ref = new Z80World(await loadZ80(), base);
for (let e = 0; e < 5; e++) {
  ref.step();
  const n = solo.planInto(soloPlan);
  runPairs(coreC, solo.soup, soloPlan, 0, n, Z80_STEPS, solo.writes);
  solo.finishEpoch(n);
}
let d2 = 0;
for (let i = 0; i < ref.soup.length; i++) if (ref.soup[i] !== solo.soup[i]) d2++;
if (d2 !== 0) {
  console.error(`FAIL: one-slice path differs from serial in ${d2} bytes`);
  process.exit(1);
}
console.log("z80 one-slice path == serial");
