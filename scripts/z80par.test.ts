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

// A big map plans 5000-8000 pairs per epoch, but the reference's write_count
// buffer is only half as big as memoryWrite() indexes it, so a single wasm run
// traps ("memory access out of bounds"). runPairs has to chunk, and chunking
// must not change the result — nor may it disagree with a 2-way split.
{
  const bigBase = { w: 192, h: 108, seed: 7, noise: 1 / 16, steps: Z80_STEPS };
  const bigSerial = new Z80World(await loadZ80(), bigBase);
  const bigPar = new Z80World(null, { ...bigBase, buffer: new SharedArrayBuffer(Z80World.bufferSize(bigBase.w * bigBase.h)) });
  const bigPlan = new Int32Array(8192 * 2);
  const cores = [await loadZ80(), await loadZ80()];
  let maxPairs = 0;
  for (let e = 0; e < 6; e++) {
    bigSerial.step();
    const n = bigPar.planInto(bigPlan);
    maxPairs = Math.max(maxPairs, n);
    const half = Math.ceil(n / 2);
    runPairs(cores[0], bigPar.soup, bigPlan, 0, half, Z80_STEPS, bigPar.writes);
    runPairs(cores[1], bigPar.soup, bigPlan, half, n, Z80_STEPS, bigPar.writes);
    bigPar.finishEpoch(n);
  }
  let d = 0;
  for (let i = 0; i < bigSerial.soup.length; i++) if (bigSerial.soup[i] !== bigPar.soup[i]) d++;
  if (maxPairs <= 4096) {
    console.error(`FAIL: the big map only planned ${maxPairs} pairs, the chunking path was not exercised`);
    process.exit(1);
  }
  if (d !== 0) {
    console.error(`FAIL: big map split differs from serial in ${d} bytes`);
    process.exit(1);
  }
  console.log(`z80 big map (192x108, up to ${maxPairs} pairs/epoch) runs in chunks, joins cleanly`);
}
