import { Z80_PAIR, Z80_STEPS, Z80_TAPE, type Z80Core } from "./z80core.ts";

export interface Z80Options {
  w: number;
  h: number;
  seed: number;
  /** mutated bytes per epoch, as a fraction of the number of pairs (ref: 1/16) */
  noise: number;
  steps: number;
  /** shared memory, so several workers can run pair slices at once */
  buffer?: SharedArrayBuffer;
  writesBuffer?: SharedArrayBuffer;
}

/**
 * Run the Z80 for one slice of the pair plan. Pairs never overlap, so workers
 * can write straight back into a shared soup without any locking.
 */
export function runPairs(
  core: Z80Core,
  soup: Uint8Array,
  idx: Int32Array,
  p0: number,
  p1: number,
  steps: number,
  writes: Int32Array | null,
) {
  // The reference's `write_count` buffer has MAX_BATCH_PAIR_N entries but
  // memoryWrite() indexes it as `pair_idx*2 + ...`, so only half of it is
  // usable; past that the wasm spills out of its data segment and traps with
  // "memory access out of bounds" (a big map plans 7000+ pairs per epoch).
  // Pairs are independent, so running them in chunks gives the same result.
  const cap = Math.max(1, Math.floor(core.writeCount.length / 2));
  for (let p = p0; p < p1; p += cap) {
    runChunk(core, soup, idx, p, Math.min(p1, p + cap), steps, writes);
  }
}

function runChunk(
  core: Z80Core,
  soup: Uint8Array,
  idx: Int32Array,
  p0: number,
  p1: number,
  steps: number,
  writes: Int32Array | null,
) {
  const n = p1 - p0;
  const batch = core.batch;
  for (let p = p0; p < p1; p++) {
    const a = idx[p * 2] * Z80_TAPE;
    const b = idx[p * 2 + 1] * Z80_TAPE;
    const o = (p - p0) * Z80_PAIR;
    for (let k = 0; k < Z80_TAPE; k++) {
      batch[o + k] = soup[a + k];
      batch[o + k + Z80_TAPE] = soup[b + k];
    }
  }
  core.run(n, steps);
  for (let p = p0; p < p1; p++) {
    const o = (p - p0) * Z80_PAIR;
    const ia = idx[p * 2];
    const ib = idx[p * 2 + 1];
    const a = ia * Z80_TAPE;
    const b = ib * Z80_TAPE;
    for (let k = 0; k < Z80_TAPE; k++) {
      soup[a + k] = batch[o + k];
      soup[b + k] = batch[o + k + Z80_TAPE];
    }
    if (writes) {
      writes[ia] = core.writeCount[(p - p0) * 2];
      writes[ib] = core.writeCount[(p - p0) * 2 + 1];
    }
  }
}

function splitmix(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
}

const MAX_PAIRS = 8192;

/**
 * The Z80 2D experiment (paper §3.3), ported from znah/zff's main.c:
 * 16-byte programs on a grid, adjacency-only pairing, 128 Z80 steps per
 * interaction against a 32-byte memory where every address is `& 31`.
 */
export class Z80World {
  readonly w: number;
  readonly h: number;
  readonly n: number;
  soup: Uint8Array;
  epoch = 0;
  seed: number;
  noise: number;
  steps: number;
  /** memory writes per program in the last epoch (reference: write_count) */
  writes: Int32Array;
  /** the shared buffers, when the world was built for multi-core */
  readonly state: SharedArrayBuffer | null;
  readonly writesBuffer: SharedArrayBuffer | null;

  private core: Z80Core | null;
  private rand: () => number;
  private idx: Int32Array = new Int32Array(MAX_PAIRS * 2);
  pairN = 0;

  constructor(core: Z80Core | null, o: Z80Options) {
    this.core = core;
    this.w = o.w;
    this.h = o.h;
    this.n = o.w * o.h;
    this.state = o.buffer ?? null;
    this.writesBuffer = o.writesBuffer ?? null;
    this.soup = o.buffer
      ? new Uint8Array(o.buffer, 0, this.n * Z80_TAPE)
      : new Uint8Array(this.n * Z80_TAPE);
    this.writes = o.writesBuffer ? new Int32Array(o.writesBuffer, 0, this.n) : new Int32Array(this.n);
    this.seed = o.seed;
    this.noise = o.noise;
    this.steps = o.steps;
    this.rand = splitmix(o.seed);
    this.reset(o.seed);
  }

  /** bytes needed for a soup of `n` programs */
  static bufferSize(n: number): number {
    return n * Z80_TAPE;
  }

  reset(seed = this.seed) {
    this.seed = seed;
    this.epoch = 0;
    this.rand = splitmix(seed);
    const r = this.rand;
    for (let i = 0; i < this.soup.length; i++) this.soup[i] = r() & 0xff;
  }

  cellBytes(cell: number): Uint8Array {
    return this.soup.subarray(cell * Z80_TAPE, cell * Z80_TAPE + Z80_TAPE);
  }

  paint(cell: number, bytes: Uint8Array) {
    const off = cell * Z80_TAPE;
    for (let i = 0; i < Z80_TAPE; i++) this.soup[off + i] = bytes[i] ?? 0;
  }

  /** the reference's prepare_batch(): random neighbour, never reusing a cell */
  planInto(idx: Int32Array): number {
    const { w, h, n, rand } = this;
    const mask = new Uint8Array(n);
    let pairN = 0;
    let collisions = 0;
    while (pairN < MAX_PAIRS && collisions < 16) {
      const i = rand() % n;
      let dir = (rand() & 1) * 2 - 1;
      const horizontal = (rand() & 1) === 1;
      if (mask[i]) {
        collisions++;
        continue;
      }
      let j: number;
      const x = i % w;
      const y = (i / w) | 0;
      if (horizontal) {
        if (x === 0) dir = 1;
        if (x === w - 1) dir = -1;
        j = i + dir;
      } else {
        if (y === 0) dir = 1;
        if (y === h - 1) dir = -1;
        j = i + dir * w;
      }
      if (mask[j]) {
        collisions++;
        continue;
      }
      mask[i] = 1;
      mask[j] = 1;
      idx[pairN * 2] = i;
      idx[pairN * 2 + 1] = j;
      pairN++;
      collisions = 0;
    }
    this.pairN = pairN;
    return pairN;
  }

  /** run and write back pairs [p0, p1) with this world's core */
  runSlice(idx: Int32Array, p0: number, p1: number) {
    if (!this.core) return;
    runPairs(this.core, this.soup, idx, p0, p1, this.steps, this.writes);
  }

  /** the reference scatters `pair_n * noise` random byte flips over the soup */
  finishEpoch(pairN: number) {
    const flips = (pairN * this.noise) | 0;
    const r = this.rand;
    for (let i = 0; i < flips; i++) {
      const v = r();
      this.soup[Math.floor((v / 4294967296) * this.soup.length)] = (r() >>> 24) & 0xff;
    }
    this.epoch++;
  }

  step() {
    const pairN = this.planInto(this.idx);
    this.runSlice(this.idx, 0, pairN);
    this.finishEpoch(pairN);
  }

  /** per-byte histogram, used by the UI */
  byteCounts(): Uint32Array {
    const c = new Uint32Array(256);
    for (let i = 0; i < this.soup.length; i++) c[this.soup[i]]++;
    return c;
  }

  stats() {
    const counts = this.byteCounts();
    const total = this.soup.length;
    let ent = 0;
    let zeros = 0;
    let ops = 0;
    for (let i = 0; i < 256; i++) {
      if (counts[i]) {
        const p = counts[i] / total;
        ent -= p * Math.log2(p);
      }
    }
    zeros = counts[0] / total;
    // "code" = share of bytes that are not 0x00/NOP-ish defaults; zff treats
    // the grey ramp (0x00..0xff) as data, so report the top-opcode share instead
    const sorted = Array.from(counts).map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    ops = sorted[0][0] / total;
    return { entropy: ent, zeros, topByte: sorted[0][1], topShare: ops, distinct: 0, top1: 0 };
  }
}

export { Z80_TAPE, Z80_PAIR, Z80_STEPS };
