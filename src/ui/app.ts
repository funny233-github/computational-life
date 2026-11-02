/**
 * The frontend. It talks to the engine only through `Substrate`: it never
 * imports the interpreter, the soup or the wasm core.
 */
import type { Substrate, Microscope } from "../engine/index.ts";
import { createSubstrate } from "../engine/factory.ts";
import { decode, encode, GRID_LEGEND, maxCores, opChar, TAPE } from "../engine/index.ts";
import { byteColors, setTheme, type ViewMode } from "./palette.ts";
import type { Series } from "./chart.ts";
import { SoupCanvas } from "./canvas.ts";
import { drawChart } from "./chart.ts";
import { drawBytePair, drawLab, drawTrace } from "./lab.ts";

// last-resort visibility: if anything below throws, say so on the page instead
// of leaving a blank canvas
window.addEventListener("error", (e) => {
  const el = document.getElementById("hint");
  if (el) el.textContent = "出错了：" + e.message;
});

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("grid");
const view3d = new SoupCanvas(canvas);
const labCanvas = $<HTMLCanvasElement>("lab");
const labList = $<HTMLPreElement>("lab-list");
const traceCanvas = $<HTMLCanvasElement>("trace");
const chart = $<HTMLCanvasElement>("chart");
const progEl = $<HTMLTextAreaElement>("prog");

const MUTATIONS = [0, 1 / 4096, 1 / 2048, 0.001, 0.0024, 0.005, 0.01, 0.02, 0.05];
const NOISES = [0, 1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2];
const DENSITIES = [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75];

const W = 96;
const H = 54;

let world: Substrate | null = null;

let playing = true;
let epPerFrame = 16;
let view: ViewMode | "bytes" = "bytes";
let selected = Math.floor(H / 2) * W + Math.floor(W / 2);
let history: Series = { primary: [], secondary: [] };
let rateAt = performance.now();
let rateEpochs = 0;
let frameCount = 0;
let labGrid = 4;



/** how many screen pixels one byte gets: 1 (fit), 2 or 4 times the fit scale */
let zoomLevel = 1; // animated
let zoomTarget = 1; // what the wheel asked for
let zoomAnchor: [number, number, number, number] | null = null;

let dirty = true;
let lastDraw = 0;
/** set by the drag handler so the next animation frame repaints at once */
let panDirty = false;
let lastStatsEpoch = -1;
/** the world settings the sliders currently represent; a rebuild must keep them */
let mutValue = 1 / 16;
let stepsValue = 128;
/** bumped on every rebuild, so in-flight epochs from the old world are ignored */
let generation = 0;
let lastChartEpoch = -1;
/** set only under ?debug; null keeps the hot loop free of clock reads */
let debugStep: ((ms: number) => void) | null = null;

function resizeGrid() {
  if (world) {
    view3d.layout(world.w, world.h, world.side);
    view3d.setPx(view3d.fitPx() * zoomLevel);
  }
  // layout() recreates the bitmap, so whatever was on screen is gone
  dirty = true;
  if (world) draw();
}

let lastZoomT = 0;

/**
 * The animated zoom. Exponential smoothing in *time*, not per frame, so the
 * speed is the same on a 60Hz and a 144Hz display.
 */
function stepZoom(now: number): boolean {
  if (!world) return false;
  const dt = lastZoomT ? Math.min(64, Math.max(1, now - lastZoomT)) : 16;
  lastZoomT = now;
  if (Math.abs(zoomTarget - zoomLevel) < 0.0015) {
    if (zoomLevel === zoomTarget) {
      if (view3d.animating) {
        view3d.animating = false;
        draw(); // settle: one last pass with the mnemonics back on
      }
      return false;
    }
    zoomLevel = zoomTarget;
  } else {
    zoomLevel += (zoomTarget - zoomLevel) * (1 - Math.exp(-dt / 65));
  }
  view3d.setPx(view3d.fitPx() * zoomLevel);
  if (zoomAnchor) view3d.anchor(zoomAnchor[0], zoomAnchor[1], zoomAnchor[2], zoomAnchor[3]);
  dirty = true;
  return true;
}

function centerCamera() {
  if (!world) return;
  view3d.centerOn(selected);
}

function panCamera(dx: number, dy: number) {
  if (!world) return;
  view3d.pan(dx, dy);
  dirty = true;
}

function draw() {
  if (!world) return;
  view3d.draw(world, view, selected);
}

// ---------- microscope ----------

let scope: Microscope | null = null;
let labRunning = false;
let labSpeed = 4;
let labTotal = 0;

/**
 * The legend and the explainer under the microscope, per substrate. Both are
 * built from small groups so the eye can find one thing at a time: colours
 * first, then the notation, then how to read the thing.
 */
function buildLegend(kind: "z80" | "bff") {
  const box = $("legend");
  box.textContent = "";

  /** a caption plus a one-item-per-line list */
  const group = (caption: string): HTMLElement => {
    const wrap = document.createElement("section");
    wrap.className = "legend-group";
    const cap = document.createElement("p");
    cap.className = "cap";
    cap.textContent = caption;
    const list = document.createElement("ul");
    list.className = "kv";
    wrap.append(cap, list);
    box.append(wrap);
    return list;
  };

  /** a colour swatch, or (for the notation) a coded symbol, plus its label */
  const item = (list: HTMLElement, cls: string, text: string, code?: string) => {
    const li = document.createElement("li");
    li.className = `k ${cls}`;
    if (code) {
      const b = document.createElement("b");
      b.textContent = code;
      const span = document.createElement("span");
      span.textContent = text;
      li.append(b, span);
    } else {
      const span = document.createElement("span");
      span.textContent = text;
      li.append(span);
    }
    list.append(li);
  };

  const lines = (entries: string[]) => {
    const list = $<HTMLUListElement>("lab-note");
    list.textContent = "";
    for (const text of entries) {
      const li = document.createElement("li");
      li.textContent = text;
      list.append(li);
    }
  };

  if (kind === "z80") {
    const colours = group("颜色");
    item(colours, "pcz", "pc");
    item(colours, "b00", "0x00 NOP");
    item(colours, "b01", "0x01");
    item(colours, "b11", "0x11");
    item(colours, "b21", "0x21");
    item(colours, "bed", "0xed 前缀");
    item(colours, "ramp", "其他字节，越亮值越大");

    // the grid notation: loads read "src→dst", everything else one glyph
    const glyphs = group("记法");
    for (const [glyph, label] of GRID_LEGEND) item(glyphs, "t", label, glyph);

    lines([
      "纸带：选中格 ++ 右邻居，共 32 字节",
      "每次都从 pc=0 重跑，滑杆是「回放到第 N 步」",
      "下方列表与方块上的记法同源，都是 disz80",
      "跳转后缀 z / nz / c / nc / po / pe / p / m 是条件",
      "nn 是 16 位立即数，n 是 8 位立即数",
      "(xx) 表示内存间接寻址",
    ]);

    // the access map under the byte grids needs its own legend
    const trace = $("trace-legend");
    trace.textContent = "";
    const t = (cls: string, text: string) => {
      const el = document.createElement("span");
      el.className = `k ${cls}`;
      el.textContent = text;
      trace.append(el);
    };
    t("tw", "写");
    t("tr", "读");
    t("tp", "还没跑到的步");
    t("tt", "横轴 = 第几步，一行 = 一个字节");
    t("tt", "上半 = 本格，下半 = 右邻");
    return;
  }

  const cells = group("颜色");
  item(cells, "pc", "pc");
  item(cells, "h0", "head0");
  item(cells, "h1", "head1");
  item(cells, "cls1", "[ ]");
  item(cells, "cls2", "+ - . ,");
  item(cells, "cls3", "< > { }");
  item(cells, "cls4", "0x00");
  item(cells, "data", "数据，深浅 = 值");

  $("trace-legend").textContent = "";
  lines([
    "纸带：选中格 ++ 右邻居，共 128 字节",
    "只有前 64 字节会从 pc=0 执行",
    "所以 ⇄ 交换 是另一次反应",
    "8×8 是一块一字节，4×4 是一块四字节",
    "一次前进「每帧步数」条指令，严格单步就设成 1",
  ]);
}

function drawLabNow() {
  if (!world) return;
  if (world.kind === "z80") {
    labList.textContent = world
      .listing(selected)
      .map((l) => `${l.offset.toString(16).padStart(2, "0")}  ${l.value.toString(16).padStart(2, "0")}  ${l.text}`)
      .join("\n");
    labList.style.display = "";
    labCanvas.style.display = "";
    traceCanvas.style.display = "";
    $("lab-scrub").style.display = "";
    if (!scope || !scope.tape) return;
    drawBytePair(labCanvas, scope.tape, scope.pc, 4, "A 本格", "B 右邻");
    showInsight();
    if (scope.trace) drawTrace(traceCanvas, scope.trace, scope.steps ?? 0, scope.maxSteps ?? 128);
    const step = $<HTMLInputElement>("labstep");
    step.max = String(scope.maxSteps ?? 128);
    step.value = String(scope.steps ?? 0);
    $("labstep-v").textContent = String(scope.steps ?? 0);
    $("lab-state").textContent =
      `第 ${scope.steps ?? 0} / ${scope.maxSteps ?? 128} 步 · pc 0x${scope.pc.toString(16).padStart(4, "0")}` +
      ` · sp 0x${(scope.sp ?? 0).toString(16).padStart(4, "0")} · 写入 ${scope.writes ?? 0}`;
    return;
  }
  labList.style.display = "none";
  labCanvas.style.display = "";
  traceCanvas.style.display = "none";
  $("lab-scrub").style.display = "none";
  if (!scope) return;
  const off = scope.pc < 0 || scope.pc > 127;
  drawLab(labCanvas, scope.tape, off ? -1 : scope.pc, scope.h0, scope.h1, labGrid);
  const cmd = off ? "" : opChar(scope.tape[scope.pc]);
  $("lab-state").textContent =
    `${labTotal.toLocaleString()} 步  ·  每帧 ×${labSpeed}` +
    (off ? "  ·  已跑出纸带" : "") +
    `  —  pc ${off ? "—" : scope.pc} ${cmd}  h0 ${scope.h0 & 127}  h1 ${scope.h1 & 127}`;
}

/**
 * The instruction the pc sits on: the byte's own colour, its grid glyph, the
 * exact disassembly, the registers it touches (coloured + named), and a
 * sentence saying what it is about to do.
 */
function showInsight() {
  const box = $("insight");
  const ins = world?.kind === "z80" ? (scope?.insight?.() ?? null) : null;
  if (!ins) {
    box.style.display = "none";
    return;
  }
  box.style.display = "";

  const regs = scope?.registers?.() ?? null;
  const byte = ins.code;
  const col = byteColors("z80")[byte];
  const rgb = `rgb(${col & 255},${(col >> 8) & 255},${(col >> 16) & 255})`;
  const light = ((col & 255) + ((col >> 8) & 255) + ((col >> 16) & 255)) / 3 > 105;

  const chip = $("i-byte");
  chip.textContent = byte.toString(16).padStart(2, "0");
  chip.style.background = rgb;
  chip.style.color = light ? "#1b1a18" : "#e6e3dc";
  $("i-glyph").textContent = ins.glyph;
  $("i-asm").textContent = ins.asm;
  $("i-family").textContent = ins.family;

  // registers: name + value, coloured by which register it is
  const host = $("i-regs");
  host.textContent = "";
  for (const r of regs ?? []) {
    const el = document.createElement("span");
    const used = ins.writes.includes(r.name) ? " w" : ins.reads.includes(r.name) ? " r" : "";
    el.className = `reg rg-${r.name.toLowerCase()}${used}`;
    const n = document.createElement("b");
    n.textContent = r.name;
    const v = document.createElement("i");
    v.textContent = r.value;
    el.append(n, v);
    host.append(el);
  }

  // the flag bits, so a conditional jump stops being a mystery
  const fEl = $("i-flags");
  fEl.textContent = "";
  const fv = parseInt((regs ?? []).find((r) => r.name === "F")?.value ?? "0x0", 16);
  const bits: [string, number][] = [["S", 7], ["Z", 6], ["H", 4], ["P", 2], ["N", 1], ["C", 0]];
  for (const [name, bit] of bits) {
    const b = document.createElement("b");
    b.textContent = name;
    if ((fv >> bit) & 1) b.className = "on";
    fEl.append(b);
  }

  $("i-text").textContent = ins.text;
  $("i-effect").textContent = ins.effect;
}

function loadLab() {
  if (!world) return;
  const bytes = world.cellBytes(selected);
  const distinct = new Set(Array.from(bytes)).size;
  $("lab-cell").textContent =
    `格 ${selected % world.w},${Math.floor(selected / world.w)} · ${distinct} 种字节`;
  labTotal = 0;
  labRunning = false;
  $("lab-run").textContent = "▶ 运行";
  scope = world.microscope ? world.microscope(selected) : null;
  if (scope && world.kind === "bff") progEl.value = decode(scope.tape.subarray(0, TAPE));
  else $("lab-state").textContent = `${bytes.length} 字节 · 每格一条程序`;
  drawLabNow();
}

function advanceLab(n: number) {
  if (!scope) return;
  if (scope.setSteps) {
    scope.setSteps((scope.steps ?? 0) + n);
    drawLabNow();
    return;
  }
  for (let i = 0; i < n && scope.step; i++) scope.step();
  labTotal += n;
  progEl.value = decode(scope.tape.subarray(0, TAPE));
  drawLabNow();
}

// ---------- main loop ----------

function updateStats() {
  if (!world) return;
  lastStatsEpoch = world.epoch;
  const stats = world.stats();
  const host = $("stats");
  host.textContent = "";
  for (const s of stats) {
    const d = document.createElement("div");
    const l = document.createElement("label");
    l.textContent = s.label;
    const b = document.createElement("b");
    b.textContent = s.value;
    const sm = document.createElement("small");
    sm.textContent = s.hint;
    d.append(l, b, sm);
    host.append(d);
  }

  const [ln, ls] = world.chartLabels();
  const c = world.chart();
  $("lg-primary-name").textContent = ln;
  $("lg-primary").textContent = (c.primary * 100).toFixed(1) + "%";
  $("lg-secondary-name").textContent = ls;
  $("lg-secondary").textContent = (c.secondary * 100).toFixed(1) + "%";

  $("epoch").textContent = world.epoch.toLocaleString();
  $("hint").textContent = `格 ${selected % world.w},${Math.floor(selected / world.w)} · 空格暂停`;

  if (world.epoch !== lastChartEpoch) {
    lastChartEpoch = world.epoch;
    history.primary.push(c.primary);
    history.secondary.push(c.secondary);
    if (history.primary.length > 420) {
      history.primary.shift();
      history.secondary.shift();
    }
    drawChart(chart, history);
  }
}

let last = performance.now();
let rafId = 0;
let intervalId = 0;
let busy = false;

function tick(now: number) {
  if (busy || !world) return;
  if (world.sync) {
    tickSync(now);
    return;
  }
  busy = true;
  void (async () => {
    try {
      await tickBody(now);
    } finally {
      busy = false;
    }
  })();
}

function tickSync(now: number) {
  const w = world!;
  const dt = now - last;
  last = now;
  if (playing) {
    const budget = Math.max(4, Math.min(14, dt * 0.7));
    const t0 = performance.now();
    let n = 0;
    while (n < epPerFrame && performance.now() - t0 < budget) {
      if (debugStep) {
        const s0 = performance.now();
        w.stepSync();
        debugStep(performance.now() - s0);
      } else w.stepSync();
      n++;
    }
    rateEpochs += n;
  }
  afterSteps(now);
}

async function tickBody(now: number) {
  const w = world!;
  const dt = now - last;
  last = now;

  if (playing) {
    const budget = Math.max(4, Math.min(14, dt * 0.7));
    const t0 = performance.now();
    let n = 0;
    while (n < epPerFrame && performance.now() - t0 < budget) {
      if (debugStep) {
        const s0 = performance.now();
        await w.step();
        debugStep(performance.now() - s0);
      } else await w.step();
      if (world !== w) return; // the map was rebuilt under us
      n++;
    }
    rateEpochs += n;
  }
  afterSteps(now);
}

function afterSteps(now: number) {
  if (labRunning && world!.kind === "bff") advanceLab(labSpeed);

  if (now - rateAt > 500) {
    const r = (rateEpochs * 1000) / (now - rateAt);
    rateAt = now;
    rateEpochs = 0;
    $("rate").textContent = r.toFixed(0) + " 轮/秒";
  }

  if (!document.hidden) {
    // the bitmap is only a few hundred pixels wide now, but there is no point
    // repainting faster than the eye needs; paused, repaint only on demand
    if (playing) {
      if (now - lastDraw >= 32) {
        draw();
        lastDraw = now;
      }
    } else if (dirty) {
      draw();
      dirty = false;
    }
  }
  // the panel (and its chart) only advances when the soup does
  if (world && world.epoch !== lastStatsEpoch && ++frameCount % 8 === 0) updateStats();
}

function frame(now: number) {
  // zooming repaints immediately; waiting for the 30fps soup throttle made it
  // look like the picture jumped in steps
  if (stepZoom(now)) {
    draw();
    lastDraw = now;
  }
  // dragging is the same deal: follow the pointer on the next frame, not on the
  // next soup tick (which can be 30ms away and made panning feel stuck)
  if (panDirty) {
    draw();
    panDirty = false;
    lastDraw = now;
  }
  tick(now);
  rafId = requestAnimationFrame(frame);
}

// ---------- controls ----------

function bindRange(
  id: string,
  out: string,
  values: number[],
  fmt: (v: number) => string,
  apply: (v: number) => void,
) {
  const input = $<HTMLInputElement>(id);
  const o = $(out);
  const upd = () => {
    const idx = Math.min(values.length - 1, Math.max(0, Number(input.value) || 0));
    const v = values[idx];
    o.textContent = fmt(v);
    input.style.setProperty("--p", (idx / Math.max(1, values.length - 1)) * 100 + "%");
    apply(v);
  };
  input.max = String(values.length - 1);
  input.addEventListener("input", upd);
  upd();
}

/** swap in a new grid size, keeping the substrate kind and the thread count */
async function rebuild(w: number, h: number) {
  if (!world) return;
  const gen = ++generation;
  const old = world;
  const kind = old.kind;
  const threads = Number($<HTMLSelectElement>("threads").value) || undefined;
  const made = await createSubstrate({ kind, w, h, seed: (Math.random() * 1e9) | 0, threads });
  // a second change while we were building: drop this one
  if (gen !== generation) {
    made.substrate.dispose?.();
    return;
  }
  old.dispose?.();
  world = made.substrate;
  // keep whatever the sliders say, instead of the substrate defaults
  world.configure(kind === "z80" ? { noise: mutValue } : { noise: mutValue, steps: stepsValue });
  selected = Math.min(selected, world.n - 1);
  zoomLevel = 1;
  zoomTarget = 1;
  history = { primary: [], secondary: [] };
  lastStatsEpoch = -1;
  lastChartEpoch = -1;
  resizeGrid();
  centerCamera();
  loadLab();
  updateStats();
  dirty = true;
}

async function boot() {
  const kind = location.search.includes("bff") ? "bff" : "z80";
  const seed = (Math.random() * 1e9) | 0;
  const made = await createSubstrate({ kind, w: W, h: H, seed });
  world = made.substrate;

  $("mode").textContent = kind === "z80" ? "Z80" : "BFF";
  const isZ80 = kind === "z80";
  buildLegend(kind);
  // the display list depends on the substrate: a Z80 cell is 4x4 bytes, a BFF
  // cell is 8x8, so the same "zoom" means a different number of pixels per byte
  const display = $("display") as HTMLSelectElement;
  display.textContent = "";
  const choices: [string, string][] = [
    ["bytes:1", "字节 · 一格 4×4 / 8×8"],
    ["cell:code", "整格 · 指令类型"],
    ["cell:lineage", "整格 · 血统"],
  ];
  for (const [value, label] of choices) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    display.append(o);
  }
  display.value = "bytes:1";
  display.title = "滚轮缩放，拖动平移";
  $("mode").title = made.info;

  // map size: a rebuild, because the grid is baked into the buffers
  const sizeSel = $<HTMLSelectElement>("mapsize");
  const SIZES: [number, number, string][] = [
    [48, 27, "48 × 27"],
    [64, 36, "64 × 36"],
    [96, 54, "96 × 54（默认）"],
    [128, 72, "128 × 72"],
    [192, 108, "192 × 108"],
    [240, 135, "240 × 135（论文规模）"],
  ];
  for (const [w, h, label] of SIZES) {
    const o = document.createElement("option");
    o.value = `${w}x${h}`;
    o.textContent = label;
    sizeSel.append(o);
  }
  sizeSel.value = `${W}x${H}`;
  sizeSel.addEventListener("change", () => {
    const [nw, nh] = sizeSel.value.split("x").map(Number);
    void rebuild(nw, nh);
  });

  // how many cores the epoch is spread over
  const threadsSel = $<HTMLSelectElement>("threads");
  const note = $("threads-note");
  const max = maxCores();
  for (let n = 1; n <= max; n++) {
    const o = document.createElement("option");
    o.value = String(n);
    o.textContent = n === 1 ? "1 · 单线程" : `${n} 线程`;
    threadsSel.append(o);
  }
  const poolInfo = () => world!.poolInfo?.() ?? { cores: 1, parallel: false, reason: "单线程" };
  threadsSel.value = String(poolInfo().cores);
  note.textContent = made.info;
  const hw = navigator.hardwareConcurrency ?? 0;
  const sab = (() => {
    try {
      new SharedArrayBuffer(8);
      return true;
    } catch {
      return false;
    }
  })();
  const diag = `hardwareConcurrency ${hw} · SharedArrayBuffer ${sab ? "可用" : "不可用"} · crossOriginIsolated ${String(globalThis.crossOriginIsolated)}`;
  note.title = diag;
  if (!sab) note.classList.add("warn");
  else note.classList.remove("warn");
  console.log("[threads]", diag, "→", made.info);
  const want = Number((location.search.match(/threads=(\d+)/) ?? [])[1]);
  if (want >= 1) {
    note.textContent = world!.setThreads?.(want) ?? "这个基质不支持多线程";
    threadsSel.value = String(poolInfo().cores);
  }

  threadsSel.addEventListener("change", () => {
    const msg = world!.setThreads?.(Number(threadsSel.value)) ?? "这个基质不支持多线程";
    note.textContent = msg;
    if (!poolInfo().parallel && !msg.includes("正在切换")) note.classList.add("warn");
    else note.classList.remove("warn");
    threadsSel.value = String(poolInfo().cores);
    dirty = true;
  });

  // substrate-specific controls
  for (const id of ["density", "radius", "steps"]) {
    const row = $(id).closest(".row") as HTMLElement | null;
    if (row) row.style.display = isZ80 ? "none" : "";
  }
  for (const id of ["lab-run", "step", "swap", "labgrid", "prog", "preset", "paint"]) {
    const el = $(id);
    el.style.display = isZ80 ? "none" : "";
    const row = el.closest(".row") as HTMLElement | null;
    if (row) row.style.display = isZ80 ? "none" : "";
  }

  $("panels").addEventListener("click", () => {
    const hidden = document.body.classList.toggle("hide-aside");
    $("panels").textContent = hidden ? "⟨" : "⟩";
    $("panels").title = hidden ? "展开侧栏" : "收起侧栏";
    resizeGrid();
    draw();
  });

  $("play").addEventListener("click", () => {
    playing = !playing;
    dirty = true;
    $("play").textContent = playing ? "暂停" : "继续";
  });

  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
    if (e.code === "Space") {
      e.preventDefault();
      $("play").click();
      return;
    }
    const step = e.shiftKey ? 4 : 1;
    if (e.code === "ArrowLeft") panCamera(-step, 0);
    else if (e.code === "ArrowRight") panCamera(step, 0);
    else if (e.code === "ArrowUp") panCamera(0, -step);
    else if (e.code === "ArrowDown") panCamera(0, step);
    else return;
    e.preventDefault();
  });

  bindRange(
    "speed",
    "speed-v",
    Array.from({ length: 65 }, (_, i) => Math.max(1, Math.round(Math.pow(2, i / 6)))),
    (v) => String(v),
    (v) => {
      epPerFrame = v;
    },
  );

  bindRange(
    "mutation",
    "mutation-v",
    isZ80 ? NOISES : MUTATIONS,
    (v) => (isZ80 ? (v >= 1 ? v + "×" : "1/" + Math.round(1 / v)) : (v * 100).toFixed(3) + "%"),
    (v) => {
      mutValue = v;
      world?.configure({ noise: v });
    },
  );

  bindRange(
    "density",
    "density-v",
    DENSITIES,
    (v) => ((v + (1 - v) * 0.039) * 100).toFixed(1) + "%",
    () => {},
  );

  // the step budget only exists for BFF; Z80 always runs its 128 steps and a
  // rebuild must not push the hidden slider's value into it
  if (!isZ80) {
    bindRange(
      "steps",
      "steps-v",
      [64, 128, 256, 512, 1024, 2048, 4096, 8192],
      (v) => String(v),
      (v) => {
        stepsValue = v;
      },
    );
  }

  bindRange("radius", "radius-v", [0, 1, 2, 3, 4], (v) => (v === 0 ? "完全混匀" : String(v)), () => {});

  // remember where the pointer is: some trackpads deliver wheel events with no
  // position at all (0,0), and anchoring those would zoom towards the top-left
  let hover: [number, number] | null = null;
  canvas.addEventListener("pointermove", (e) => {
    hover = [e.clientX, e.clientY];
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      let [px, py] = [e.clientX, e.clientY];
      if (!px && !py) {
        if (hover) [px, py] = hover;
        else {
          const r = canvas.getBoundingClientRect();
          [px, py] = [r.left + r.width / 2, r.top + r.height / 2];
        }
      }
      zoomAnchor = view3d.pointerAt(px, py);
      const f = Math.exp(-e.deltaY * 0.0016);
      zoomTarget = Math.max(1, Math.min(28, zoomTarget * f));
      view3d.animating = true;
      dirty = true;
    },
    { passive: false },
  );

  $<HTMLSelectElement>("display").addEventListener("change", (e) => {
    const [kindOf, val] = (e.target as HTMLSelectElement).value.split(":");

    dirty = true;
    if (kindOf === "bytes") {
      view = "bytes";
      resizeGrid();
      centerCamera();
    } else {
      view = val as ViewMode;
      resizeGrid();
      centerCamera();
    }
  });

  $<HTMLSelectElement>("theme").addEventListener("change", (e) => {
    setTheme((e.target as HTMLSelectElement).value as "dark" | "light");
    document.body.dataset.palette = (e.target as HTMLSelectElement).value;
    dirty = true;
    drawLabNow();
  });

  $<HTMLSelectElement>("labspeed").addEventListener("change", (e) => {
    labSpeed = Number((e.target as HTMLSelectElement).value);
    $("step").textContent = "单步 ×" + labSpeed;
    drawLabNow();
  });

  $<HTMLSelectElement>("labgrid").addEventListener("change", (e) => {
    labGrid = Number((e.target as HTMLSelectElement).value);
    drawLabNow();
  });

  $("reset").addEventListener("click", () => {
    world!.reset((Math.random() * 1e9) | 0);
    history = { primary: [], secondary: [] };
    lastChartEpoch = -1;
    lastStatsEpoch = -1;
    dirty = true;
    updateStats();
  
    history = { primary: [], secondary: [] };
    loadLab();
  });

  // drag to pan; a drag must not count as a click on a cell
  let dragFrom: [number, number] | null = null;
  let dragged = false;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragFrom = [e.clientX, e.clientY];
    dragged = false;
    // capture keeps the drag alive when the pointer leaves the stage; a
    // synthetic event (or a browser without capture) may throw, which is fine
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragFrom) return;
    const dx = e.clientX - dragFrom[0];
    const dy = e.clientY - dragFrom[1];
    if (!dragged && Math.abs(dx) + Math.abs(dy) < 4) return;
    dragged = true;
    dragFrom = [e.clientX, e.clientY];
    const k = view3d.cellPx() || 1;
    view3d.pan(-dx / k, -dy / k);
    // mnemonics cost more than the whole blit, so they sit out the drag and
    // come back once on release
    view3d.panning = true;
    panDirty = true;
    dirty = true;
  });
  const endDrag = () => {
    dragFrom = null;
    if (view3d.panning) {
      view3d.panning = false;
      draw();
      dirty = false;
    }
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  canvas.addEventListener("click", (e) => {
    if (dragged) {
      dragged = false;
      return;
    }
    const w = world!;
    const c = view3d.cellAt(e.clientX, e.clientY);
    const x = c % w.w;
    const y = Math.floor(c / w.w);
    if (x < 0 || y < 0 || x >= w.w || y >= w.h) return;
    selected = y * w.w + x;
    dirty = true;
    loadLab();
    updateStats();
  });

  $("preset").addEventListener("click", () => {
    if (world!.kind !== "bff") return;
    const bytes = world!.preset!();
    progEl.value = decode(bytes);
    const cx = selected % world!.w;
    const cy = Math.floor(selected / world!.w);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= world!.w || y >= world!.h) continue;
        world!.paint(y * world!.w + x, bytes);
      }
    }
    loadLab();
  });

  $("paint").addEventListener("click", () => {
    if (world!.kind !== "bff") return;
    world!.paint(selected, encode(progEl.value));
    loadLab();
  });

  $("step").addEventListener("click", () => advanceLab(labSpeed));
  $("lab-run").addEventListener("click", () => {
    labRunning = !labRunning;
    $("lab-run").textContent = labRunning ? "❚❚ 暂停" : "▶ 运行";
  });
  $("swap").addEventListener("click", () => {
    if (!scope?.swap) return;
    scope.swap();
    progEl.value = decode(scope.tape.subarray(0, TAPE));
    drawLabNow();
  });
  $("lab-reset").addEventListener("click", loadLab);
  $<HTMLInputElement>("labstep").addEventListener("input", (e) => {
    if (!scope?.setSteps) return;
    scope.setSteps(Number((e.target as HTMLInputElement).value));
    drawLabNow();
  });

  setInterval(() => {
    if (!world) return;
    $("epoch").textContent = world.epoch.toLocaleString();
    // if a worker died the substrate falls back silently; say so
    const pi = poolInfo();
    if (pi.cores !== Number(threadsSel.value)) {
      threadsSel.value = String(pi.cores);
      note.textContent = pi.reason;
    }
  }, 250);

  // rAF is throttled in a background tab; keep going on a timer instead
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
      intervalId = window.setInterval(() => tick(performance.now()), 16);
    } else {
      clearInterval(intervalId);
      last = performance.now();
      lastZoomT = 0;
      rafId = requestAnimationFrame(frame);
    }
  });

  // ?debug prints the throughput so it can be measured from the console
  if (location.search.includes("debug")) {
    let lastE = 0;
    let lastT = performance.now();
    let stepMs = 0;
    let stepN = 0;
    debugStep = (ms: number) => {
      stepMs += ms;
      stepN++;
    };
    setInterval(() => {
      if (!world) return;
      const now = performance.now();
      const per = ((world.epoch - lastE) * 1000) / Math.max(1, now - lastT);
      lastE = world.epoch;
      lastT = now;
      const pi = poolInfo();
      const g = canvas.getContext("2d")!;
      const mid = g.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      console.log(
        `[perf] ${per.toFixed(1)} epochs/s · ${(stepMs / Math.max(1, stepN)).toFixed(2)} ms/epoch · pool ${pi.cores}/${pi.parallel} · mid ${mid[0]},${mid[1]},${mid[2]},${mid[3]} · canvas ${canvas.width}x${canvas.height} · ${pi.reason}`,
      );
      stepMs = 0;
      stepN = 0;
    }, 1000);
  }

  // testing aid: mirror the pool state into the DOM so a headless run can read it
  setInterval(() => {
    if (!world) return;
    const pi = poolInfo();
    document.body.dataset.pool = `${pi.cores}/${pi.parallel}`;
    document.body.dataset.mode = world.kind;
    document.body.dataset.epoch = String(world.epoch);
  }, 500);

  const size0 = (location.search.match(/mapsize=(\d+x\d+)/) ?? [])[1];
  if (size0) {
    sizeSel.value = size0;
    setTimeout(() => void rebuild(...(size0.split("x").map(Number) as [number, number])), 800);
  }

  const view0 = (location.search.match(/view=(code|lineage|bytes)/) ?? [])[1];
  if (view0) {
    view = view0 as ViewMode | "bytes";
    (display as HTMLSelectElement).value = view0 === "bytes" ? "bytes:1" : `cell:${view0}`;
  }

  const z0 = Number((location.search.match(/zoom=([\d.]+)/) ?? [])[1]);
  if (z0 >= 1) {
    zoomTarget = z0;
    zoomLevel = z0;
    view3d.setPx(view3d.fitPx() * z0);
    view3d.centerOn(selected);
    dirty = true;
  }

  window.addEventListener("resize", () => {
    resizeGrid();
    centerCamera();
    dirty = true;
  });

  // the sidebar animates in and out, so the stage changes size over ~200ms;
  // follow it instead of jumping at the end
  let settling = 0;
  const ro = new ResizeObserver(() => {
    if (!world) return;
    resizeGrid();
    dirty = true;
    clearTimeout(settling);
    settling = setTimeout(() => {
      resizeGrid();
      centerCamera();
      draw();
    }, 240) as unknown as number;
  });
  ro.observe(canvas.parentElement!);
  resizeGrid();
  loadLab();
  updateStats();
  rafId = requestAnimationFrame(frame);
}

void boot().catch((err) => {
  const el = document.getElementById("hint");
  if (el) el.textContent = "启动失败：" + (err as Error).message;
});
