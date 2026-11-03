/**
 * The engine/frontend boundary.
 *
 * Everything in `src/engine` runs without a DOM: no canvas, no colours, no
 * pixels. It hands the frontend *data* — bytes, statistics, disassembly,
 * semantic keys — and the frontend decides how to paint it.
 */

export type CellMode = "code" | "content" | "lineage";

export interface Stat {
  label: string;
  value: string;
  hint: string;
}

export interface ChartPoint {
  /** 0..1 */
  primary: number;
  /** 0..1 */
  secondary: number;
}

/** one instruction / one byte, for the microscope list */
export interface Listing {
  offset: number;
  value: number;
  text: string;
}

/** one instruction block as laid out on the grid, for the text view */
export interface Block {
  start: number;
  len: number;
  short: string;
}

/**
 * What the instruction under pc is about to do. Plain data: the microscope
 * panel paints it, the engine only fills in the words.
 */
export interface Insight {
  /** the opcode byte itself */
  code: number;
  /** the one-glyph form used on the grid ("±", "nn→HL") */
  glyph: string;
  /** exact disassembly ("ADD A,B") */
  asm: string;
  family: string;
  /** register names this instruction reads / writes */
  reads: string[];
  writes: string[];
  /** a sentence: what it will do */
  text: string;
  /** what the values become */
  effect: string;
}

/** the interactive single-cell stepper shown under the soup */
export interface Microscope {
  /** the tape as it is after `steps` steps (32 bytes for Z80, 128 for BFF) */
  readonly tape: Uint8Array;
  readonly pc: number;
  readonly h0: number;
  readonly h1: number;
  readonly sp?: number;
  readonly writes?: number;
  /** 0 = not a scrubber */
  readonly maxSteps?: number;
  readonly steps?: number;
  setSteps?(n: number): void;
  /** 32 x maxSteps access map, RGBA (channel 0 = write, 1 = read) */
  readonly trace?: Uint8Array;
  step?(): void;
  /** A+B  <->  B+A */
  swap?(): void;
  /** the instruction the pc sits on, with live values filled in */
  insight?(): Insight | null;
  /** the register file as it stands right now */
  registers?(): { name: string; value: string }[];
}

/** what the UI is allowed to know about parallelism */
export interface PoolInfo {
  cores: number;
  parallel: boolean;
  reason: string;
}

/** a worker pool that runs one epoch's independent pairs */
export interface PairPool {
  info: PoolInfo;
  /** false until every worker has finished booting (compiling wasm, etc.) */
  readonly ready: boolean;
  /** true once the pool gave up; a restart does *not* set it */
  readonly degraded: boolean;
  step(): Promise<boolean>;
  setThreads(n: number): string;
  dispose(): void;
}

export interface Substrate {
  readonly kind: "z80" | "bff";
  readonly w: number;
  readonly h: number;
  readonly n: number;
  /** bytes per cell side: 4 for Z80 (4x4), 8 for BFF (8x8) */
  readonly side: number;
  readonly epoch: number;
  /** true when step() runs synchronously (no worker pool in play) */
  readonly sync: boolean;

  step(): Promise<boolean> | boolean;
  stepSync(): void;
  /** queued behind any in-flight epoch, so it cannot race a worker write */
  reset(seed?: number): Promise<void>;

  /** all bytes, one program per cell, `side*side` bytes each */
  bytes(): Uint8Array;
  cellBytes(c: number): Uint8Array;
  /** queued behind any in-flight epoch, so the nucleus is not overwritten */
  paint(c: number, bytes: Uint8Array): Promise<void>;

  stats(): Stat[];
  chart(): ChartPoint;
  chartLabels(): [string, string];

  /** one line per instruction, for the microscope */
  listing(c: number): Listing[];
  /** the same, laid out for the "mnemonics on the grid" view */
  blocks(c: number): Block[];

  /**
   * A small integer that identifies a program for the one-pixel-per-cell views.
   * code: instruction class 0..4; content: 0..255; lineage: 0..63.
   * Turning that into a colour is the frontend's job.
   */
  cellKey(c: number, mode: CellMode): number;

  /**
   * Live parameters. `noise`/`steps` apply to the next instruction run,
   * `radius`/`mixed` to the next plan, `density` only to the next reset
   * (it seeds the initial bytes). Substrates ignore what they do not have.
   */
  configure(o: {
    noise?: number;
    steps?: number;
    /** interaction radius; 0 means "well mixed" (the 0-D soup) */
    radius?: number;
    mixed?: boolean;
    /** probability that an initial byte is an instruction (reset only) */
    density?: number;
  }): void;

  /** BFF only: an interactive tape for the microscope */
  microscope?(c: number): Microscope | null;

  /** a program worth seeding by hand, if the substrate has one */
  preset?(): Uint8Array;

  /** stop every worker; the substrate is unusable afterwards */
  dispose?(): void;

  /** how the epoch is spread over cores, if the substrate can do that */
  poolInfo?(): PoolInfo;
  /** change the worker count; returns a human-readable status */
  setThreads?(n: number): string;
}
