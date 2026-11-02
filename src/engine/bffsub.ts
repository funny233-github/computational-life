import { BYTE_CLASS, Exec, NOP, OP, OP_CHAR, TAPE, decode, encode } from "./bff.ts";
import { REPLICATOR } from "./programs.ts";
import type { Block, CellMode, ChartPoint, Listing, Microscope, PoolInfo, Stat, Substrate } from "./substrate.ts";
import type { Pool } from "./pool.ts";
import type { Soup } from "./soup.ts";

class TapeMicroscope implements Microscope {
  private a: Uint8Array;
  private b: Uint8Array;
  tape = new Uint8Array(TAPE * 2);
  pc = 0;
  h0 = 0;
  h1 = 0;
  private ex: Exec | null = null;
  private swapped = false;

  constructor(a: Uint8Array, b: Uint8Array) {
    this.a = a;
    this.b = b;
    this.rebuild();
  }
  private rebuild() {
    const t = new Uint8Array(TAPE * 2);
    if (this.swapped) {
      t.set(this.b, 0);
      t.set(this.a, TAPE);
    } else {
      t.set(this.a, 0);
      t.set(this.b, TAPE);
    }
    this.tape = t;
    this.ex = new Exec(t);
    this.sync();
  }
  private sync() {
    const e = this.ex!;
    this.pc = e.pc;
    this.h0 = e.h0;
    this.h1 = e.h1;
  }
  step() {
    if (!this.ex) return;
    if (this.ex.halted) this.ex = new Exec(this.tape);
    this.ex.step();
    this.sync();
  }
  swap() {
    this.swapped = !this.swapped;
    this.rebuild();
  }
}

export class BffSubstrate implements Substrate {
  readonly kind = "bff" as const;
  readonly side = 8;
  readonly w: number;
  readonly h: number;
  readonly n: number;
  private soup: Soup;
  private pool: Pool | null;
  private spawn: ((n: number) => Pool | null) | null;

  constructor(soup: Soup, pool: Pool | null, spawn: ((n: number) => Pool | null) | null = null) {
    this.soup = soup;
    this.pool = pool;
    this.spawn = spawn;
    this.w = soup.w;
    this.h = soup.h;
    this.n = soup.n;
  }
  get epoch() {
    return this.soup.epoch;
  }
  get sync() {
    // until the workers are up we simply do the work here
    return this.pool === null || !this.pool.ready;
  }
  async step() {
    if (!this.pool || !this.pool.ready) {
      this.soup.step();
      return true;
    }
    const pool = this.pool;
    const ok = await pool.step();
    // `false` means "this epoch was dropped": either the pool is dead
    // (degraded) or the worker set was replaced mid-epoch. Only the first case
    // may cost us the pool — the second one just restarted it.
    if (!ok && this.pool === pool && pool.degraded) this.pool = null;
    return ok;
  }
  stepSync() {
    this.soup.step();
  }
  reset(seed?: number) {
    this.soup.reset(seed);
  }
  bytes() {
    return this.soup.progs;
  }
  cellBytes(c: number) {
    return this.soup.cellBytes(c);
  }
  paint(c: number, b: Uint8Array) {
    this.soup.paint(c, b);
  }
  dispose() {
    this.pool?.dispose();
    this.pool = null;
  }
  poolInfo(): PoolInfo {
    return this.pool?.info ?? { cores: 1, parallel: false, reason: "单线程" };
  }
  setThreads(n: number): string {
    if (n <= 1) {
      this.pool?.dispose();
      this.pool = null;
      return "单线程（配对在主线程上跑）";
    }
    if (this.pool) return this.pool.setThreads(n);
    if (!this.spawn) return "这个页面拿不到 SharedArrayBuffer，只能用单线程";
    try {
      const p = this.spawn(n);
      if (!p) return "这个页面拿不到 SharedArrayBuffer，只能用单线程";
      this.pool = p;
      return p.info.reason;
    } catch (e) {
      return "并行启动失败：" + (e as Error).message;
    }
  }
  configure(o: { noise?: number; steps?: number }) {
    if (o.noise !== undefined) this.soup.setMutation(o.noise);
    if (o.steps !== undefined) this.soup.steps = o.steps;
  }

  stats(): Stat[] {
    const s = this.soup.stats(4096);
    return [
      { label: "血统", value: (s.top1 * 100).toFixed(1) + "%", hint: "最大血统占比" },
      { label: "多样性", value: String(s.distinct), hint: "不同的程序数" },
      { label: "熵", value: s.entropy.toFixed(2), hint: "比特 / 字节" },
      { label: "指令", value: (s.code * 100).toFixed(1) + "%", hint: "指令字节占比" },
    ];
  }
  chart(): ChartPoint {
    const s = this.soup.stats(4096);
    return { primary: s.top1, secondary: Math.min(1, s.distinct / Math.max(1, this.n)) };
  }
  chartLabels(): [string, string] {
    return ["血统占比", "多样性"];
  }

  listing(c: number): Listing[] {
    const b = this.cellBytes(c);
    return [{ offset: 0, value: 0, text: decode(b.subarray(0, TAPE)) }];
  }

  blocks(c: number): Block[] {
    const b = this.cellBytes(c);
    const out: Block[] = [];
    for (let i = 0; i < TAPE; i++) out.push({ start: i, len: 1, short: OP_SHORT[b[i]] });
    return out;
  }

  cellKey(c: number, mode: CellMode): number {
    const off = c * TAPE;
    if (mode === "lineage") {
      return (Math.imul(this.soup.toks[off], 2654435761) >>> 26) & 0x3f;
    }
    if (mode === "content") {
      let h = 0x811c9dc5;
      for (let i = 0; i < TAPE; i++) h = Math.imul(h ^ this.soup.progs[off + i], 0x01000193);
      return (h >>> 24) & 0xff;
    }
    const counts = new Uint8Array(5);
    for (let i = 0; i < TAPE; i++) counts[BYTE_CLASS[this.soup.progs[off + i]]]++;
    let best = 1;
    for (let k = 2; k < 5; k++) if (counts[k] > counts[best]) best = k;
    return best;
  }

  preset(): Uint8Array {
    return encode(REPLICATOR);
  }

  microscope(c: number): Microscope {
    const a = this.cellBytes(c);
    const b = this.cellBytes((c + 1) % this.n);
    return new TapeMicroscope(a, b);
  }
}

/** single-character rendering of the BFF instruction set */
const OP_SHORT: string[] = new Array(256).fill("·");
for (let i = 0; i < 256; i++) {
  const op = OP[i];
  OP_SHORT[i] = op === NOP ? "·" : (OP_CHAR[op] ?? "·");
}
