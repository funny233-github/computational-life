import { Z80_WASM_B64 } from "./z80wasm.ts";

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

function decodeB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** instantiate the embedded core once */
export async function loadZ80(): Promise<Z80Core> {
  const bytes = decodeB64(Z80_WASM_B64);
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
