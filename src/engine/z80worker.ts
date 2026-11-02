/// <reference lib="webworker" />
import { loadZ80, type Z80Core } from "./z80core.ts";
import { runPairs } from "./z80soup.ts";

let core: Z80Core | null = null;
let soup: Uint8Array | null = null;
let idx: Int32Array | null = null;
let writes: Int32Array | null = null;
let steps = 128;
/** the wasm compile is async; queue epochs behind it instead of dropping them */
let ready: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent) => {
  const d = e.data as Record<string, unknown>;
  if (d.type === "init") {
    ready = (async () => {
      try {
        core = await loadZ80();
      } catch (err) {
        self.postMessage({ type: "error", message: String(err) });
        return;
      }
      soup = new Uint8Array(d.state as SharedArrayBuffer);
      idx = new Int32Array(d.plan as SharedArrayBuffer);
      writes = d.writes ? new Int32Array(d.writes as SharedArrayBuffer) : null;
      steps = d.steps as number;
      self.postMessage({ type: "ready" });
    })();
    return;
  }
  if (d.type === "epoch") {
    const p0 = d.p0 as number;
    const p1 = d.p1 as number;
    if (d.steps) steps = d.steps as number;
    void ready.then(() => {
      if (core && soup && idx) runPairs(core, soup, idx, p0, p1, steps, writes);
      self.postMessage({ type: "done", p0, p1 });
    });
  }
};

export {};
