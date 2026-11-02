/**
 * The parallel path must be byte-identical to the serial one.
 * Pairs never overlap, so splitting the pair list across "workers" is safe —
 * this test proves it, using a SharedArrayBuffer as the shared state.
 */
import { Soup } from "../src/engine/soup.ts";

const W = 48;
const H = 27;
const N = W * H;

function hash(s: Soup): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.progs.length; i++) h = Math.imul(h ^ s.progs[i], 0x01000193);
  for (let i = 0; i < s.toks.length; i++) h = Math.imul(h ^ s.toks[i], 0x01000193);
  return h >>> 0;
}

function make(workers: number) {
  const buf = workers > 1 ? new SharedArrayBuffer(Soup.bufferSize(N)) : undefined;
  return new Soup({
    w: W, h: H, mutation: 1 / 4096, steps: 8192, radius: 2,
    mixed: false, density: 0.2, seed: 424242, buffer: buf,
  });
}

const EPOCHS = 40;
const WORKERS = 7;

// serial reference
const serial = make(1);
for (let e = 0; e < EPOCHS; e++) serial.step();
const want = hash(serial);
const wantTop = serial.stats(4096).top1;

// same thing, pair list chopped into WORKERS slices
const parallel = make(WORKERS);
for (let e = 0; e < EPOCHS; e++) {
  const { pairs, leftover } = parallel.plan();
  const chunk = Math.ceil(pairs.length / 2 / WORKERS) * 2;
  let ops = 0;
  for (let k = 0; k < WORKERS; k++) {
    const from = k * chunk;
    const to = Math.min(pairs.length, from + chunk);
    if (from < to) ops += parallel.runPairs(pairs, from, to);
  }
  for (let i = 0; i < leftover.length; i++) parallel.mutateLeftover(leftover[i]);
  parallel.finishEpoch(ops);
}

const got = hash(parallel);
if (got !== want) {
  console.error(`FAIL: parallel state ${got} != serial ${want}`);
  process.exit(1);
}
console.log(`parallel(${WORKERS} slices) == serial over ${EPOCHS} epochs  [${want.toString(16)}]`);

// and the run must be reproducible from the seed alone
const again = make(1);
for (let e = 0; e < EPOCHS; e++) again.step();
if (hash(again) !== want) { console.error("FAIL: not deterministic across runs"); process.exit(1); }
console.log(`deterministic: two independent runs agree (top1 ${(wantTop * 100).toFixed(2)}%)`);
