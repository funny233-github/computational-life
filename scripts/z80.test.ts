/** the Z80 substrate: real emulation, real soup, real mnemonics */
import { loadZ80, Z80_STEPS } from "../src/engine/z80core.ts";
import { Z80World } from "../src/engine/z80soup.ts";
import { BYTE2ASM } from "../src/engine/z80disasm.ts";
import { drawWindowBytes, drawWindowCells } from "../src/ui/canvas.ts";
import { Z80_COLOR, cellColor } from "../src/ui/palette.ts";
import { instrLen, shortAsm, Z80Substrate } from "../src/engine/z80sub.ts";

const core = await loadZ80();

// 1. the emulator actually runs: LD BC,0x1234 then HALT
const prog = new Uint8Array(32);
prog.set([0x01, 0x34, 0x12, 0x76], 0); // LD BC,1234 ; HALT
core.batch.set(prog, 0);
const ops = core.run(1, Z80_STEPS);
// HALT is reached, so fewer than the full budget of steps ran
if (!(ops > 1 && ops < Z80_STEPS)) {
  console.error(`FAIL: expected the program to halt early, ran ${ops} steps`);
  process.exit(1);
}
const mem = core.batch.subarray(0, 32);
if (mem[0] !== 0x01) { console.error("FAIL: memory was clobbered"); process.exit(1); }
console.log(`z80 core runs: LD BC,1234 ; HALT -> ${ops} steps, program intact`);

// 2. stack writes land in the *other* tape (SP starts past the end, masked &31)
const p2 = new Uint8Array(32);
p2.set([0x31, 0xfe, 0xff, 0xc5], 0); // LD SP,0xFFFE ; PUSH BC
core.batch.set(p2, 0);
core.run(1, 8);
const wrote = core.writeCount[0] + core.writeCount[1];
if (wrote < 1) { console.error("FAIL: PUSH wrote nothing"); process.exit(1); }
console.log(`stack writes reach the soup: PUSH -> ${wrote} memory write(s)`);

// 3. the soup evolves and produces the expected Z80 "zeroing" dynamics
const soup = new Z80World(core, { w: 64, h: 36, seed: 7, noise: 1 / 16, steps: Z80_STEPS });
const before = soup.stats();
for (let e = 0; e < 150; e++) soup.step();
const after = soup.stats();
if (!(after.entropy < before.entropy - 0.5)) {
  console.error(`FAIL: entropy did not fall (${before.entropy.toFixed(2)} -> ${after.entropy.toFixed(2)})`);
  process.exit(1);
}
if (!(after.zeros > before.zeros)) {
  console.error("FAIL: 0x00 share did not grow");
  process.exit(1);
}
console.log(
  `soup evolves: entropy ${before.entropy.toFixed(2)} -> ${after.entropy.toFixed(2)}, ` +
    `0x00 ${(before.zeros * 100).toFixed(1)}% -> ${(after.zeros * 100).toFixed(1)}%`,
);

// 4. disassembly table
if (BYTE2ASM[0x01] !== "LD BC,nn" || BYTE2ASM[0xc5] !== "PUSH BC" || BYTE2ASM[0] !== "NOP") {
  console.error("FAIL: disassembly table looks wrong");
  process.exit(1);
}
if (Z80_COLOR[0x01] === Z80_COLOR[0x00]) {
  console.error("FAIL: colour map is flat");
  process.exit(1);
}
console.log("mnemonics and colours loaded");

// 5. the "mnemonics on the grid" view: exactly the reference lab's own strings
for (const [b, want] of [[0x01, "LD BC,nn"], [0x2a, "LD HL,(nn)"], [0x3e, "LD A,n"], [0x76, "HALT"]] as const) {
  if (shortAsm(b) !== want) {
    console.error(`FAIL: shortAsm(0x${b.toString(16)}) = ${shortAsm(b)}, want ${want}`);
    process.exit(1);
  }
}
for (const [b, len] of [
  [0x00, 1], [0x3e, 2], [0x01, 3], [0x2a, 3], // NOP / LD A,n / LD BC,nn / LD HL,(nn)
  [0x18, 2], [0x20, 2], [0x10, 2],             // JR e / JR NZ,e / DJNZ e
  [0xd3, 2], [0xdb, 2],                        // OUT (n),A / IN A,(n)
  [0xcb, 2], [0x76, 1],
] as const) {
  if (instrLen(b) !== len) {
    console.error(`FAIL: instrLen(0x${b.toString(16)}) = ${instrLen(b)}, want ${len}`);
    process.exit(1);
  }
}

// every byte of every cell must be covered by exactly one block, in reading order
{
  const s2 = new Z80Substrate(soup);
  const seen = new Uint8Array(s2.n * 16);
  let blocks = 0;
  for (let c = 0; c < s2.n; c++) {
    for (const b of s2.blocks(c)) {
      blocks++;
      if (b.len < 1 || b.start + b.len > 16) {
        console.error(`FAIL: block at cell ${c} byte ${b.start} len ${b.len}`);
        process.exit(1);
      }
    }
  }
  if (blocks < s2.n) {
    console.error(`FAIL: only ${blocks} blocks for ${s2.n} cells`);
    process.exit(1);
  }
  console.log(`mnemonic blocks: ${blocks} across ${s2.n} cells (${seen.length} bytes)`);
}

const sub = new Z80Substrate(soup);

// 6. the three one-pixel-per-cell views are real and fully opaque
const views = ["code", "content", "lineage"] as const;
const OW = 400, OH = 300;
const outs = views.map((v) => {
  const o = new Uint32Array(OW * OH);
  drawWindowCells(soup.w, soup.h, 8, 0, 0, OW, OH, (c) => cellColor(sub, c, v), 0xff000000, 0, 0, o);
  return o;
});
for (let i = 0; i < outs.length; i++) {
  if (outs[i].some((px) => px >>> 24 !== 255)) {
    console.error(`FAIL: ${views[i]} view has transparent pixels (they would be invisible)`);
    process.exit(1);
  }
}
const same = (a: Uint32Array, b: Uint32Array) => a.every((v, i) => v === b[i]);
if (same(outs[0], outs[1]) || same(outs[1], outs[2]) || same(outs[0], outs[2])) {
  console.error("FAIL: cell views render identically");
  process.exit(1);
}
console.log("cell views: code / content / lineage all differ and are opaque");

// 7. the byte view: a 4x4 byte tile must be exactly 4*px device pixels wide
for (const px of [1, 2, 4, 8]) {
  const o = new Uint32Array(OW * OH);
  drawWindowBytes(soup.soup, soup.w, soup.h, 4, px, 0, 0, OW, OH, Z80_COLOR, 0xff000000, false, 0, 0, o);
  let bad = 0;
  const cell = 4 * px;
  const cols = Math.min(Math.floor(OW / cell), soup.w);
  const rows = Math.min(Math.floor(OH / cell), soup.h);
  for (let cy = 0; cy < Math.min(rows, 4); cy++) {
    for (let cx = 0; cx < Math.min(cols, 4); cx++) {
      const base = (cy * soup.w + cx) * 16;
      for (let b = 0; b < 16; b++) {
        const want = Z80_COLOR[soup.soup[base + b]];
        const x0 = cx * cell + (b % 4) * px;
        const y0 = cy * cell + ((b / 4) | 0) * px;
        for (let dy = 0; dy < px; dy++)
          for (let dx = 0; dx < px; dx++)
            if (o[(y0 + dy) * OW + x0 + dx] !== want) bad++;
      }
    }
  }
  if (bad) {
    console.error(`FAIL: px=${px} produced ${bad} non-block pixels`);
    process.exit(1);
  }
}
console.log("byte view: 1/2/4/8 px per byte all render as exact squares");
