/**
 * The zoom maths, checked without a browser. The bug this guards against: the
 * blit offset was scaled by `k` (pixels per source pixel) instead of by the
 * cell size, so in byte mode — where k is per byte — the picture slid away from
 * the cursor while the camera itself looked correct.
 */
import { blitRect, camFor, cellAt } from "../src/ui/geometry.ts";

let fails = 0;
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
const check = (name: string, ok: boolean) => {
  if (!ok) {
    fails++;
    console.error(`FAIL: ${name}`);
  }
};

// 1. the blit must place every cell where the camera says it is, in both modes
for (const mode of ["bytes", "cells"] as const) {
  const side = 4;
  const w = 96;
  const h = 54;
  const ox = 52;
  const oy = 7;
  for (const cell of [4, 6.907, 18.04, 60.5]) {
    const px = cell / side; // pixels per byte
    const k = mode === "bytes" ? px : cell; // pixels per source pixel
    const srcW = mode === "bytes" ? w * side : w;
    const srcH = mode === "bytes" ? h * side : h;
    for (const camX of [0, 17.372, 45.6]) {
      const [bx] = blitRect(camX, 0, ox, oy, cell, srcW, srcH, k);
      // where the model says cell `c` of the soup is drawn
      const want = ox + (26 - camX) * cell;
      // where the blit actually puts it: `side` source pixels per cell in byte mode
      const got = bx + 26 * (mode === "bytes" ? side : 1) * k;
      check(`blit ${mode} cell=${cell} cam=${camX}`, near(got, want, 1e-6));
    }
  }
}

// 2. pointerAt and anchor must be exact inverses, whatever the letterboxing
for (const cell of [4, 6.907, 18.04]) {
  for (const ox of [0, 52, 137]) {
    for (const dx of [0, 260, 968]) {
      for (const camX of [0, 9.5, 45.6]) {
        const fx = cellAt(camX, ox, cell, dx);
        const cam2 = camFor(fx, ox, cell, dx);
        check(`inverse cell=${cell} ox=${ox} dx=${dx}`, near(cam2, camX));
      }
    }
  }
}

// 3. zooming around a point keeps that cell under it, even when ox flips to 0
{
  const soupW = 96;
  const stageW = 968;
  const oxFor = (cell: number) => Math.max(0, (stageW - soupW * cell) / 2);
  const dx = 300;
  const before = { cell: 6.907, cam: 0 };
  const fx = cellAt(before.cam, oxFor(before.cell), before.cell, dx);
  const after = { cell: 18.04 };
  const cam2 = camFor(fx, oxFor(after.cell), after.cell, dx);
  const back = cellAt(cam2, oxFor(after.cell), after.cell, dx);
  check("letterbox -> zoomed keeps the cell", near(back, fx));
  check("letterbox -> zoomed moves the camera", near(cam2, fx - dx / after.cell) && cam2 > 0);
}

console.log(fails === 0 ? "zoom maths: ok" : `zoom maths: ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
