import { Soup, type SoupOptions } from "./soup.ts";
import WorkerCtor from "./worker?worker";

import type { PoolInfo } from "./substrate.ts";
export type { PoolInfo };

/**
 * Spreads one epoch's pairs across N workers that all read and write the same
 * SharedArrayBuffer. Pairs never overlap, so no locking is needed; the
 * postMessage round-trip is the barrier.
 *
 * Every epoch message carries the epoch/seed/mutation/steps the workers must
 * adopt. A worker that kept its own counters would mutate with a frozen epoch
 * (the same draws every round) and would never see a slider change.
 */
export class Pool {
  soup: Soup;
  info: PoolInfo;
  private opts: Omit<SoupOptions, "buffer">;
  private state: SharedArrayBuffer;
  private workers: Worker[] = [];
  private planBuf: SharedArrayBuffer;
  private done = 0;
  private readyCount = 0;
  private gen = 0;
  private pendingCores = 0;
  private threadTimer = 0;
  private opsSum = 0;
  private waiting: (() => void) | null = null;
  private timer = 0;
  /** a thread change that arrived mid-epoch, applied as soon as it is safe */
  private respawnAfter: number | null = null;
  private respawnTimer = 0;
  /** flipped if a worker dies or never answers: the caller must fall back */
  degraded = false;

  /** (re)start workers over a soup that already lives in shared memory */
  static attach(soup: Soup, opts: Omit<SoupOptions, "buffer">, cores: number): Pool | null {
    if (!(soup.buffer instanceof SharedArrayBuffer)) return null;
    return new Pool(soup, opts, soup.buffer, cores);
  }

  get ready(): boolean {
    return this.workers.length > 0 && this.readyCount === this.workers.length;
  }

  setThreads(n: number): string {
    const cores = Math.max(1, Math.min(8, n | 0));
    if (this.degraded) return "并行已失效，重置后恢复";
    if (cores === this.workers.length) return this.info.reason;
    this.pendingCores = cores;
    if (this.threadTimer) clearTimeout(this.threadTimer);
    this.threadTimer = setTimeout(() => {
      this.threadTimer = 0;
      const want = this.pendingCores;
      if (want === this.workers.length) return;
      // Never tear workers down mid-epoch: some pairs may already be written,
      // and the dropped epoch would be planned again on top of those writes.
      if (this.waiting) {
        this.respawnAfter = want;
        return;
      }
      this.respawn(want);
    }, 200) as unknown as number;
    return `${cores} 个 worker（正在切换）`;
  }

  static create(
    opts: Omit<SoupOptions, "buffer">,
    requested?: number,
  ): { soup: Soup; pool: Pool | null; info: PoolInfo } {
    const hw = typeof navigator === "undefined" ? 2 : (navigator.hardwareConcurrency ?? 2);
    const cores = Math.max(1, Math.min(8, requested ?? hw - 1));
    if (typeof SharedArrayBuffer === "undefined") {
      return {
        soup: new Soup(opts),
        pool: null,
        info: { cores: 1, parallel: false, reason: "没有 SharedArrayBuffer（file:// 下浏览器会禁用），单线程运行" },
      };
    }
    try {
      const state = new SharedArrayBuffer(Soup.bufferSize(opts.w * opts.h));
      const soup = new Soup({ ...opts, buffer: state });
      if (cores < 2) {
        return {
          soup,
          pool: null,
          info: { cores: 1, parallel: false, reason: "单线程（拉到 2 线程以上就能并行）" },
        };
      }
      const pool = new Pool(soup, opts, state, cores);
      return { soup, pool, info: pool.info };
    } catch (err) {
      return {
        soup: new Soup(opts),
        pool: null,
        info: { cores: 1, parallel: false, reason: `worker 启动失败：${err}` },
      };
    }
  }

  private constructor(
    soup: Soup,
    opts: Omit<SoupOptions, "buffer">,
    state: SharedArrayBuffer,
    cores: number,
  ) {
    this.soup = soup;
    this.opts = opts;
    this.state = state;
    this.planBuf = new SharedArrayBuffer(soup.n * 8);
    this.info = { cores, parallel: true, reason: `${cores} 个 worker 共享同一块内存` };
    this.spawn(cores);
  }

  private spawn(cores: number) {
    this.info = { cores, parallel: true, reason: `${cores} 个 worker 共享同一块内存` };
    this.gen++;
    this.done = 0;
    this.readyCount = 0;
    const opts = this.opts;
    const state = this.state;
    for (let i = 0; i < cores; i++) {
      const w = new WorkerCtor();
      w.onerror = () => this.fail("worker 出错");
      w.onmessage = (e: MessageEvent) => {
        if (e.data.type === "ready") {
          this.readyCount++;
          return;
        }
        if (e.data.type === "error") {
          this.fail("worker 出错：" + String(e.data.message));
          return;
        }
        if (e.data.type === "done") {
          this.opsSum += e.data.ops as number;
          if (++this.done === this.info.cores) this.release();
        }
      };
      w.postMessage({
        type: "init",
        opts,
        state,
        plan: this.planBuf,
        index: i,
        total: cores,
      } satisfies Record<string, unknown>);
      this.workers.push(w);
    }
  }

  private respawn(cores: number) {
    this.respawnAfter = null;
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = 0;
    }
    try {
      this.dispose(false);
      this.degraded = false;
      this.spawn(cores);
    } catch (e) {
      this.fail("启动 worker 失败：" + (e as Error).message);
    }
  }

  private release() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = 0;
    }
    const r = this.waiting;
    this.waiting = null;
    r?.();
    const next = this.respawnAfter;
    // Let the awaiting step() first record the epoch it just ran; replacing the
    // workers synchronously here would make it look dropped (`gen` changed),
    // and re-planning that epoch on top of its writes would double-apply it.
    if (next !== null && !this.degraded) this.scheduleRespawn(next);
  }

  private scheduleRespawn(cores: number) {
    this.respawnAfter = null;
    if (this.respawnTimer) clearTimeout(this.respawnTimer);
    this.respawnTimer = setTimeout(() => {
      this.respawnTimer = 0;
      if (!this.degraded) this.respawn(cores);
    }, 0) as unknown as number;
  }

  private fail(why: string) {
    if (this.degraded) return;
    this.degraded = true;
    this.info.reason = `${why}，已退回单线程`;
    this.info.parallel = false;
    this.info.cores = 1;
    this.dispose();
    this.release();
  }

  /** resolves false when the pool gave up and the caller should go serial */
  async step(): Promise<boolean> {
    const gen = this.gen;
    const pairs = new Int32Array(this.planBuf, 0, this.soup.n);
    const leftover = new Int32Array(this.planBuf, this.soup.n * 4, this.soup.n);
    const { np, nl } = this.soup.planInto(pairs, leftover);
    const params = this.soup.epochParams();
    this.done = 0;
    this.opsSum = 0;

    const barrier = new Promise<void>((resolve) => {
      this.waiting = resolve;
    });
    this.timer = setTimeout(() => this.fail("worker 超时未应答"), 4000) as unknown as number;
    for (const w of this.workers) w.postMessage({ type: "epoch", np, nl, params });
    await barrier;
    if (gen !== this.gen || this.degraded) return false;
    this.soup.finishEpoch(this.opsSum);
    return true;
  }

  dispose(final = true) {
    this.respawnAfter = null;
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = 0;
    }
    this.gen++;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.degraded = true;
    if (!final) this.info.reason = "正在切换 worker";
    this.release(); // nobody is going to answer a disposed pool
  }
}
