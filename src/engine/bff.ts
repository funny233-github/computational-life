/**
 * BFF — the "Brainfuck, but heads instead of I/O" substrate from
 * Agüera y Arcas et al., "Computational Life" (arXiv:2406.19108).
 *
 * Semantics ported 1:1 from the reference CUDA/CPU implementation
 * (paradigms-of-intelligence/cubff, bff.inc.h, BFF_NOHEADS variant):
 *
 *   - one cell = one 64-byte tape; two tapes are glued into 128 bytes to run
 *   - code and data are the same bytes: every write is self-modification
 *   - pc, head0, head1 all start at 0
 *   - heads wrap with & 127
 *   - `[` jumps iff tape[head0] == 0 (byte 0x00, NOT the character '[')
 *   - unmatched brackets terminate; pc leaving [0,128) terminates
 */

/** one cell = one tape of 64 bytes (the paper's kSingleTapeSize) */
export const TAPE = 64;
/** an interaction glues two tapes into one 128-byte tape and runs that */
export const PAIR = 128;

/** op ids; a byte 0..255 maps to one of these through OP[] */
export const NOP = 0;
const LOOP_START = 1;
const LOOP_END = 2;
const PLUS = 3;
const MINUS = 4;
const COPY01 = 5; // '.'  tape[h1] = tape[h0]
const COPY10 = 6; // ','  tape[h0] = tape[h1]
const DEC0 = 7; //   '<'
const INC0 = 8; //   '>'
const DEC1 = 9; //   '{'
const INC1 = 10; //  '}'
export const NULL = 11; //  byte 0x00 — the only "false" for loops

/** byte -> op */
export const OP = new Uint8Array(256); // all NOP
OP[0] = NULL;
OP[0x2b] = PLUS; // +
OP[0x2d] = MINUS; // -
OP[0x3c] = DEC0; // <
OP[0x3e] = INC0; // >
OP[0x7b] = DEC1; // {
OP[0x7d] = INC1; // }
OP[0x2e] = COPY01; // .
OP[0x2c] = COPY10; // ,
OP[0x5b] = LOOP_START; // [
OP[0x5d] = LOOP_END; // ]

export const OP_CHAR = ["", "[", "]", "+", "-", ".", ",", "<", ">", "{", "}", "0"];

/** Runs `tape` in place for at most `maxSteps` instructions.
 *  Also carries `tokens` (radioactive tracers) along copy operations.
 *  Returns the number of non-nop instructions executed. */
export function evalTape(tape: Uint8Array, maxSteps: number, tokens: Uint32Array): number {
  let pc = 0;
  let h0 = 0;
  let h1 = 0;
  let executed = 0;

  for (let i = 0; i < maxSteps; i++) {
    h0 &= 127;
    h1 &= 127;
    const op = OP[tape[pc]];
    if (op !== NOP && op !== NULL) {
      executed++;
      switch (op) {
        case DEC0:
          h0--;
          break;
        case INC0:
          h0++;
          break;
        case DEC1:
          h1--;
          break;
        case INC1:
          h1++;
          break;
        case PLUS:
          tape[h0] = (tape[h0] + 1) & 0xff;
          break;
        case MINUS:
          tape[h0] = (tape[h0] - 1) & 0xff;
          break;
        case COPY01:
          tape[h1] = tape[h0];
          tokens[h1] = tokens[h0];
          break;
        case COPY10:
          tape[h0] = tape[h1];
          tokens[h0] = tokens[h1];
          break;
        case LOOP_START:
          if (tape[h0] === 0) {
            let depth = 1;
            let p = pc + 1;
            while (p < PAIR) {
              const k = OP[tape[p]];
              if (k === LOOP_END) depth--;
              else if (k === LOOP_START) depth++;
              p++;
              if (depth === 0) break;
            }
            pc = depth === 0 ? p - 1 : PAIR - 1;
          }
          break;
        case LOOP_END:
          if (tape[h0] !== 0) {
            let depth = 1;
            let p = pc - 1;
            while (p >= 0) {
              const k = OP[tape[p]];
              if (k === LOOP_START) depth--;
              else if (k === LOOP_END) depth++;
              p--;
              if (depth === 0) break;
            }
            pc = depth === 0 ? p + 1 : -2;
          }
          break;
      }
    }
    if (pc < 0) break;
    pc++;
    if (pc >= PAIR) break;
  }
  return executed;
}

/** Single-steppable executor, for the inspector / lab view. */
export class Exec {
  tape: Uint8Array;
  tokens: Uint32Array;
  pc = 0;
  h0 = 0;
  h1 = 0;
  halted = false;
  executed = 0;

  constructor(tape: Uint8Array, tokens?: Uint32Array) {
    this.tape = tape;
    this.tokens = tokens ?? new Uint32Array(PAIR);
  }

  step(): boolean {
    if (this.halted) return false;
    const t = this.tape;
    const h0 = this.h0 & 127;
    const h1 = this.h1 & 127;
    const op = OP[t[this.pc]];
    if (op !== NOP && op !== NULL) this.executed++;
    switch (op) {
      case DEC0:
        this.h0 = h0 - 1;
        break;
      case INC0:
        this.h0 = h0 + 1;
        break;
      case DEC1:
        this.h1 = h1 - 1;
        break;
      case INC1:
        this.h1 = h1 + 1;
        break;
      case PLUS:
        t[h0] = (t[h0] + 1) & 0xff;
        break;
      case MINUS:
        t[h0] = (t[h0] - 1) & 0xff;
        break;
      case COPY01:
        t[h1] = t[h0];
        this.tokens[h1] = this.tokens[h0];
        break;
      case COPY10:
        t[h0] = t[h1];
        this.tokens[h0] = this.tokens[h1];
        break;
      case LOOP_START:
        if (t[h0] === 0) {
          let depth = 1;
          let p = this.pc + 1;
          while (p < PAIR) {
            const k = OP[t[p]];
            if (k === LOOP_END) depth--;
            else if (k === LOOP_START) depth++;
            p++;
            if (depth === 0) break;
          }
          this.pc = depth === 0 ? p - 1 : PAIR - 1;
        }
        break;
      case LOOP_END:
        if (t[h0] !== 0) {
          let depth = 1;
          let p = this.pc - 1;
          while (p >= 0) {
            const k = OP[t[p]];
            if (k === LOOP_START) depth--;
            else if (k === LOOP_END) depth++;
            p--;
            if (depth === 0) break;
          }
          this.pc = depth === 0 ? p + 1 : -2;
        }
        break;
    }
    if (this.pc < 0) {
      this.halted = true;
      return false;
    }
    this.pc++;
    if (this.pc >= PAIR) {
      this.halted = true;
      return false;
    }
    return true;
  }
}

/** Decode 64 bytes to editable text.
 *  Instructions keep their own character, 0x00 -> '0', 0x01 -> '#' (a non-zero
 *  no-op that hand-written replicators need as filler), everything else -> '·'.
 *  Encoding '0', '·' or a space yields 0x00, '#' yields 0x01 — so code
 *  round-trips exactly; random junk bytes collapse to 0x00, which is the sane
 *  default. */
export function decode(tape: Uint8Array, len = TAPE): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    const b = tape[i];
    const op = OP[b];
    if (op !== NOP) s += OP_CHAR[op];
    else s += b === 1 ? "#" : "·";
  }
  return s;
}

/** Parse text to bytes, padding with zero bytes to `len`. */
export function encode(text: string, len = TAPE): Uint8Array {
  const out = new Uint8Array(len);
  let i = 0;
  for (const ch of text) {
    if (i >= len) break;
    if (ch === "#") out[i++] = 1;
    // '0' is how `decode` prints the null byte; encoding it as 0x30 (the ASCII
    // code of '0') would silently turn every null into a data byte on "paint".
    else if (ch === "0" || ch === "·" || ch === " " || ch === "\n" || ch === "\t") out[i++] = 0;
    else out[i++] = ch.charCodeAt(0) & 0xff;
  }
  return out;
}

export function hex(tape: Uint8Array, len = TAPE): string {
  let s = "";
  for (let i = 0; i < len; i++) s += tape[i].toString(16).padStart(2, "0");
  return s;
}

/** 0 data · 1 brackets · 2 arith/copy · 3 heads · 4 null (see the paper's Table 1) */
export const BYTE_CLASS = new Uint8Array(256);
for (let b = 0; b < 256; b++) {
  switch (OP[b]) {
    case 1:
    case 2:
      BYTE_CLASS[b] = 1;
      break;
    case 3:
    case 4:
    case 5:
    case 6:
      BYTE_CLASS[b] = 2;
      break;
    case 7:
    case 8:
    case 9:
    case 10:
      BYTE_CLASS[b] = 3;
      break;
    case NULL:
      BYTE_CLASS[b] = 4;
      break;
    default:
      BYTE_CLASS[b] = 0;
  }
}
