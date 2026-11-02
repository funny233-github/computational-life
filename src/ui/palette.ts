/**
 * Colours. This is the only place that knows what a byte looks like; the
 * engine only ever hands over bytes and small semantic keys.
 */
import { byteClass } from "../engine/index.ts";
import type { CellMode } from "../engine/index.ts";

/** how the one-pixel-per-cell views interpret a program */
export type ViewMode = CellMode;

function hsl(h: number, s: number, l: number): number {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255);
  };
  return (255 << 24) | (f(8) << 16) | (f(4) << 8) | f(0);
}

export function pack(r: number, g: number, b: number): number {
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

/** rainbow palette — only used by the cell-level identity / lineage views */
const PALETTE = new Uint32Array(256);
for (let i = 0; i < 256; i++) PALETTE[i] = hsl(i / 256, 0.62, 0.55);

export const BYTE_COLOR = new Uint32Array(256);
export const BYTE_R = new Uint8Array(256);
export const BYTE_G = new Uint8Array(256);
export const BYTE_B = new Uint8Array(256);

export type Theme = "dark" | "light";

let curTheme: Theme = "dark";

export function setTheme(t: Theme) {
  curTheme = t;
  for (let i = 0; i < 256; i++) {
    PALETTE[i] = t === "dark" ? hsl(i / 256, 0.24, 0.4) : hsl(i / 256, 0.62, 0.55);
  }
  for (let b = 0; b < 256; b++) {
    let r: number;
    let g: number;
    let bl: number;
    switch (byteClass(b)) {
      case 1:
        [r, g, bl] = t === "dark" ? [78, 124, 96] : [0, 192, 0];
        break;
      case 2:
        [r, g, bl] = t === "dark" ? [150, 86, 120] : [200, 0, 200];
        break;
      case 3:
        [r, g, bl] = t === "dark" ? [120, 108, 168] : [200, 128, 220];
        break;
      case 4:
        [r, g, bl] = t === "dark" ? [140, 66, 58] : [255, 0, 0];
        break;
      default: {
        const v = (t === "dark" ? 26 : 192) + ((b / 4) | 0);
        if (t === "dark") {
          r = Math.min(255, v * 1.06 + 3);
          g = v + 1;
          bl = v * 0.9;
        } else {
          r = v;
          g = v;
          bl = v;
        }
      }
    }
    BYTE_COLOR[b] = pack(r, g, bl);
    BYTE_R[b] = r;
    BYTE_G[b] = g;
    BYTE_B[b] = bl;
  }
  buildZ80(t);
}



// ---------------------------------------------------------------- Z80 (zff)

/**
 * Byte colours from the reference lab (znah/zff js/main.js): a dark grey ramp
 * with a handful of hand-picked colours for the opcodes that matter.
 *
 * "light" reproduces them exactly. "dark" keeps the same hue for every opcode
 * (red stays reddish, green greenish) but drops lightness and saturation to the
 * warm, low-contrast range of the surrounding UI.
 */
export const Z80_COLOR = new Uint32Array(256);

function buildZ80(t: Theme) {
  for (let i = 0; i < 256; i++) {
    let r: number;
    let g: number;
    let b: number;
    if (t === "light") {
      r = g = b = Math.round(64 + i / 8);
    } else {
      const v = 38 + i / 7.5; // 38 .. 72, warm grey (the reference uses 64..96)
      r = v * 1.05 + 2;
      g = v + 1;
      b = v * 0.93;
    }
    Z80_COLOR[i] = pack(Math.round(r), Math.round(g), Math.round(b));
  }
  const set = (i: number, r: number, g: number, b: number) => {
    Z80_COLOR[i] = pack(r, g, b);
  };
  if (t === "light") {
    set(0x00, 0, 0, 0);
    set(0x01, 250, 100, 100);
    set(0x11, 100, 250, 100);
    set(0x21, 100, 100, 250);
    set(0x2a, 255, 255, 255);
    set(0xc5, 240, 200, 200);
    set(0xd5, 240, 240, 200);
    set(0xe5, 240, 200, 240);
    set(0xed, 240, 50, 50);
    set(0xb0, 240, 60, 60);
    set(0xb8, 240, 70, 70);
    set(0xe3, 200, 240, 50);
    set(0xd8, 100, 100, 50);
    set(0xc9, 100, 100, 50);
  } else {
    set(0x00, 0x16, 0x15, 0x13); // nop — darker than every data byte
    set(0x01, 0xb0, 0x6a, 0x4f); // ld bc,nn   terracotta
    set(0x11, 0x7e, 0x8f, 0x66); // ld de,nn   sage
    set(0x21, 0x6a, 0x7d, 0x99); // ld hl,nn   slate
    set(0x2a, 0xb4, 0xae, 0x9f); // ld hl,(nn) cream
    set(0xc5, 0xbb, 0xa4, 0x9a); // push bc
    set(0xd5, 0xb9, 0xb3, 0x96); // push de
    set(0xe5, 0xb2, 0x9d, 0xb0); // push hl
    set(0xed, 0x9b, 0x56, 0x4a); // ED
    set(0xb0, 0x9b, 0x5c, 0x4c); // [ED] ldir
    set(0xb8, 0x9b, 0x62, 0x4e); // [ED] lddr
    set(0xe3, 0x93, 0x8a, 0x4e); // ex (sp),hl
    set(0xd8, 0x5f, 0x5c, 0x44); // ret c
    set(0xc9, 0x5f, 0x5c, 0x44); // ret
  }
}

const Z80_CLASS_COLOR_DARK = [
  pack(0x1d, 0x1c, 0x1a),
  pack(0x7d, 0x8a, 0x99),
  pack(0xb0, 0x6a, 0x4f),
  pack(0x8f, 0x7a, 0x9c),
  pack(0x6e, 0x6a, 0x5f),
];
const Z80_CLASS_COLOR_LIGHT = [
  pack(0, 0, 0),
  pack(0x3a, 0x6e, 0xc8),
  pack(0xc8, 0x5a, 0x3a),
  pack(0x8a, 0x5e, 0xc8),
  pack(0x88, 0x88, 0x88),
];

/**
 * One window of the soup, drawn straight into the canvas pixel buffer with an
 * integer number of device pixels per byte. No scaling anywhere: the canvas'
 * bitmap is the stage, so 4 px per byte means exactly 4 px.
 */

const CANVAS_BG_DARK = pack(0x1d, 0x1c, 0x1a);
const CANVAS_BG_LIGHT = pack(0, 0, 0);
export function canvasBg() {
  return curTheme === "dark" ? CANVAS_BG_DARK : CANVAS_BG_LIGHT;
}

/** backdrop of the two microscope canvases */
export const ctx_muted_bg = () => "#131211";


/** the byte -> colour table for a substrate */
export function byteColors(kind: "z80" | "bff"): Uint32Array {
  return kind === "z80" ? Z80_COLOR : BYTE_COLOR;
}

/** the semantic key an engine hands back, turned into a pixel colour */
export function cellColor(sub: { cellKey(c: number, mode: CellMode): number }, c: number, mode: CellMode): number {
  const k = sub.cellKey(c, mode);
  if (mode === "code") {
    const t = curTheme === "dark" ? Z80_CLASS_COLOR_DARK : Z80_CLASS_COLOR_LIGHT;
    return t[Math.min(4, Math.max(0, k))];
  }
  return PALETTE[k & 0xff];
}

/** ink for the mnemonics printed inside the soup */
let mnemonicInk = "rgba(230,227,220,0.72)";
export { mnemonicInk };

export function theme(): Theme {
  return curTheme;
}

setTheme("dark");
