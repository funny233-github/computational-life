/**
 * The three formulas that tie the camera to the screen. They live on their own
 * so they can be tested without a canvas — mixing up their units (cells vs
 * bytes vs pixels) is exactly how the zoom used to drift off the cursor.
 *
 * Conventions:
 *   cell  pixels per *cell* (a cell is `side` bytes, so bytes are `cell/side`)
 *   cam   camera position, in cells
 *   ox    where cell 0 of the soup is drawn, in pixels
 *   d     a bitmap position, in pixels
 */

/** which (fractional) cell sits under bitmap position `d` */
export const cellAt = (cam: number, ox: number, cell: number, d: number) => cam + (d - ox) / cell;

/** the camera that puts fractional cell `c` back under bitmap position `d` */
export const camFor = (c: number, ox: number, cell: number, d: number) => c - (d - ox) / cell;

/**
 * destination rectangle of the single `drawImage` blit. `k` is pixels per
 * *source* pixel, which is per byte in byte mode and per cell in cell mode; the
 * camera is always in cells, so it must be scaled by `cell`, never by `k`.
 */
export function blitRect(
  camX: number,
  camY: number,
  ox: number,
  oy: number,
  cell: number,
  srcW: number,
  srcH: number,
  k: number,
): [number, number, number, number] {
  return [ox - camX * cell, oy - camY * cell, srcW * k, srcH * k];
}
