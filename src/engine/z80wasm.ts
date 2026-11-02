/**
 * The reference Z80 core, as a real `.wasm` asset.
 *
 * The binary lives in `vendor/z80/` together with both licences and a note on
 * where it came from (it is `wasm/z80worker.wasm` from znah/zff, wrapping
 * superzazu/z80, unmodified). Loading it through Vite's asset pipeline keeps
 * the emulation identical to the reference instead of a re-derivation.
 *
 * `new URL(..., import.meta.url)` is the form Vite understands: in dev it
 * resolves to the source path, in a build it becomes the hashed asset URL, and
 * it keeps working inside a worker (same origin, no `document` needed).
 */
export const Z80_WASM_URL = new URL("./vendor/z80/z80worker.wasm", import.meta.url).href;
