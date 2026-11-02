import { NOP, NULL, OP, TAPE, evalTape } from "./bff.ts";

export interface SoupOptions {
  w: number;
  h: number;
  /** per-byte, per-epoch mutation probability (paper default 1/4096) */
  mutation: number;
  /** instruction budget per interaction (paper: 8192) */
  steps: number;
  /** interaction radius in cells (paper 2D: 2) */
  radius: number;
  /** well-mixed (0-D "primordial soup") instead of a 2D lattice */
  mixed: boolean;
  /** probability that a byte of the initial random world is a valid instruction
   *  (the paper's uniform prior gives 10/256 ≈ 0.039) */
  density: number;
  seed: number;
  /** optional SharedArrayBuffer backing store: lets several workers run one epoch */
  buffer?: SharedArrayBuffer | ArrayBuffer;
}

export interface Stats {
  epoch: number;
  top1: number;
  top32: number;
  unique: number;
  distinct: number;
  entropy: number;
  code: number;
  opsPerEpoch: number;
}

const TOKENS_AT = (n: number) => Math.ceil((n * TAPE) / 8) * 8;

/** mulberry32 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit mix, used to derive independent streams from (seed, epoch, index) */
function mix32(x: number): number {
  let h = x >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

function streamSeed(a: number, b: number, c: number): number {
  return mix32(mix32(a >>> 0) ^ Math.imul(b | 0, 0x9e3779b1) ^ Math.imul(c | 0, 0x85ebca77));
}

const INSTRUCTION_BYTES = [0x5b, 0x5d, 0x2b, 0x2d, 0x2e, 0x2c, 0x3c, 0x3e, 0x7b, 0x7d];
const IV = 24;

export interface Plan {
  /** flat [p,q,p,q,...] list of the pairs that will interact this epoch */
  pairs: Int32Array;
  /** cells that take part in no pair and only get a mutation pass */
  leftover: Int32Array;
}

/**
 * A 2D primordial soup (paper §2.2). One cell = one 64-byte tape.
 *
 * `step()` is split into `plan()` (decides who pairs with whom — depends only on
 * the seed and the epoch) and `applyPair()` (reads and writes exactly two cells,
 * so pairs never overlap and can be run in any order, on any thread).
 */
export class Soup {
  w: number;
  h: number;
  n: number;
  progs: Uint8Array;
  toks: Uint32Array;
  mutation: number;
  steps: number;
  radius: number;
  mixed: boolean;
  density: number;
  epoch = 0;
  seed = 0;
  totalOps = 0;

  readonly buffer: SharedArrayBuffer | ArrayBuffer | null;
  private tape = new Uint8Array(TAPE * 2);
  private ttape = new Uint32Array(TAPE * 2);
  private nextTok = 1;
  private cdfM = new Float64Array(IV);
  private cdfC = new Float64Array(IV);

  constructor(o: SoupOptions) {
    this.w = o.w;
    this.h = o.h;
    this.n = o.w * o.h;
    this.mutation = o.mutation;
    this.steps = o.steps;
    this.radius = o.radius;
    this.mixed = o.mixed;
    this.density = o.density;
    this.buffer = o.buffer ?? null;

    const bytes = this.n * TAPE;
    if (this.buffer) {
      this.progs = new Uint8Array(this.buffer, 0, bytes);
      this.toks = new Uint32Array(this.buffer, TOKENS_AT(this.n), this.n * TAPE);
    } else {
      this.progs = new Uint8Array(bytes);
      this.toks = new Uint32Array(this.n * TAPE);
    }
    this.buildCdfs();
    this.reset(o.seed);
  }

  static bufferSize(n: number): number {
    return TOKENS_AT(n) + n * TAPE * 4;
  }

  setMutation(r: number) {
    this.mutation = r;
    this.buildCdfs();
  }

  private buildCdfs() {
    const fill = (cdf: Float64Array, L: number, r: number) => {
      const rr = Math.min(Math.max(r, 0), 1);
      let c = 0;
      let p = Math.pow(1 - rr, L);
      for (let k = 0; k < IV; k++) {
        c = Math.min(1, c + p);
        cdf[k] = c;
        p = p * ((L - k) / (k + 1)) * (rr / Math.max(1e-12, 1 - rr));
        if (!isFinite(p)) p = 0;
      }
      cdf[IV - 1] = 1;
    };
    fill(this.cdfM, TAPE * 2, this.mutation);
    fill(this.cdfC, TAPE, this.mutation);
  }

  reset(seed = this.seed) {
    this.seed = seed;
    this.epoch = 0;
    this.totalOps = 0;
    this.nextTok = 1;
    const r = rng(seed);
    const p = this.progs;
    const t = this.toks;
    const d = this.density;
    for (let i = 0; i < this.n * TAPE; i++) {
      if (d <= 0 || d >= 1) p[i] = (r() * 256) | 0;
      else if (r() < d) p[i] = INSTRUCTION_BYTES[(r() * 10) | 0];
      else p[i] = (r() * 256) | 0;
      t[i] = this.nextTok++;
    }
  }

  paint(cell: number, bytes: Uint8Array) {
    const off = cell * TAPE;
    for (let i = 0; i < TAPE; i++) {
      this.progs[off + i] = bytes[i] ?? 0;
      this.toks[off + i] = this.nextTok++;
    }
  }

  cellBytes(cell: number): Uint8Array {
    return this.progs.subarray(cell * TAPE, cell * TAPE + TAPE);
  }

  // ---------------------------------------------------------------- planning

  /** deterministic given (seed, epoch): identical on every thread */
  plan(): Plan {
    const pairs = new Int32Array(this.n);
    const leftover = new Int32Array(this.n);
    const { np, nl } = this.planInto(pairs, leftover);
    return { pairs: pairs.subarray(0, np), leftover: leftover.subarray(0, nl) };
  }

  /** write the epoch's plan into caller-owned arrays (they may live in shared memory) */
  planInto(pairs: Int32Array, leftoverOut: Int32Array): { np: number; nl: number } {
    const { n, w, h, radius, mixed } = this;
    const rand = rng(streamSeed(this.seed, this.epoch, 0x51ed));
    const order = new Int32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    for (let i = n - 1; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }

    const taken = new Uint8Array(n);
    let np = 0;

    if (mixed) {
      for (let i = 0; i + 1 < n; i += 2) {
        const p = order[i];
        const q = order[i + 1];
        taken[p] = 1;
        taken[q] = 1;
        pairs[np++] = p;
        pairs[np++] = q;
      }
    } else {
      for (let oi = 0; oi < n; oi++) {
        const p = order[oi];
        if (taken[p]) continue;
        const px = p % w;
        const py = (p / w) | 0;
        let q = -1;
        for (let tries = 0; tries < 6; tries++) {
          const dx = ((rand() * (2 * radius + 1)) | 0) - radius;
          const dy = ((rand() * (2 * radius + 1)) | 0) - radius;
          if (dx === 0 && dy === 0) continue;
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          q = ny * w + nx;
          break;
        }
        // on failure the reference leaves p untouched: it can still be picked
        // as somebody else's neighbour later in the same epoch
        if (q < 0 || q === p || taken[q]) continue;
        taken[p] = 1;
        taken[q] = 1;
        pairs[np++] = p;
        pairs[np++] = q;
      }
    }

    let nl = 0;
    for (let i = 0; i < n; i++) if (!taken[i]) leftoverOut[nl++] = i;

    return { np, nl };
  }

  // -------------------------------------------------------------- execution

  /** run one pair; touches only cells p and q, so pairs are independent */
  applyPair(p: number, q: number, pairIndex: number): number {
    const { progs, toks, tape, ttape } = this;
    const po = p * TAPE;
    const qo = q * TAPE;
    for (let i = 0; i < TAPE; i++) {
      tape[i] = progs[po + i];
      tape[i + TAPE] = progs[qo + i];
      ttape[i] = toks[po + i];
      ttape[i + TAPE] = toks[qo + i];
    }
    if (this.mutation > 0) {
      const r = rng(streamSeed(this.seed, this.epoch, pairIndex * 2 + 0x1000));
      const k = this.mutCount(this.cdfM, r);
      for (let i = 0; i < k; i++) {
        const j = (r() * (TAPE * 2)) | 0;
        tape[j] = (r() * 256) | 0;
        ttape[j] = this.nextTok++;
      }
    }
    const ops = evalTape(tape, this.steps, ttape);
    for (let i = 0; i < TAPE; i++) {
      progs[po + i] = tape[i];
      progs[qo + i] = tape[i + TAPE];
      toks[po + i] = ttape[i];
      toks[qo + i] = ttape[i + TAPE];
    }
    return ops;
  }

  mutateLeftover(cell: number) {
    if (this.mutation <= 0) return;
    const r = rng(streamSeed(this.seed, this.epoch, cell * 2 + 0x2000));
    const k = this.mutCount(this.cdfC, r);
    const { progs, toks } = this;
    const off = cell * TAPE;
    for (let i = 0; i < k; i++) {
      const j = (r() * TAPE) | 0;
      progs[off + j] = (r() * 256) | 0;
      toks[off + j] = this.nextTok++;
    }
  }

  private mutCount(cdf: Float64Array, r: () => number): number {
    const u = r();
    for (let k = 0; k < IV; k++) if (u < cdf[k]) return k;
    return IV - 1;
  }

  /** run a slice of the pair list — the unit of work handed to a worker */
  runPairs(pairs: Int32Array, from: number, to: number): number {
    let ops = 0;
    for (let i = from; i < to; i += 2) ops += this.applyPair(pairs[i], pairs[i + 1], i >> 1);
    return ops;
  }

  finishEpoch(ops: number) {
    this.totalOps += ops;
    this.epoch++;
  }

  /** serial epoch (also the reference for the parallel path) */
  step() {
    const { pairs, leftover } = this.plan();
    const ops = this.runPairs(pairs, 0, pairs.length);
    for (let i = 0; i < leftover.length; i++) this.mutateLeftover(leftover[i]);
    this.finishEpoch(ops);
  }

  // ----------------------------------------------------------------- metrics

  stats(samples = 1 << 14): Stats {
    const { n, progs, toks } = this;
    const rand = rng(streamSeed(this.seed, this.epoch, 0x574a7));
    const tokenHist = new Map<number, number>();
    const hashSeen = new Set<number>();
    const byteHist = new Uint32Array(256);
    let code = 0;
    const total = Math.min(samples, n);

    for (let s = 0; s < total; s++) {
      const cell = (rand() * n) | 0;
      const off = cell * TAPE;
      const tk = toks[off];
      tokenHist.set(tk, (tokenHist.get(tk) ?? 0) + 1);
      let hsh = 0x811c9dc5;
      for (let i = 0; i < TAPE; i++) {
        const b = progs[off + i];
        hsh = Math.imul(hsh ^ b, 0x01000193) >>> 0;
        byteHist[b]++;
        const op = OP[b];
        if (op !== NOP && op !== NULL) code++;
      }
      hashSeen.add(hsh);
    }

    const counts = Array.from(tokenHist.values()).sort((a, b) => b - a);
    const top1 = (counts[0] ?? 0) / total;
    let s32 = 0;
    for (let i = 0; i < Math.min(32, counts.length); i++) s32 += counts[i];

    let ent = 0;
    const bytes = total * TAPE;
    for (let i = 0; i < 256; i++) {
      if (!byteHist[i]) continue;
      const pr = byteHist[i] / bytes;
      ent -= pr * Math.log2(pr);
    }

    return {
      epoch: this.epoch,
      top1,
      top32: s32 / total,
      unique: tokenHist.size,
      distinct: hashSeen.size,
      entropy: ent,
      code: code / bytes,
      opsPerEpoch: this.totalOps,
    };
  }
}
