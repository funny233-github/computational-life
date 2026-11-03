import type {
  Block,
  CellMode,
  ChartPoint,
  Insight,
  Listing,
  Microscope,
  PairPool,
  PoolInfo,
  Stat,
  Substrate,
} from "./substrate.ts";
import { Z80_PAIR, Z80_STEPS, Z80_TAPE, readRegisters, type Z80Core } from "./z80core.ts";
import { Z80World } from "./z80soup.ts";
import { BYTE2ASM, ED_NAME } from "./z80disasm.ts";
import { describe } from "./z80desc.ts";

/** how many bytes the instruction starting at `b` occupies */
export function instrLen(b: number): number {
  const name = BYTE2ASM[b];
  if (b === 0xcb || b === 0xed || b === 0xdd || b === 0xfd) return 2;
  if (/nn/.test(name)) return 3;
  // 8-bit immediates, displacements and relative jumps all eat one more byte
  if (/(,n|,d|,e)\b/.test(name) || / e$/.test(name) || /\([nd]\)/.test(name)) return 2;
  return 1;
}

/** one-line label for a whole instruction, ED-prefixed forms included */
export function asmText(b: number, next?: number): string {
  if (b === 0xed && next !== undefined) return `ED ${ED_NAME[next] ?? BYTE2ASM[next]}`;
  return BYTE2ASM[b];
}

/** the condition a branch tests, as a lowercase suffix ("JR NZ,e" -> "nz") */
function cond(name: string): string {
  const m = name.match(new RegExp("\\b(NZ|Z|NC|C|PO|PE|P|M)\\b"));
  return m ? m[1].toLowerCase() : "";
}

const ED_GLYPH: Record<string, string> = {
  LDI: "≫", LDIR: "≫", LDD: "≪", LDDR: "≪", CPIR: "≠≫", CPDR: "≠≪",
};

/**
 * The demo's own grid notation: a load reads "src→dst" (`nn→HL`, `D→L`,
 * `A→(nn)`), everything else is one glyph, and a byte that only carries an
 * operand is drawn as "▽". Exact disassembly text is what the microscope list
 * is for — this is the texture you read the soup by.
 *
 * Every glyph below was checked against a plain monospace stack (the reference
 * demo draws its own glyphs, so there is no table to copy): no tofu boxes.
 */
export function shortAsm(b: number, next?: number): string {
  const name = BYTE2ASM[b] ?? "?";
  if (b === 0xcb) return "CB";
  if (b === 0xdd) return "DD";
  if (b === 0xfd) return "FD";
  if (b === 0xed) return next === undefined ? "ED" : (ED_GLYPH[ED_NAME[next] ?? ""] ?? "ED");

  const ld = name.match(/^LD (.+),(.+)$/);
  if (ld) return `${ld[2]}→${ld[1]}`;

  if (name === "NOP") return "·";
  // +X / -X for the counters, up/down arrows are the stack
  if (name.startsWith("INC ")) return "+" + name.slice(4);
  if (name.startsWith("DEC ")) return "−" + name.slice(4);
  if (name.startsWith("PUSH ")) return "↑" + name.slice(5);
  if (name.startsWith("POP ")) return "↓" + name.slice(4);
  if (name.startsWith("ADD ")) return "±";
  if (name.startsWith("ADC ")) return "±c";
  if (name.startsWith("SUB ")) return "−";
  if (name.startsWith("SBC ")) return "−c";
  if (name.startsWith("AND ")) return "∧";
  if (name.startsWith("OR ")) return "∨";
  if (name.startsWith("XOR ")) return "⊕";
  if (name.startsWith("CP ")) return "≠";
  if (name.startsWith("JP ")) return "⇒" + cond(name);
  if (name.startsWith("JR ")) return "→" + cond(name);
  if (name.startsWith("DJNZ ")) return "↓⇒";
  if (name.startsWith("CALL ")) return "⇨" + cond(name);
  if (name.startsWith("RET")) return "⇐" + cond(name);
  if (name.startsWith("RST ")) return "⇐" + name.slice(4, 5);
  if (name === "EX" || name.startsWith("EX ")) return "⇄";
  if (name === "EXX") return "⇄";
  if (name === "RLCA" || name === "RLA") return "◀";
  if (name === "RRCA" || name === "RRA") return "▶";
  if (name === "SCF") return "▣"; // carry set
  if (name === "CCF") return "□"; // carry flipped
  if (name === "DAA") return "▨"; // decimal adjust

  if (name === "CPL") return "~";
  if (name === "DI") return "⊘";
  if (name === "EI") return "⊙";
  if (name === "HALT") return "■";
  if (name.startsWith("OUT ")) return "▷";
  if (name.startsWith("IN ")) return "◁";
  return name;
}

/**
 * Glyph -> meaning, for the legend under the microscope. Kept next to the
 * table above so the two can never drift apart.
 */
export const GRID_LEGEND: [string, string][] = [
  ["src→dst", "装入（nn 立即数 · n 立即数 · (xx) 内存）"],
  ["▽", "上一条指令的操作数"],
  ["·", "空操作 NOP"],
  ["+B −B", "自增 / 自减"],
  ["↑BC ↓BC", "入栈 / 出栈"],
  ["± ±c", "加 / 带进位加"],
  ["− −c", "减 / 带进位减"],
  ["∧ ∨ ⊕", "与 / 或 / 异或"],
  ["≠", "比较 CP"],
  ["⇒ →", "绝对跳转 / 相对跳转（后缀是条件）"],
  ["⇨ ⇐", "调用 / 返回"],
  ["↓⇒", "计数循环 DJNZ"],
  ["⇄", "交换"],
  ["◀ ▶", "循环 / 移位 左 · 右"],
  ["▣ □ ▨ ~", "置进位 / 翻转进位 / 十进制调整 / 取反"],
  ["⊘ ⊙", "关 / 开中断"],
  ["▷ ◁", "端口写 / 读"],
  ["■", "停机 HALT"],
  ["≫ ≪", "块传送（LDI/LDIR · LDD/LDDR）"],
];

/** instruction family, for the one-pixel-per-cell "code" view */
const Z80_CLASS = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  const m = (BYTE2ASM[i] || "").split(" ")[0];
  if (i === 0x00) Z80_CLASS[i] = 0;
  else if (m === "LD" || m === "EX" || m === "EXX" || m === "LDI" || m === "LDD") Z80_CLASS[i] = 1;
  else if (m === "PUSH" || m === "POP" || m === "RET" || m === "JP" || m === "JR" ||
           m === "CALL" || m === "DJNZ" || m === "HALT" || m === "RST") Z80_CLASS[i] = 2;
  else if (m === "LDIR" || m === "LDDR" || m === "CPIR" || m === "CPDR" || m === "ED") Z80_CLASS[i] = 3;
  else Z80_CLASS[i] = 4;
}

const CELL = 16;

/**
 * Replays one interaction (cell ++ right neighbour) from step 0 and lets the
 * frontend scrub through it. `z80_trace` restarts the CPU from the tape each
 * call, so "run N steps" is just "reset and run N".
 */
export class Z80Microscope implements Microscope {
  readonly maxSteps = Z80_STEPS;
  readonly trace = new Uint8Array(Z80_PAIR * Z80_STEPS * 4);
  tape = new Uint8Array(Z80_PAIR);
  steps = 0;
  pc = 0;
  sp = 0;
  h0 = -1;
  h1 = -1;
  writes = 0;
  private saved = new Uint8Array(Z80_PAIR);
  private core: Z80Core;

  constructor(core: Z80Core, a: Uint8Array, b: Uint8Array) {
    this.core = core;
    this.saved.set(a.subarray(0, Z80_TAPE), 0);
    this.saved.set(b.subarray(0, Z80_TAPE), Z80_TAPE);
    this.setSteps(0);
  }

  setSteps(n: number) {
    const k = Math.max(0, Math.min(this.maxSteps, n | 0));
    const batch = this.core.batch;
    batch.set(this.saved);
    this.core.trace(k);
    this.tape.set(batch.subarray(0, Z80_PAIR));
    this.trace.set(this.core.traceVis.subarray(0, this.trace.length));
    this.steps = k;
    // z80 struct: 5 pointers (20) + unsigned long cyc (4) then pc, sp
    const st = this.core.state;
    this.pc = st[24] | (st[25] << 8);
    this.sp = st[26] | (st[27] << 8);
    this.writes = this.core.writeCount[0] + this.core.writeCount[1];
  }

  /** the eight main registers, the stack/pointer pair, and the byte at (HL) */
  registers(): { name: string; value: string }[] {
    const r = readRegisters(this.core);
    const hex = (v: number, w: number) => `0x${v.toString(16).padStart(w, "0")}`;
    const hl = (r.h << 8) | r.l;
    return [
      { name: "A", value: hex(r.a, 2) },
      { name: "F", value: hex(r.f, 2) },
      { name: "B", value: hex(r.b, 2) },
      { name: "C", value: hex(r.c, 2) },
      { name: "D", value: hex(r.d, 2) },
      { name: "E", value: hex(r.e, 2) },
      { name: "H", value: hex(r.h, 2) },
      { name: "L", value: hex(r.l, 2) },
      { name: "(HL)", value: hex(this.tape[hl & 31], 2) },
      { name: "SP", value: hex(r.sp, 4) },
      { name: "PC", value: hex(r.pc, 4) },
    ];
  }

  /** what the instruction under pc is about to do, with live values */
  insight(): Insight {
    const r = readRegisters(this.core);
    const at = r.pc & 31;
    const next = this.tape[(at + 1) & 31];
    return {
      ...describe(this.tape[at], next, r, this.tape),
      glyph: shortAsm(this.tape[at], next),
    };
  }
}

export class Z80Substrate implements Substrate {
  readonly kind = "z80" as const;
  readonly side = 4;
  readonly w: number;
  readonly h: number;
  readonly n: number;
  private z: Z80World;
  private pool: PairPool | null;
  private spawn: ((n: number) => PairPool | null) | null;
  private scopeCore: Z80Core | null;
  /** serialises step/reset/paint so a user write cannot land mid-epoch */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    z: Z80World,
    pool: PairPool | null = null,
    spawn: ((n: number) => PairPool | null) | null = null,
    scopeCore: Z80Core | null = null,
  ) {
    this.z = z;
    this.pool = pool;
    this.spawn = spawn;
    this.scopeCore = scopeCore;
    this.w = z.w;
    this.h = z.h;
    this.n = z.n;
  }
  private runExclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  get sync() {
    // until the workers are up we simply do the work here
    return this.pool === null || !this.pool.ready;
  }
  step(): Promise<boolean> {
    return this.runExclusive(async () => {
      if (!this.pool || !this.pool.ready) {
        this.z.step();
        return true;
      }
      const pool = this.pool;
      const ok = await pool.step();
      // `false` means "this epoch was dropped": either the pool is dead
      // (degraded) or the worker set was replaced mid-epoch. Only the first case
      // may cost us the pool — the second one just restarted it.
      if (!ok && this.pool === pool && pool.degraded) this.pool = null;
      return ok;
    });
  }
  dispose() {
    this.pool?.dispose();
    this.pool = null;
  }
  poolInfo(): PoolInfo {
    return this.pool?.info ?? { cores: 1, parallel: false, reason: "单线程" };
  }
  setThreads(n: number): string {
    if (n <= 1) {
      const pool = this.pool;
      if (!pool) return "单线程（配对在主线程上跑）";
      // same rule as BFF: let the current epoch finish before the teardown
      void this.runExclusive(() => {
        pool.dispose();
        if (this.pool === pool) this.pool = null;
      });
      return "单线程（正在切换）";
    }
    if (this.pool) return this.pool.setThreads(n);
    if (!this.spawn) return "这个页面拿不到 SharedArrayBuffer，只能用单线程";
    try {
      const p = this.spawn(n);
      if (!p) return "这个页面拿不到 SharedArrayBuffer，只能用单线程";
      this.pool = p;
      return p.info.reason;
    } catch (e) {
      return "并行启动失败：" + (e as Error).message;
    }
  }
  get epoch() {
    return this.z.epoch;
  }
  stepSync() {
    this.z.step();
  }
  reset(seed?: number): Promise<void> {
    return this.runExclusive(() => this.z.reset(seed));
  }
  bytes() {
    return this.z.soup;
  }
  cellBytes(c: number) {
    return this.z.cellBytes(c);
  }
  paint(c: number, b: Uint8Array): Promise<void> {
    return this.runExclusive(() => this.z.paint(c, b));
  }
  configure(o: { noise?: number; steps?: number; radius?: number; mixed?: boolean; density?: number }) {
    // Z80 has no radius/density/mixed knobs in the reference; they are hidden
    // in the UI and deliberately ignored here.
    if (o.noise !== undefined) this.z.noise = o.noise;
    if (o.steps !== undefined) this.z.steps = o.steps;
  }

  stats(): Stat[] {
    const s = this.z.stats();
    const writes = this.z.writes.reduce((a, b) => a + b, 0);
    return [
      { label: "熵", value: s.entropy.toFixed(2), hint: "比特 / 字节" },
      { label: "0x00", value: (s.zeros * 100).toFixed(1) + "%", hint: "空操作占比" },
      {
        label: "最常见",
        value: `0x${s.topByte.toString(16).padStart(2, "0")}`,
        hint: `${(s.topShare * 100).toFixed(1)}% 的字节`,
      },
      { label: "写入", value: String(writes), hint: "本轮内存写次数" },
    ];
  }
  chart(): ChartPoint {
    const s = this.z.stats();
    return { primary: s.topShare, secondary: s.entropy / 8 };
  }
  chartLabels(): [string, string] {
    return ["最常见字节占比", "熵 / 8"];
  }

  listing(c: number): Listing[] {
    const bytes = this.cellBytes(c);
    const out: Listing[] = [];
    let i = 0;
    while (i < bytes.length) {
      const b = bytes[i];
      const len = Math.min(instrLen(b), bytes.length - i);
      // the two-byte ED prefix carries the block instructions
      const text = asmText(b, bytes[i + 1]);
      out.push({ offset: i, value: b, text: len > 1 ? `${text} (${len} 字节)` : text });
      i += len;
    }
    return out;
  }

  blocks(c: number): Block[] {
    const bytes = this.cellBytes(c);
    const out: Block[] = [];
    let i = 0;
    while (i < CELL) {
      const b = bytes[i];
      const len = Math.min(instrLen(b), CELL - i);
      out.push({ start: i, len, short: shortAsm(b, bytes[i + 1]) });
      i += len;
    }
    return out;
  }

  microscope(c: number): Microscope | null {
    if (!this.scopeCore) return null;
    return new Z80Microscope(this.scopeCore, this.cellBytes(c), this.cellBytes((c + 1) % this.n));
  }

  cellKey(c: number, mode: CellMode): number {
    const b = this.cellBytes(c);
    if (mode === "content") {
      let h = 0x811c9dc5;
      for (let i = 0; i < CELL; i++) h = Math.imul(h ^ b[i], 0x01000193);
      return (h >>> 24) & 0xff;
    }
    if (mode === "lineage") {
      return (Math.imul(b[0] + (b[1] << 8), 2654435761) >>> 26) & 0x3f;
    }
    const counts = new Uint8Array(5);
    for (let i = 0; i < CELL; i++) counts[Z80_CLASS[b[i]]]++;
    let best = 0;
    for (let k = 1; k < 5; k++) if (counts[k] > counts[best]) best = k;
    return best;
  }
}

export function createZ80(
  z: Z80World,
  pool: PairPool | null = null,
  spawn: ((n: number) => PairPool | null) | null = null,
  scopeCore: Z80Core | null = null,
): Z80Substrate {
  return new Z80Substrate(z, pool, spawn, scopeCore);
}

export { Z80_STEPS };
