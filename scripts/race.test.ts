/**
 * User writes (reset / paint) must never land in the middle of an epoch.
 *
 * `step()` awaits the worker pool, so without a queue a click handler can write
 * the shared soup while workers are still applying pairs: the write is either
 * overwritten or a tape is torn in half. The substrate now serialises
 * step/reset/paint through one promise chain; this test uses a fake pool whose
 * epoch we can hold open, which is the only deterministic way to observe it.
 */
import { Soup } from "../src/engine/soup.ts";
import { BffSubstrate } from "../src/engine/bffsub.ts";
import type { PairPool } from "../src/engine/substrate.ts";

let fails = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) {
    fails++;
    console.error(`FAIL: ${name}`);
  }
};
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const soup = new Soup({ w: 8, h: 8, mutation: 0, steps: 64, radius: 2, mixed: false, density: 0, seed: 5 });

let resolveStep: ((ok: boolean) => void) | null = null;
let entered = false;
const fake: PairPool = {
  info: { cores: 2, parallel: true, reason: "fake pool" },
  ready: true,
  degraded: false,
  step() {
    entered = true;
    return new Promise<boolean>((r) => {
      resolveStep = r;
    });
  },
  setThreads: () => "fake",
  dispose() {},
};

const sub = new BffSubstrate(soup, fake);
resolveStep = null;

// ------------------------------------------------------- paint is queued
{
  const stepP = sub.step();
  await tick();
  check("the fake epoch really is in flight", entered && resolveStep !== null);

  const before = soup.cellBytes(0)[0];
  const paintP = sub.paint(0, new Uint8Array(64).fill(0x2b));
  await tick();
  await tick();
  check("paint does not apply mid-epoch", soup.cellBytes(0)[0] === before);

  resolveStep!(true);
  await stepP;
  await paintP;
  check("paint applies once the epoch is done", soup.cellBytes(0)[0] === 0x2b);
}

// ------------------------------------------------------- reset is queued
{
  entered = false;
  resolveStep = null;
  const stepP = sub.step();
  await tick();
  check("second fake epoch in flight", entered && resolveStep !== null);

  const resetP = sub.reset(777);
  await tick();
  check("reset does not apply mid-epoch", soup.seed !== 777);

  resolveStep!(true);
  await stepP;
  await resetP;
  check("reset applies after the epoch", soup.seed === 777 && soup.epoch === 0);
}

// ------------------------------------------------- thread control is not a dead end
{
  const spawned: number[] = [];
  let fake2Disposed = 0;
  const fake2: PairPool = {
    info: { cores: 2, parallel: true, reason: "fake pool 2" },
    ready: true,
    degraded: false,
    step: async () => true,
    setThreads: () => "fake",
    dispose() {
      fake2Disposed++;
    },
  };
  const sub2 = new BffSubstrate(soup, null, (n) => {
    spawned.push(n);
    return fake2;
  });
  check("1 -> N spawns workers", sub2.setThreads(4).length > 0 && sub2.poolInfo().parallel === true);
  sub2.setThreads(1);
  await tick(); // the teardown is queued so it can drain an in-flight epoch
  check("N -> 1 drops to the serial path", sub2.poolInfo().parallel === false && fake2Disposed === 1);
  check("...and can go back up (spawn is not lost)", sub2.setThreads(3).length > 0 && spawned.includes(3));
}

// ------------------------------------- downgrade drains the epoch first
{
  const soup3 = new Soup({ w: 8, h: 8, mutation: 0, steps: 64, radius: 2, mixed: false, density: 0, seed: 6 });
  let release3: ((ok: boolean) => void) | null = null;
  let disposed3 = 0;
  const fake3: PairPool = {
    info: { cores: 2, parallel: true, reason: "fake pool 3" },
    ready: true,
    degraded: false,
    step() {
      return new Promise<boolean>((r) => {
        release3 = r;
      });
    },
    setThreads: () => "fake",
    dispose() {
      disposed3++;
    },
  };
  const sub3 = new BffSubstrate(soup3, fake3, () => fake3);
  const stepP = sub3.step();
  await tick();
  check("third fake epoch in flight", release3 !== null);
  sub3.setThreads(1);
  await tick();
  check("downgrade waits for the in-flight epoch", disposed3 === 0);
  release3!(true);
  await stepP;
  await tick();
  check("downgrade disposes once the epoch is done", disposed3 === 1 && sub3.poolInfo().parallel === false);
}

if (fails) {
  console.error(`race/serialisation: ${fails} failure(s)`);
  process.exit(1);
}
console.log("step/reset/paint are serialised; thread control is not a one-way door");
