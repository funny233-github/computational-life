/**
 * Public, DOM-free surface of the engine. Everything here is data: bytes,
 * statistics, disassembly, semantic keys. Colours and canvases live in `ui/`.
 *
 * This module must stay importable under plain Node (the tests do exactly
 * that), so it must not pull in the worker/wasm plumbing — see factory.ts.
 */
export type { Substrate, CellMode, Microscope } from "./substrate.ts";
export { TAPE, decode, encode } from "./bff.ts";
export { GRID_LEGEND } from "./z80sub.ts";

import { BYTE_CLASS, NOP, OP, OP_CHAR } from "./bff.ts";

/** the printable character for one BFF byte */
export function opChar(b: number): string {
  const op = OP[b];
  return op === NOP ? "·" : (OP_CHAR[op] ?? "·");
}

/** 0 data · 1 brackets · 2 arith/copy · 3 heads · 4 null */
export function byteClass(b: number): number {
  return BYTE_CLASS[b];
}

/** how many workers we would start by default: leave one core for the page */
export function autoCores(): number {
  const hw = typeof navigator === "undefined" ? 2 : (navigator.hardwareConcurrency ?? 2);
  return Math.max(1, Math.min(8, hw - 1));
}

/** the largest worker count the UI may offer */
export function maxCores(): number {
  const hw = typeof navigator === "undefined" ? 2 : (navigator.hardwareConcurrency ?? 2);
  return Math.max(1, Math.min(8, hw));
}
