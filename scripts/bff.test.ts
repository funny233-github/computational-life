/**
 * 1. evalTape (the soup's fast path) and Exec (the lab's single-stepper) must
 *    agree exactly — they are two implementations of the same interpreter.
 * 2. the hand-written replicator must still replicate.
 */
import { Exec, PAIR, TAPE, encode, evalTape } from "../src/engine/bff.ts";
import { REPLICATOR } from "../src/engine/programs.ts";
import { Soup } from "../src/engine/soup.ts";

let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

const INSTR = [0x5b, 0x5d, 0x2b, 0x2d, 0x2e, 0x2c, 0x3c, 0x3e, 0x7b, 0x7d];

let bad = 0;
for (let trial = 0; trial < 400; trial++) {
  const density = [0.04, 0.2, 0.5, 0.9][trial % 4];
  const tape = new Uint8Array(PAIR);
  for (let i = 0; i < PAIR; i++) {
    tape[i] = rnd() < density ? INSTR[(rnd() * 10) | 0] : (rnd() * 256) | 0;
  }
  const a = tape.slice();
  const b = tape.slice();
  const ops = evalTape(a, 512, new Uint32Array(PAIR));

  const ex = new Exec(b);
  let steps = 0;
  while (steps < 512 && ex.step()) steps++;

  const same = a.every((v, i) => v === b[i]);
  if (!same || ex.executed !== ops) {
    bad++;
    if (bad === 1) {
      console.error(`mismatch at trial ${trial}: ops ${ops} vs ${ex.executed}, tape equal ${same}`);
      for (let i = 0; i < PAIR; i++) if (a[i] !== b[i]) console.error(`  first diff at ${i}: ${a[i]} vs ${b[i]}`);
    }
  }
}
if (bad) { console.error(`FAIL: ${bad}/400 tapes diverge between evalTape and Exec`); process.exit(1); }
console.log("evalTape and Exec agree on 400 random tapes");

// the replicator: seed a nucleus into a small lattice, expect it to take over
const A = encode(REPLICATOR);
const soup = new Soup({ w: 32, h: 18, mutation: 1 / 4096, steps: 8192, radius: 2, mixed: false, density: 0, seed: 7 });
const cx = 16;
const cy = 9;
for (let dy = -2; dy <= 2; dy++) {
  for (let dx = -2; dx <= 2; dx++) soup.paint((cy + dy) * 32 + (cx + dx), A);
}
let top1 = 0;
for (let e = 0; e < 400; e++) {
  soup.step();
  if (e % 20 === 19) top1 = soup.stats(512).top1;
}
if (!(top1 > 0.1)) { console.error(`FAIL: replicator did not spread (top1=${top1.toFixed(3)})`); process.exit(1); }
console.log(`replicator spread to ${(top1 * 100).toFixed(0)}% of the soup in 400 epochs`);
