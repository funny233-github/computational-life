/// <reference lib="webworker" />
import { Soup, type SoupOptions } from "./soup.ts";

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
}

self.onmessage = (e: MessageEvent<InitMsg | EpochMsg>) => {
  const m = e.data;
  if (m.type === "init") {
    soup = new Soup({ ...m.opts, buffer: m.state });
    pairs = new Int32Array(m.plan, 0, soup.n);
    leftover = new Int32Array(m.plan, soup.n * 4, soup.n);
    index = m.index;
    total = m.total;
    self.postMessage({ type: "ready" });
    return;
  }

  // slice of the pair list: pairs never overlap, so any split is safe
  const pairSlots = m.np >> 1;
  const from = Math.floor((index * pairSlots) / total) * 2;
  const to = Math.floor(((index + 1) * pairSlots) / total) * 2;
  let ops = soup!.runPairs(pairs!, from, to);

  const lfrom = Math.floor((index * m.nl) / total);
  const lto = Math.floor(((index + 1) * m.nl) / total);
  for (let i = lfrom; i < lto; i++) soup!.mutateLeftover(leftover![i]);

  self.postMessage({ type: "done", ops });
};
