import InlineWorker from "./z80worker?worker&inline";
import { sameOriginWorker } from "./workerFactory.ts";
import { Z80World, type Z80Options } from "./z80soup.ts";
import type { Z80Core } from "./z80core.ts";
import type { PairPool, PoolInfo } from "./substrate.ts";

/**
 * Runs the Z80 soup's pair slices on several workers. The plan and the
 * mutation flips stay on the main thread, so the result is bit-identical to
 * the serial path for the same seed.
 */
export class Z80Pool implements PairPool {
  info: PoolInfo;
  private world: Z80World;
  private opts: Z80Options;
  private state: SharedArrayBuffer;
  private writesSAB: SharedArrayBuffer;
  private planSAB: SharedArrayBuffer;
  private workers: Worker[] = [];
  private done = 0;
  private readyCount = 0;
  /** bumped whenever the workers are replaced, so stale barriers are ignored */
  private gen = 0;
  private pendingCores = 0;
  private threadTimer = 0;
  private onReady: (() => void) | null = null;
  private waiting: (() => void) | null = null;
  private timer = 0;
  degraded = false;

  /** start workers over a world that already lives in shared memory */
  static attach(world: Z80World, opts: Z80Options, cores: number): Z80Pool | null {
    if (!world.state || !world.writesBuffer) return null;
    const planSAB = new SharedArrayBuffer(8192 * 2 * 4);
    return new Z80Pool(world, opts, world.state, world.writesBuffer, planSAB, cores);
  }

  static build(
    opts: Z80Options,
    cores: number,
    core: Z80Core,
  ): { world: Z80World; pool: Z80Pool | null; info: PoolInfo } {
    const state = new SharedArrayBuffer(Z80World.bufferSize(opts.w * opts.h));
    const writesSAB = new SharedArrayBuffer(opts.w * opts.h * 4);
    // the main thread keeps its own core: dropping to one thread (or a worker
    // dying) must fall back to real serial work, not to a no-op
    const world = new Z80World(core, { ...opts, buffer: state, writesBuffer: writesSAB });
    const planSAB = new SharedArrayBuffer(8192 * 2 * 4);
    const pool = new Z80Pool(world, opts, state, writesSAB, planSAB, cores);
    if (cores < 2) {
      pool.dispose();
      return { world, pool: null, info: { cores: 1, parallel: false, reason: "单线程" } };
    }
    return { world, pool, info: pool.info };
  }

  private constructor(
    world: Z80World,
    opts: Z80Options,
    state: SharedArrayBuffer,
    writesSAB: SharedArrayBuffer,
    planSAB: SharedArrayBuffer,
    cores: number,
  ) {
    this.world = world;
    this.opts = opts;
    this.state = state;
    this.writesSAB = writesSAB;
    this.planSAB = planSAB;
    this.info = { cores, parallel: true, reason: `${cores} 个 worker 各跑一段配对` };
    this.spawn(cores);
  }

  private spawn(cores: number) {
    this.info = { cores, parallel: true, reason: `${cores} 个 worker 各跑一段配对` };
    this.gen++;
    this.done = 0;
    this.readyCount = 0;
    for (let i = 0; i < cores; i++) {
      const w = sameOriginWorker(InlineWorker);
      w.onerror = (ev: ErrorEvent) => {
        console.error("[z80 worker]", ev.message, ev.filename, ev.lineno);
        this.fail("worker 出错: " + ev.message);
      };
      w.onmessage = (e: MessageEvent) => {
        if (e.data.type === "error") {
          this.fail("worker 初始化失败：" + String(e.data.message));
          return;
        }
        if (e.data.type === "ready") {
          this.readyCount++;
          if (this.readyCount === this.workers.length) {
            this.onReady?.();
            this.onReady = null;
          }
          return;
        }
        if (e.data.type === "done") {
          if (++this.done === this.workers.length) this.release();
        }
      };
      w.postMessage({
        type: "init",
        state: this.state,
        writes: this.writesSAB,
        plan: this.planSAB,
        steps: this.opts.steps,
      });
      this.workers.push(w);
    }
  }

  /** change the worker count without touching the soup */
  setThreads(n: number): string {
    const cores = Math.max(1, Math.min(8, n | 0));
    if (this.degraded) return "并行已失效，重置后恢复";
    if (cores === this.workers.length) return this.info.reason;
    // replacing workers costs a wasm compile each; coalesce rapid changes
    this.pendingCores = cores;
    if (this.threadTimer) clearTimeout(this.threadTimer);
    this.threadTimer = setTimeout(() => {
      this.threadTimer = 0;
      const want = this.pendingCores;
      if (want === this.workers.length) return;
      try {
        this.dispose(false);
        this.degraded = false;
        this.spawn(want);
      } catch (e) {
        this.fail("启动 worker 失败：" + (e as Error).message);
      }
    }, 200) as unknown as number;
    return `${cores} 个 worker（正在切换）`;
  }

  private release() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = 0;
    }
    const r = this.waiting;
    this.waiting = null;
    r?.();
  }

  private fail(why: string) {
    console.error("[z80 pool]", why);
    if (this.degraded) return;
    this.degraded = true;
    this.info.reason = `${why}，已退回单线程`;
    this.dispose();
    const ready = this.onReady;
    this.onReady = null;
    ready?.();
    this.release();
  }

  /** wait until every worker has compiled its wasm (no timeout: this is startup) */
  get ready(): boolean {
    return this.workers.length > 0 && this.readyCount === this.workers.length;
  }

  private whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve) => {
      this.onReady = resolve;
      // never hang the whole page on a worker that fails to boot
      setTimeout(() => this.fail("worker 启动超时"), 15000);
    });
  }

  async step(): Promise<boolean> {
    await this.whenReady();
    if (this.degraded) return false;
    const plan = new Int32Array(this.planSAB, 0, 8192 * 2);
    const gen = this.gen;
    const pairN = this.world.planInto(plan);
    this.done = 0;
    const cores = this.workers.length;
    const chunk = Math.ceil(pairN / cores) || 1;

    const barrier = new Promise<void>((resolve) => {
      this.waiting = resolve;
    });
    this.timer = setTimeout(() => this.fail("worker 超时未应答（第一轮可能需要编译 wasm）"), 8000) as unknown as number;
    let sent = 0;
    for (let i = 0; i < cores; i++) {
      const p0 = i * chunk;
      const p1 = Math.min(pairN, p0 + chunk);
      if (p0 >= pairN) {
        // still answer, so the barrier count stays honest
        this.workers[i].postMessage({ type: "epoch", p0: 0, p1: 0, steps: this.opts.steps });
        sent++;
        continue;
      }
      this.workers[i].postMessage({ type: "epoch", p0, p1, steps: this.opts.steps });
      sent++;
    }
    void sent;
    await barrier;
    // the worker set was replaced (or the pool disposed) while we waited
    if (gen !== this.gen || this.degraded) return false;
    this.world.finishEpoch(pairN);
    return true;
  }

  dispose(final = true) {
    this.gen++;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.degraded = true;
    if (final) this.info.reason = "已停止";
    const ready = this.onReady;
    this.onReady = null;
    ready?.();
    this.release(); // nobody is going to answer a disposed pool
  }
}


