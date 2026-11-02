/** the microscope: the 128-byte BFF tape, and the Z80 disassembly window */
import { BYTE_R, BYTE_G, BYTE_B, Z80_COLOR, ctx_muted_bg } from "./palette.ts";

const SIDE = 104;
const GAP = 10;
const LAB_W = 2 * SIDE + GAP;
const LAB_H = SIDE + 16;

/** two byte grids (the 128-byte execution tape) with pc / head0 / head1 on top */
export function drawLab(
  canvas: HTMLCanvasElement,
  tape: Uint8Array,
  pc: number,
  h0: number,
  h1: number,
  grid: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(LAB_W * dpr)) {
    canvas.width = Math.round(LAB_W * dpr);
    canvas.height = Math.round(LAB_H * dpr);
    canvas.style.width = LAB_W + "px";
    canvas.style.height = LAB_H + "px";
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, LAB_W, LAB_H);

  ctx.font = "9px ui-monospace, monospace";
  ctx.fillStyle = "#565b67";
  ctx.fillText("A", 0, 9);
  ctx.fillText("B", SIDE + GAP, 9);

  const m0 = h0 & 127;
  const m1 = h1 & 127;
  const block = SIDE / grid;
  const per = 64 / (grid * grid);
  const dot = Math.max(4, Math.round(block * 0.34));

  for (let t = 0; t < 2; t++) {
    const ox = t * (SIDE + GAP);
    for (let b = 0; b < grid * grid; b++) {
      const first = t * 64 + b * per;
      const last = first + per - 1;
      const x = ox + (b % grid) * block;
      const y = 16 + ((b / grid) | 0) * block;

      let r = 0;
      let g = 0;
      let bl = 0;
      for (let i = 0; i < per; i++) {
        const v = tape[first + i];
        r += BYTE_R[v];
        g += BYTE_G[v];
        bl += BYTE_B[v];
      }
      ctx.fillStyle = `rgb(${(r / per) | 0},${(g / per) | 0},${(bl / per) | 0})`;
      ctx.fillRect(x + 0.5, y + 0.5, block - 1, block - 1);

      const inRange = (v: number) => v >= first && v <= last;
      const isH0 = inRange(m0);
      const isH1 = inRange(m1);

      if (per === 1) {
        if (isH0 || isH1) {
          ctx.fillStyle = isH0 && isH1 ? "#9333ea" : isH0 ? "#0891b2" : "#b91c1c";
          ctx.fillRect(x + 0.5, y + 0.5, block - 1, block - 1);
        }
      } else {
        if (isH0) {
          ctx.fillStyle = "#0891b2";
          ctx.fillRect(x + 2, y + 2, dot, dot);
        }
        if (isH1) {
          ctx.fillStyle = "#b91c1c";
          ctx.fillRect(x + block - dot - 2, y + block - dot - 2, dot, dot);
        }
      }
      if (inRange(pc)) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1.5, y + 1.5, block - 3, block - 3);
        ctx.lineWidth = 1;
      }
    }
  }
}


const PAIR_BYTE = 30;
const PAIR_GAP = 14;

/**
 * The two 4x4 byte grids of one Z80 interaction (cell A ++ neighbour B), with
 * the program counter ringed. This is the "microscope" view the reference
 * shows on hover, and it needs no canvas scaling: every byte is exactly
 * PAIR_BYTE pixels.
 */
export function drawBytePair(
  canvas: HTMLCanvasElement,
  tape: Uint8Array,
  pc: number,
  side: number,
  labelA = "A",
  labelB = "B",
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const grid = side * PAIR_BYTE;
  const w = grid * 2 + PAIR_GAP;
  const h = grid + 16;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = ctx_muted_bg();
  ctx.fillRect(0, 0, w, h);
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillStyle = "#8e8c82";
  ctx.fillText(labelA, 1, 10);
  ctx.fillText(labelB, grid + PAIR_GAP + 1, 10);

  const bytes = side * side;
  for (let t = 0; t < 2; t++) {
    const ox = t * (grid + PAIR_GAP);
    for (let b = 0; b < bytes; b++) {
      const v = tape[t * bytes + b] ?? 0;
      const x = ox + (b % side) * PAIR_BYTE;
      const y = 16 + ((b / side) | 0) * PAIR_BYTE;
      const col = Z80_COLOR[v];
      ctx.fillStyle = `rgb(${col & 255},${(col >> 8) & 255},${(col >> 16) & 255})`;
      ctx.fillRect(x, y, PAIR_BYTE - 1, PAIR_BYTE - 1);
      // the byte value, small, in the corner
      const lum = ((col & 255) + ((col >> 8) & 255) + ((col >> 16) & 255)) / 3;
      ctx.fillStyle = lum > 110 ? "rgba(16,16,20,0.75)" : "rgba(245,244,239,0.62)";
      ctx.font = "9px ui-monospace, monospace";
      ctx.fillText(v.toString(16).padStart(2, "0"), x + 2, y + PAIR_BYTE - 4);
    }
  }
  // program counter
  const p = pc & (bytes * 2 - 1);
  if (p >= 0) {
    const t = p < bytes ? 0 : 1;
    const b = p % bytes;
    const x = t * (grid + PAIR_GAP) + (b % side) * PAIR_BYTE;
    const y = 16 + ((b / side) | 0) * PAIR_BYTE;
    ctx.strokeStyle = "#f5f4ef";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, PAIR_BYTE - 3, PAIR_BYTE - 3);
    ctx.lineWidth = 1;
  }
}

/** the access map of one interaction: x = step, y = byte, red = write, green = read */
export function drawTrace(canvas: HTMLCanvasElement, trace: Uint8Array, steps: number, maxSteps: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = 256;
  const H = 96;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== W * dpr) {
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = ctx_muted_bg();
  ctx.fillRect(0, 0, W, H);

  const cols = maxSteps;
  const rows = 32;
  const cw = W / cols;
  const ch = (H - 10) / rows;
  for (let s = 0; s < steps; s++) {
    for (let b = 0; b < rows; b++) {
      const o = (rows * s + b) * 4;
      const wr = trace[o];
      const rd = trace[o + 1];
      if (!wr && !rd) continue;
      ctx.fillStyle = wr ? "rgba(217,119,87,0.85)" : "rgba(125,138,153,0.7)";
      ctx.fillRect(s * cw, b * ch, Math.max(1, cw), Math.max(1, ch));
    }
  }
  // the tape is A ++ B, so the upper half is this cell and the lower is the
  // neighbour: one faint rule marks the split
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(0, 16 * ch, W, 1);
  // what is left of the 128-step budget
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(steps * cw, 0, W - steps * cw, H);
  ctx.fillStyle = "#8e8c82";
  ctx.font = "9px ui-monospace, monospace";
  ctx.fillText("0 步", 1, H - 1);
  const tail = `第 ${steps} 步`;
  ctx.fillText(tail, W - ctx.measureText(tail).width - 2, H - 1);
}
