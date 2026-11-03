/**
 * The BFF parallel path must be the same simulation as the serial one.
 *
 * These are the regressions behind the P0 fixes:
 *   1. a worker `Soup` is attached to an existing shared buffer, never reset
 *   2. each epoch carries {epoch,seed,mutation,steps} to the workers
 *   3. the mutation tokens are a pure function of that state, so lineage does
 *      not depend on which thread ran the pair
 *
 * The "workers" here are independent `Soup` instances over one
 * SharedArrayBuffer, which is exactly what `worker.ts` does — the real Worker
 * messaging layer is a thin shell around this.
 */
import { Soup, type EpochParams } from "../src/engine/soup.ts";
import { BffSubstrate } from "../src/engine/bffsub.ts";

let fails = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) {
    fails++;
    console.error(`FAIL: ${name}`);
  }
};

const hash = (u: Uint8Array | Uint32Array): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 0x01000193);
  return h >>> 0;
};

const W = 48;
const H = 27;
const N = W * H;
const EPOCHS = 24;
const WORKERS = 3;
const base = {
  w: W,
  h: H,
  mutation: 1 / 2048,
  steps: 4096,
  radius: 2,
  mixed: false,
  density: 0.2,
  seed: 9001,
};

// ---------------------------------------------------------------- attach
{
  const state = new SharedArrayBuffer(Soup.bufferSize(N));
  const main = new Soup({ ...base, buffer: state });
  for (let e = 0; e < 5; e++) main.step();
  const before = `${hash(main.progs)}/${hash(main.toks)}`;

  // what worker.ts does on init: a view, not a new world
  const view = Soup.attach(state, base);
  check("attach leaves progs untouched", `${hash(main.progs)}/${hash(main.toks)}` === before);
  check("attach shares the buffer", view.buffer === state);

  // and it really is the same memory
  main.paint(0, new Uint8Array(64).fill(0x2b));
  check("attach aliases shared memory", view.cellBytes(0)[0] === 0x2b);
}

// ----------------------------------------------------- epoch / params
{
  const params: EpochParams = { epoch: 7, seed: 12345, mutation: 0.5, steps: 64 };
  const s = new Soup({ ...base, skipReset: true });
  s.setEpochParams(params);
  check("params: epoch", s.epoch === 7);
  check("params: seed", s.seed === 12345);
  check("params: mutation", s.mutation === 0.5);
  check("params: steps", s.steps === 64);

  // the epoch must actually participate in the mutation RNG: same seed and
  // same pair, different epoch => different mutation draws
  const mk = () => new Soup({ ...base, mutation: 0.5, steps: 0, skipReset: true });
  const a = mk();
  const b = mk();
  const c = mk();
  a.setEpochParams({ ...params, epoch: 0 });
  b.setEpochParams({ ...params, epoch: 0 });
  c.setEpochParams({ ...params, epoch: 7 });
  for (const s2 of [a, b, c]) s2.applyPair(0, 1, 0);
  check("same epoch is deterministic", hash(a.progs) === hash(b.progs) && hash(a.toks) === hash(b.toks));
  check("epoch changes the mutation draws", hash(a.toks) !== hash(c.toks));
}

// --------------------------------------------------- serial == workers
{
  const serial = new Soup({ ...base });
  const state = new SharedArrayBuffer(Soup.bufferSize(N));
  const main = new Soup({ ...base, buffer: state });
  const workers = Array.from({ length: WORKERS }, () => Soup.attach(state, base));

  for (let e = 0; e < EPOCHS; e++) {
    serial.step();

    const { pairs, leftover } = main.plan();
    const params = main.epochParams();
    let ops = 0;

    const pairSlots = pairs.length >> 1;
    const per = Math.ceil(pairSlots / WORKERS) * 2;
    for (let k = 0; k < WORKERS; k++) {
      const w = workers[k];
      w.setEpochParams(params);
      const from = k * per;
      const to = Math.min(pairs.length, from + per);
      if (from < to) ops += w.runPairs(pairs, from, to);
    }

    const perL = Math.ceil(leftover.length / WORKERS);
    for (let k = 0; k < WORKERS; k++) {
      const w = workers[k];
      w.setEpochParams(params);
      const from = k * perL;
      const to = Math.min(leftover.length, from + perL);
      for (let i = from; i < to; i++) w.mutateLeftover(leftover[i]);
    }

    main.finishEpoch(ops);
    if (e === 0) {
      check("first epoch matches serial", hash(main.progs) === hash(serial.progs));
    }
  }

  check(`progs match serial after ${EPOCHS} epochs`, hash(main.progs) === hash(serial.progs));
  check(`lineage tokens match serial after ${EPOCHS} epochs`, hash(main.toks) === hash(serial.toks));
  check("epoch counters agree", main.epoch === serial.epoch);
}

// --------------------------------------------------- live parameters
{
  const s = new Soup({ ...base });
  const sub = new BffSubstrate(s, null);
  sub.configure({ radius: 0 });
  check("radius 0 selects the well-mixed soup", s.mixed === true);
  sub.configure({ radius: 3 });
  check("radius 3 selects the lattice", s.mixed === false && s.radius === 3);
  sub.configure({ density: 0.25 });
  check("density is stored for the next reset", s.density === 0.25);
  sub.configure({ steps: 64 });
  check("steps applies live", s.steps === 64);
}

if (fails) {
  console.error(`epoch/parallel: ${fails} failure(s)`);
  process.exit(1);
}
console.log(
  `parallel slice == serial: ${EPOCHS} epochs, ${WORKERS} workers, progs + lineage tokens identical`,
);
