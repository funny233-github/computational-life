import { Z80_WASM_URL } from "./z80wasm.ts";

/**
 * Byte offsets inside the `z80` struct the wasm hands us (see the reference's
 * external/z80.h): five pointers (20 bytes), `unsigned long cyc` (4), then the
 * registers. `z80_trace` is the only entry point that leaves the struct behind.
 */
export const Z80_STATE = {
  cyc: 20,
  pc: 24,
  sp: 26,
  ix: 28,
  iy: 30,
  a: 34,
  b: 35,
  c: 36,
  d: 37,
  e: 38,
  h: 39,
  l: 40,
  /** flags packed low-to-high: S Z Y H X P N C */
  flags: 51,
} as const;

export interface Registers {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  h: number;
  l: number;
  /** the F register, rebuilt from the bitfield */
  f: number;
  pc: number;
  sp: number;
  ix: number;
  iy: number;
}

/** read the register file the last `trace()` left in wasm memory */
export function readRegisters(core: Z80Core): Registers {
  const s = core.state;
  const u16 = (o: number) => s[o] | (s[o + 1] << 8);
  return {
    a: s[Z80_STATE.a],
    b: s[Z80_STATE.b],
    c: s[Z80_STATE.c],
    d: s[Z80_STATE.d],
    e: s[Z80_STATE.e],
    h: s[Z80_STATE.h],
    l: s[Z80_STATE.l],
    f: s[Z80_STATE.flags],
    pc: u16(Z80_STATE.pc),
    sp: u16(Z80_STATE.sp),
    ix: u16(Z80_STATE.ix),
    iy: u16(Z80_STATE.iy),
  };
}

export const Z80_TAPE = 16;
export const Z80_PAIR = 32;
/** the reference lab runs this many Z80 instructions per interaction */
export const Z80_STEPS = 128;

export interface Z80Core {
  /** pair_n * 32 bytes of "tape A ++ tape B" */
  batch: Uint8Array;
  /** per tape: how many memory writes the program performed */
  writeCount: Int32Array;
  /** 32 bytes x 128 steps x rgba, filled by trace() */
  traceVis: Uint8Array;
  /** the raw z80 struct: pc at byte 24, sp at 26 */
  state: Uint8Array;
  run(pairN: number, steps: number): number;
  trace(steps: number): void;
}

/**
 * Instantiate the core from raw bytes. Tests use this with `fs.readFile`, the
 * browser goes through `loadZ80()` below — same code path after the fetch.
 */
export async function instantiateZ80(bytes: BufferSource): Promise<Z80Core> {
  const res = (await WebAssembly.instantiate(bytes, {})) as unknown as { instance?: WebAssembly.Instance } & WebAssembly.Instance;
  const instance = res.instance ?? res;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ex = instance.exports as any;
  const mem = ex.memory as WebAssembly.Memory;
  const buf = <T>(ctor: new (b: ArrayBuffer, o: number, l: number) => T, name: string, type: string) => {
    const ofs = ex["_get_" + name]();
    const len = ex[`_len_${name}__${type}`]();
    return new ctor(mem.buffer, ofs, len);
  };
  return {
    batch: buf(Uint8Array, "batch", "uint8_t"),
    writeCount: buf(Int32Array, "write_count", "int"),
    traceVis: buf(Uint8Array, "trace_vis", "uint8_t"),
    state: buf(Uint8Array, "z80_state", "uint8_t"),
    run: (n: number, steps: number) => ex.run(n, steps) as number,
    trace: (steps: number) => ex.z80_trace(steps) as void,
  };
}

/** fetch the asset and instantiate it; one call = one independent instance */
export async function loadZ80(): Promise<Z80Core> {
  const res = await fetch(Z80_WASM_URL);
  if (!res.ok) throw new Error(`拿不到 z80worker.wasm（HTTP ${res.status}）`);
  return instantiateZ80(await res.arrayBuffer());
}
