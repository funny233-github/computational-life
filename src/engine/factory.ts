/** building an engine — the only module that reaches for the worker/wasm glue */
import { Pool } from "./pool.ts";
import { Z80_STEPS, loadZ80 } from "./z80core.ts";
import { Z80World } from "./z80soup.ts";
import { Z80Pool } from "./z80pool.ts";
import { autoCores } from "./index.ts";
import { createZ80 } from "./z80sub.ts";
import { BffSubstrate } from "./bffsub.ts";
import type { Substrate } from "./substrate.ts";

interface CreateOptions {
  kind: "z80" | "bff";
  w: number;
  h: number;
  seed: number;
  /** worker count; defaults to "one less than the machine" */
  threads?: number;
}

function hasSAB(): boolean {
  if (typeof SharedArrayBuffer === "undefined") return false;
  try {
    new SharedArrayBuffer(8); // file:// exposes the name but usually throws
    return true;
  } catch {
    return false;
  }
}

// Both causes look the same from here: the page is not cross-origin isolated.
// GitHub Pages (and any host that cannot send its own headers) is in this group.
const NO_SAB =
  "这个页面不是跨源隔离的，浏览器因此禁用 SharedArrayBuffer —— 本地用 npm run play（会发 COOP/COEP），静态托管改不了响应头，只能单线程";

export async function createSubstrate(o: CreateOptions): Promise<{ substrate: Substrate; info: string }> {
  const threads = Math.max(1, Math.min(8, o.threads ?? autoCores()));
  const sab = hasSAB();

  if (o.kind === "z80") {
    const base = { w: o.w, h: o.h, seed: o.seed, noise: 1 / 16, steps: Z80_STEPS };
    if (sab) {
      try {
        // the soup always lives in shared memory when we can, so that raising
        // the thread count later does not need a reset
        const core = await loadZ80();
        const scope = await loadZ80(); // its own instance: the microscope must not disturb the soup
        const { world, pool } = Z80Pool.build(base, threads > 1 ? threads : 1, core);
        const active = threads > 1 ? pool : null;
        const spawn = (n: number) => Z80Pool.attach(world, base, n);
        return {
          substrate: createZ80(world, active, spawn, scope),
          info: active ? active.info.reason : "单线程（拉到 2 线程以上就能并行）",
        };
      } catch (e) {
        const c1 = await loadZ80();
        const c2 = await loadZ80();
        return {
          substrate: createZ80(new Z80World(c1, base), null, null, c2),
          info: "并行启动失败：" + (e as Error).message,
        };
      }
    }
    const core = await loadZ80();
    const scope = await loadZ80();
    return { substrate: createZ80(new Z80World(core, base), null, null, scope), info: NO_SAB };
  }

  const base = {
    w: o.w,
    h: o.h,
    mutation: 1 / 4096,
    steps: 8192,
    radius: 2,
    mixed: false,
    density: 0,
    seed: o.seed,
  };
  const { soup, pool, info } = Pool.create(base, threads);
  // `spawn` is wired unconditionally: if it were only passed when the page
  // started single-threaded, dropping to 1 thread once would permanently lock
  // the substrate to the serial path ("no SharedArrayBuffer" on the way back).
  const spawn = sab ? (n: number) => Pool.attach(soup, base, n) : null;
  const active = threads > 1 && pool ? pool : null;
  if (!active) pool?.dispose();
  return {
    substrate: new BffSubstrate(soup, active, spawn),
    info: info.reason,
  };
}
