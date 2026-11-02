import { readFileSync } from "node:fs";
import { instantiateZ80, type Z80Core } from "../src/engine/z80core.ts";

/** the tests run under plain Node, so the wasm comes from disk, not fetch */
const WASM = new URL("../src/engine/z80worker.wasm", import.meta.url);
export const loadCore = (): Promise<Z80Core> => instantiateZ80(readFileSync(WASM));
