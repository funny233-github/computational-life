/**
 * The reference Z80 core, as a real `.wasm` asset.
 *
 * This is `wasm/z80worker.wasm` from znah/zff (MIT, (c) 2024 Google), which
 * itself wraps superzazu/z80. It is shipped verbatim and loaded through Vite's
 * asset pipeline, so the emulation stays identical to the reference instead of
 * being a re-derivation.
 *
 * `new URL(..., import.meta.url)` is the form Vite understands: in dev it
 * resolves to the source path, in a build it becomes the hashed asset URL, and
 * it keeps working inside a worker (same origin, no `document` needed).
 */
export const Z80_WASM_URL = new URL("./z80worker.wasm", import.meta.url).href;
