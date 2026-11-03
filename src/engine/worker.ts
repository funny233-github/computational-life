/// <reference lib="webworker" />
import { Soup, type EpochParams, type SoupOptions } from "./soup.ts";

let soup: Soup | null = null;
let pairs: Int32Array | null = null;
let leftover: Int32Array | null = null;
let index = 0;
let total = 1;

interface InitMsg {
  type: "init";
  opts: Omit<SoupOptions, "buffer">;
  state: SharedArrayBuffer;
  plan: SharedArrayBuffer;
  index: number;
  total: number;
}

interface EpochMsg {
  type: "epoch";
  np: number;
  nl: number;
  /** the authoritative epoch/seed/mutation/steps for this round */
  params: EpochParams;
}

self.onmessage = (e: MessageEvent<InitMsg | EpochMsg>) => {
  const m = e.data;
  if (m.type === "init") {
    // attach, never `new Soup`: the constructor resets, and every worker
    // resetting the shared buffer would erase the main thread's world.
    soup = Soup.attach(m.state, m.opts);
    pairs = new Int32Array(m.plan, 0, soup.n);
    leftover = new Int32Array(m.plan, soup.n * 4, soup.n);
    index = m.index;
    total = m.total;
    self.postMessage({ type: "ready" });
    return;
  }

  // The mutation RNG is seeded from (seed, epoch, pair), so a worker that
  // keeps its own epoch (always 0) would replay the same draws every round.
  soup!.setEpochParams(m.params);

  // slice of the pair list: pairs never overlap, so any split is safe
  const pairSlots = m.np >> 1;
  const from = Math.floor((index * pairSlots) / total) * 2;
  const to = Math.floor(((index + 1) * pairSlots) / total) * 2;
  let ops = 0;
  try {
    ops = soup!.runPairs(pairs!, from, to);
    const lfrom = Math.floor((index * m.nl) / total);
    const lto = Math.floor(((index + 1) * m.nl) / total);
    for (let i = lfrom; i < lto; i++) soup!.mutateLeftover(leftover![i]);
  } catch (err) {
    // silence would just look like a timeout to the pool
    self.postMessage({ type: "error", message: String(err) });
    return;
  }
  self.postMessage({ type: "done", ops });
};

export {};
