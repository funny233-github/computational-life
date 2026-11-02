/** rasterisation: bytes in, pixels out. No simulation logic lives here. */
import type { CellMode } from "../engine/substrate.ts";
import { byteColors, canvasBg, cellColor, mnemonicInk, pack } from "./palette.ts";
import { blitRect, camFor, cellAt } from "./geometry.ts";

const MONO = `ui-monospace, "DejaVu Sans Mono", "Liberation Mono", monospace`;

export function drawWindowBytes(
  bytes: Uint8Array,
  soupW: number,
  soupH: number,
  side: number,
  px: number,
  camX: number,
  camY: number,
  outW: number,
  outH: number,
  colors: Uint32Array,
  bg: number,
  cellLines: boolean,
  offX: number,
  offY: number,
  out: Uint32Array,
) {
  out.fill(bg);
  const cell = side * px;
  const perCell = side * side;
  const cols = Math.ceil(outW / cell) + 1;
  const rows = Math.ceil(outH / cell) + 1;
  for (let ry = 0; ry < rows; ry++) {
    const cy = camY + ry;
    if (cy < 0 || cy >= soupH) continue;
    for (let rx = 0; rx < cols; rx++) {
      const cx = camX + rx;
      if (cx < 0 || cx >= soupW) continue;
      const base = (cy * soupW + cx) * perCell;
      const ox = rx * cell + offX;
      const oy = ry * cell + offY;
      for (let b = 0; b < perCell; b++) {
        const col = colors[bytes[base + b]];
        // round each edge, not each size: with a fractional px the blocks vary
        // between n and n+1 pixels but never leave a seam
        const bx = Math.round(ox + (b % side) * px);
        const by = Math.round(oy + ((b / side) | 0) * px);
        const x0 = Math.max(0, bx);
        const y0 = Math.max(0, by);
        const xe = Math.min(Math.round(ox + ((b % side) + 1) * px), outW);
        const ye = Math.min(Math.round(oy + (((b / side) | 0) + 1) * px), outH);
        for (let yy = y0; yy < ye; yy++) {
          const row = yy * outW;
          for (let xx = x0; xx < xe; xx++) out[row + xx] = col;
        }
      }
      if (cellLines && px >= 6) {
        // one dark pixel along the top and left of the cell, so the 4x4 (or
        // 8x8) grouping stays visible without eating a whole byte
        const cut = 0.55;
        for (let i = 0; i < cell; i++) {
          const xx = ox + i;
          const yy = oy + i;
          if (oy >= 0 && ox >= 0 && xx < outW && oy < outH) darkenAt(out, oy * outW + xx, cut);
          if (oy >= 0 && ox >= 0 && yy < outH && ox < outW) darkenAt(out, yy * outW + ox, cut);
        }
      }
    }
  }
}

function darkenAt(out: Uint32Array, i: number, k: number) {
  const v = out[i];
  const r = (v & 255) * k;
  const g = ((v >> 8) & 255) * k;
  const b = ((v >> 16) & 255) * k;
  out[i] = pack(r | 0, g | 0, b | 0);
}

/** one colour per program, blitted at `cell` device pixels each */
export function drawWindowCells(
  soupW: number,
  soupH: number,
  cell: number,
  camX: number,
  camY: number,
  outW: number,
  outH: number,
  colorOf: (c: number) => number,
  bg: number,
  offX: number,
  offY: number,
  out: Uint32Array,
) {
  out.fill(bg);
  const cols = Math.ceil(outW / cell) + 1;
  const rows = Math.ceil(outH / cell) + 1;
  for (let ry = 0; ry < rows; ry++) {
    const cy = camY + ry;
    if (cy < 0 || cy >= soupH) continue;
    for (let rx = 0; rx < cols; rx++) {
      const cx = camX + rx;
      if (cx < 0 || cx >= soupW) continue;
      const col = colorOf(cy * soupW + cx);
      const x0 = Math.max(0, Math.round(rx * cell + offX));
      const y0 = Math.max(0, Math.round(ry * cell + offY));
      const xe = Math.min(Math.round((rx + 1) * cell + offX), outW);
      const ye = Math.min(Math.round((ry + 1) * cell + offY), outH);
      for (let yy = y0; yy < ye; yy++) {
        const row = yy * outW;
        out.fill(col, row + x0, row + xe);
      }
    }
  }
}

/** the soup viewport: bitmap size, whole-number magnification, camera */
export class SoupCanvas {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  pixels: Uint32Array;
  /** the soup rasterised at one pixel per byte (or per cell); the browser scales it */
  private src: HTMLCanvasElement;
  private srcCtx: CanvasRenderingContext2D;
  private srcImg: ImageData;
  private srcPixels: Uint32Array;
  /** integer factor the browser magnifies the bitmap by */
  upscale = 1;
  /** bitmap pixels per byte */
  px = 1;
  camX = 0;
  camY = 0;
  private side = 4;
  private w = 1;
  private h = 1;

  constructor(el: HTMLCanvasElement) {
    this.el = el;
    // desynchronized skips one compositor hop; zoom feels noticeably tighter
    this.ctx = el.getContext("2d", { desynchronized: true, alpha: false }) ?? el.getContext("2d")!;
    this.img = this.ctx.createImageData(1, 1);
    this.pixels = new Uint32Array(this.img.data.buffer);
    this.src = document.createElement("canvas");
    this.srcCtx = this.src.getContext("2d")!;
    this.srcImg = this.srcCtx.createImageData(1, 1);
    this.srcPixels = new Uint32Array(this.srcImg.data.buffer);
  }

  /**
   * Rasterise the whole soup into the offscreen buffer at exactly one pixel per
   * byte (or per program). Scaling it up is then a single GPU blit, which is
   * what makes zooming cheap: the per-frame CPU work is ~80k pixels instead of
   * the whole viewport.
   */
  private prepare(
    sub: {
      kind: "z80" | "bff";
      w: number;
      h: number;
      side: number;
      bytes(): Uint8Array;
      cellKey(c: number, m: CellMode): number;
    },
    mode: CellMode | "bytes",
  ) {
    const bytes = mode === "bytes";
    const sw = bytes ? sub.w * sub.side : sub.w;
    const sh = bytes ? sub.h * sub.side : sub.h;
    if (this.src.width !== sw || this.src.height !== sh) {
      this.src.width = sw;
      this.src.height = sh;
      this.srcImg = this.srcCtx.createImageData(sw, sh);
      this.srcPixels = new Uint32Array(this.srcImg.data.buffer);
    }
    if (bytes) {
      drawWindowBytes(sub.bytes(), sub.w, sub.h, sub.side, 1, 0, 0, sw, sh, byteColors(sub.kind), canvasBg(), false, 0, 0, this.srcPixels);
      this.srcCtx.putImageData(this.srcImg, 0, 0);
      return { k: this.px, sh };
    }
    drawWindowCells(sub.w, sub.h, 1, 0, 0, sw, sh, (c) => cellColor(sub, c, mode), canvasBg(), 0, 0, this.srcPixels);
    this.srcCtx.putImageData(this.srcImg, 0, 0);
    return { k: this.cellPx(), sh };
  }

  /** CSS pixels the stage can give us, minus its padding */
  private stage(): [number, number] {
    const st = this.el.parentElement!;
    return [Math.max(160, Math.floor(st.clientWidth) - 40), Math.max(120, Math.floor(st.clientHeight) - 40)];
  }

  /** how many pixels per byte make the whole soup fit */
  fitPx(): number {
    const [cw, ch] = this.stage();
    return Math.min(cw / (this.w * this.side), ch / (this.h * this.side));
  }

  /** the bitmap is always the stage at 1:1, so zooming only changes `px` */
  layout(w: number, h: number, side: number) {
    this.w = w;
    this.h = h;
    this.side = side;
    const [cw, ch] = this.stage();
    this.upscale = 1;
    this.el.width = Math.ceil(cw);
    this.el.height = Math.ceil(ch);
    this.el.style.width = this.el.width + "px";
    this.el.style.height = this.el.height + "px";
    this.clamp();
  }

  /**
   * Zoomed in far enough, print the instruction inside every byte block — the
   * same trick the official video uses. Called after the bitmap is on screen,
   * because text cannot be written into a pixel buffer.
   */
  /** ?debug turns on the geo readout used by the browser probes */
  private readonly debug = location.search.includes("debug");
  /** true while the zoom animation is still running */
  animating = false;

  private drawMnemonics(
    sub: {
      kind: "z80" | "bff";
      w: number;
      h: number;
      n: number;
      side: number;
      bytes(): Uint8Array;
      blocks(c: number): { start: number; len: number; short: string }[];
    },
    ox: number,
    oy: number,
  ) {
    const px = this.px;
    if (px < 18 || this.animating) return;
    const cell = this.cellPx();
    const sx0 = Math.max(0, Math.floor(this.camX));
    const sy0 = Math.max(0, Math.floor(this.camY));
    const ctx = this.ctx;
    ctx.textBaseline = "middle";
    const cols = this.cols();
    const rows = this.rows();
    for (let ry = 0; ry <= rows + 1; ry++) {
      const cy = sy0 + ry;
      if (cy < 0 || cy >= sub.h) continue;
      for (let rx = 0; rx <= cols + 1; rx++) {
        const cx = sx0 + rx;
        if (cx < 0 || cx >= sub.w) continue;
        const c = cy * sub.w + cx;
        if (c >= sub.n) continue;
        const gx = ox + (cx - this.camX) * cell;
        const gy = oy + (cy - this.camY) * cell;
        for (const blk of sub.blocks(c)) {
          const jx = gx + (blk.start % sub.side) * px;
          const jy = gy + Math.floor(blk.start / sub.side) * px;
          if (jx < -cell || jy < -cell || jx > this.el.width || jy > this.el.height) continue;
          // the instruction owns `len` blocks, so the text may not spill past
          // them: pick a font size that fits, and fall back to the bare colour
          const text = blk.short === "NOP" ? "" : blk.short;
          const avail = px * blk.len - 6;
          let fs = Math.min(13, Math.round(px * 0.42));
          if (text && fs >= 7 && avail > 8) {
            // measure once, then scale the size so the whole mnemonic fits
            ctx.font = `500 ${fs}px ${MONO}`;
            const w = ctx.measureText(text).width;
            if (w > avail) fs = Math.floor((fs * avail) / w / 0.97);
            if (fs >= 7) {
              // pick ink that survives the block colour underneath
              const col = byteColors(sub.kind)[sub.bytes()[c * sub.side * sub.side + blk.start]];
              const lum = ((col & 255) + ((col >> 8) & 255) + ((col >> 16) & 255)) / 3;
              ctx.font = `500 ${fs}px ${MONO}`;
              ctx.fillStyle = lum > 105 ? "rgba(28,26,24,0.82)" : mnemonicInk;
              ctx.fillText(text, jx + 2, jy + px / 2);
            }
          }
          // and the bytes that only carry its operand get a small marker
          for (let k = 1; k < blk.len; k++) {
            const ox2 = gx + ((blk.start + k) % sub.side) * px;
            const oy2 = gy + Math.floor((blk.start + k) / sub.side) * px;
            const r2 = Math.max(1, px * 0.09);
            ctx.fillStyle = "rgba(230,227,220,0.35)";
            ctx.beginPath();
            ctx.arc(ox2 + px / 2, oy2 + px / 2, r2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  }

  /** zoom, in pixels per byte; fractional values are allowed (smooth zoom) */
  setPx(px: number) {
    const next = Number.isFinite(px) ? px : this.fitPx();
    this.px = Math.max(0.35, Math.min(96, next));
    // the visible cell count just changed, so the camera bounds did too
    this.clamp();
  }

  cellPx(): number {
    return this.side * this.px;
  }

  cols(): number {
    return Math.max(1, Math.floor(this.el.width / this.cellPx()));
  }
  rows(): number {
    return Math.max(1, Math.floor(this.el.height / this.cellPx()));
  }

  /** where the soup starts, so a whole-soup view is centred */
  origin(): [number, number] {
    const ox = Math.max(0, Math.floor((this.el.width - this.w * this.cellPx()) / 2));
    const oy = Math.max(0, Math.floor((this.el.height - this.h * this.cellPx()) / 2));
    return [ox, oy];
  }

  clamp() {
    // fractional bounds: flooring the visible cell count let the camera slide
    // whenever the zoom changed, which showed up as a drift to the top-left
    const mx = this.w - this.el.width / this.cellPx();
    const my = this.h - this.el.height / this.cellPx();
    // the camera never goes negative: when the soup is smaller than the window,
    // origin() centres it instead
    this.camX = Math.min(Math.max(0, this.camX), Math.max(0, mx));
    this.camY = Math.min(Math.max(0, this.camY), Math.max(0, my));
  }
  centerOn(cell: number) {
    this.camX = (cell % this.w) - (this.cols() >> 1);
    this.camY = Math.floor(cell / this.w) - (this.rows() >> 1);
    this.clamp();
  }
  pan(dx: number, dy: number) {
    this.camX += dx;
    this.camY += dy;
    this.clamp();
  }

  draw(
    sub: {
      kind: "z80" | "bff";
      w: number;
      h: number;
      n: number;
      side: number;
      bytes(): Uint8Array;
      cellKey(c: number, m: CellMode): number;
      blocks(c: number): { start: number; len: number; short: string }[];
    },
    mode: CellMode | "bytes",
    selected: number,
  ) {
    const [ox, oy] = this.origin();
    const { k, sh } = this.prepare(sub, mode);
    const cell = this.cellPx();
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "rgba(29,28,26,1)";
    ctx.fillRect(0, 0, this.el.width, this.el.height);
    // one blit for the whole soup; fractional offsets are handled by the GPU.
    // `k` is pixels per *source* pixel, which in byte mode is per byte, so the
    // camera (measured in cells) has to be scaled by the cell size instead
    const [bx, by, bw, bh] = blitRect(this.camX, this.camY, ox, oy, cell, this.src.width, sh, k);
    ctx.drawImage(this.src, 0, 0, this.src.width, sh, bx, by, bw, bh);

    if (mode === "bytes") {
      this.drawCellGrid(sub, ox, oy);
      this.drawMnemonics(sub, ox, oy);
    }
    this.el.dataset.px = String(this.px);
    if (this.debug) {
      const [ox, oy] = this.origin();
      this.el.dataset.geo = [this.camX, this.camY, this.cellPx(), ox, oy].map((v) => v.toFixed(3)).join(",");
    }

    const rx = ox + ((selected % sub.w) - this.camX) * cell;
    const ry = oy + (Math.floor(selected / sub.w) - this.camY) * cell;
    if (rx > -cell && ry > -cell && rx < this.el.width && ry < this.el.height) {
      ctx.strokeStyle = "rgba(230,227,220,0.8)";
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(rx) + 0.5, Math.round(ry) + 0.5, Math.round(cell) - 1, Math.round(cell) - 1);
    }
  }

  /** the 4x4 / 8x8 grouping, drawn as vectors so it stays one pixel wide */
  private drawCellGrid(sub: { w: number; h: number }, ox: number, oy: number) {
    const cell = this.cellPx();
    if (cell < 6) return;
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(14,13,12,0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x0 = ox - this.camX * cell;
    const y0 = oy - this.camY * cell;
    for (let cx = 0; cx <= sub.w; cx++) {
      const x = Math.round(x0 + cx * cell) + 0.5;
      if (x < 0 || x > this.el.width) continue;
      ctx.moveTo(x, Math.max(0, y0));
      ctx.lineTo(x, Math.min(this.el.height, y0 + sub.h * cell));
    }
    for (let cy = 0; cy <= sub.h; cy++) {
      const y = Math.round(y0 + cy * cell) + 0.5;
      if (y < 0 || y > this.el.height) continue;
      ctx.moveTo(Math.max(0, x0), y);
      ctx.lineTo(Math.min(this.el.width, x0 + sub.w * cell), y);
    }
    ctx.stroke();
  }

  /** fractional cell coordinates under the pointer, plus its position in the view (0..1) */
  pointerAt(clientX: number, clientY: number): [number, number, number, number] {
    const r = this.el.getBoundingClientRect();
    const dx = ((clientX - r.left) / r.width) * this.el.width;
    const dy = ((clientY - r.top) / r.height) * this.el.height;
    const [ox, oy] = this.origin();
    const cell = this.cellPx();
    // fractional cell under the pointer, plus the raw bitmap position: the
    // anchor has to undo exactly this mapping, so it needs both
    return [cellAt(this.camX, ox, cell, dx), cellAt(this.camY, oy, cell, dy), dx, dy];
  }

  /** put the fractional cell (fx, fy) back under the bitmap point (dx, dy) */
  anchor(fx: number, fy: number, dx: number, dy: number) {
    const [ox, oy] = this.origin();
    const cell = this.cellPx();
    this.camX = camFor(fx, ox, cell, dx);
    this.camY = camFor(fy, oy, cell, dy);
    this.clamp();
  }

  /** which program is under a pointer event */
  cellAt(clientX: number, clientY: number): number {
    const [fx, fy] = this.pointerAt(clientX, clientY);
    return Math.floor(fy) * this.w + Math.floor(fx);
  }
}