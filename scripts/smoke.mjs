// Smoke test: run the built single-file bundle against a fake DOM.
// Catches typos in element ids, null derefs, and runtime errors in the sim loop.
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync("dist/index.html", "utf8");
const m = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
const code = m[m.length - 1][1];

function el(tag = "div", id = "") {
  const e = {
    tagName: tag.toUpperCase(), id, innerHTML: "", value: "",
    _text: "",
    get textContent() { return this._text; },
    set textContent(v) { this._text = v; if (v === "") this.children.length = 0; },
    style: {}, dataset: {}, className: "", children: [],
    clientWidth: 800, clientHeight: 600, width: 0, height: 0,
    parentElement: { clientWidth: 1200, clientHeight: 800 },
    classList: { add() {}, remove() {}, contains: () => false },
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { for (const c of cs) this.children.push(c); },
    closest() { return null; },
    style: { setProperty() {}, removeProperty() {} },
    listeners: new Map(),
    addEventListener(t, f) {
      if (!this.listeners.has(t)) this.listeners.set(t, []);
      this.listeners.get(t).push(f);
    },
    fire(t, extra = {}) {
      for (const f of this.listeners.get(t) ?? []) f({ target: this, preventDefault() {}, ...extra });
    },
    setAttribute() {}, removeAttribute() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData() {}, clearRect() {}, setTransform() {}, beginPath() {},
      moveTo() {}, lineTo() {}, stroke() {}, strokeRect() {}, fillRect() {},
      fillText() {}, save() {}, restore() {}, scale() {}, drawImage() {}, arc() {}, closePath() {}, fill() {},
      set fillStyle(v) {}, get fillStyle() { return ""; },
      set strokeStyle(v) {}, get strokeStyle() { return ""; },
      set lineWidth(v) {}, get lineWidth() { return 1; },
      set imageSmoothingEnabled(v) {}, get imageSmoothingEnabled() { return true; },
    }),
  };
  return e;
}

// which ids exist before the script tag runs?  anything after it is a null lookup
const scriptAt = html.lastIndexOf("<script");
const declared = new Set();
for (const mm of html.matchAll(/id="([^"]+)"/g)) {
  if (mm.index < scriptAt) declared.add(mm[1]);
}
const missing = new Set();

const byId = new Map();
const document = {
  getElementById: (id) => {
    if (!declared.has(id)) missing.add(id);
    if (!byId.has(id)) byId.set(id, el("div", id));
    return byId.get(id);
  },
  createElement: (t) => el(t),
  querySelectorAll: () => [],
  createTextNode: () => el(),
  body: el("body"),
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
};
document.getElementById("grid").tagName = "CANVAS";
document.getElementById("chart").tagName = "CANVAS";

let frames = 0;
let rafCb = null;
const ctxObj = {
  document, ImageData: class { constructor(w, h) { this.data = new Uint8ClampedArray(w * h * 4); this.width = w; this.height = h; } },
  window: { addEventListener() {}, devicePixelRatio: 1, innerWidth: 1200, innerHeight: 800 },
  performance: { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 },
  requestAnimationFrame: (cb) => { rafCb = cb; return 1; },
  setInterval: () => 0, setTimeout: (f) => { f(); return 0; }, clearInterval() {}, clearTimeout() {},
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  console, Math, Date,
  navigator: { hardwareConcurrency: 8 },
  location: { search: "?bff" },   // exercise the BFF substrate here; z80 has its own test
  WebAssembly, atob,
};
ctxObj.globalThis = ctxObj;
ctxObj.self = ctxObj;

// microtaskMode: the vm's microtask queue must be drained explicitly, or every
// `await` inside the bundle never resumes
vm.createContext(ctxObj, { microtaskMode: "afterEvaluate" });
vm.runInContext(code, ctxObj, { filename: "bundle.js" });
vm.runInContext("0", ctxObj); // let boot()'s awaits settle

// pump frames
for (let i = 0; i < 120; i++) {
  const cb = rafCb; rafCb = null;
  if (!cb) break;
  cb(1000 + i * 16);
  frames++;
}
const g = (id) => byId.get(id)?.textContent;
console.log("mode:", byId.get("mode")?.textContent, "|", byId.get("mode")?.title);
if (byId.get("hint").textContent.startsWith("出错了") || byId.get("hint").textContent.startsWith("启动失败")) {
  console.error("FAIL: boot error -> " + byId.get("hint").textContent);
  process.exit(1);
}
console.log("frames pumped:", frames);
console.log("epoch:", g("epoch"), "| rate:", g("rate"));
const statsHtml = byId.get("stats").children.map((d) => d.children.map((c) => c.textContent).join(" "));
console.log("stats:", statsHtml.join(" | "));
if (statsHtml.length !== 4) { console.error("FAIL: stats panel not populated"); process.exit(1); }
console.log("lab state:", g("lab-state"));
console.log("lab cell label:", g("lab-cell"));
if (frames === 0) { console.error("FAIL: no frames ran"); process.exit(1); }
if (!statsHtml.some((r) => /\d/.test(r))) { console.error("FAIL: stats never updated"); process.exit(1); }
if (!declared.has("grid")) { console.error("FAIL: script runs before #grid is parsed"); process.exit(1); }

// ---- interaction checks -------------------------------------------------
const state = () => byId.get("lab-state").textContent;
// tick() is async now, so let the microtask queue drain between frames
// the clock must keep moving, or the frame throttle inside the bundle never
// decides to repaint
let clock = 5000;
const pump = async (n) => {
  for (let i = 0; i < n; i++) {
    const cb = rafCb;
    rafCb = null;
    if (cb) cb(clock);
    clock += 16;
    vm.runInContext("0", ctxObj); // flush microtasks (await in the bundle)
    await new Promise((r) => setTimeout(r, 0));
  }
};

const steps = () => Number((state().match(/([\d,]+) 步/) ?? [, 0])[1].replace(/,/g, ""));
const speedSel = byId.get("labspeed");

speedSel.value = "1";
speedSel.fire("change");
if (!state().includes("每帧 ×1")) { console.error("FAIL: stale readout: " + state()); process.exit(1); }

byId.get("lab-run").fire("click");
await pump(4);
const slow = steps();
if (!(slow > 0)) { console.error("FAIL: lab run does not advance: " + state()); process.exit(1); }

speedSel.value = "64";
speedSel.fire("change");
await pump(4);
const fast = steps() - slow;
if (fast < slow * 3) {
  console.error(`FAIL: steps/frame does not change speed (slow ${slow} vs fast ${fast})`);
  process.exit(1);
}
console.log(`steps/frame works: ${slow} steps @x1 vs ${fast} @x64`);

byId.get("lab-run").fire("click"); // pause
await pump(1);
const beforeStep = steps();
byId.get("step").fire("click");
const oneStep = steps() - beforeStep;
if (oneStep !== 64) {
  console.error(`FAIL: step button advanced ${oneStep}, expected 64 (steps/frame)`);
  process.exit(1);
}
console.log(`step button advances ${oneStep} instructions (== steps/frame)`);

speedSel.value = "1";
speedSel.fire("change");
const before1 = steps();
byId.get("step").fire("click");
console.log(`at x1 the step button advances ${steps() - before1} instruction`);
speedSel.value = "64";
speedSel.fire("change");

byId.get("lab-run").fire("click"); // resume
await pump(1);
speedSel.value = "1";
speedSel.fire("change");
byId.get("lab-run").fire("click"); // pause
let bad = null;
for (let i = 0; i < 300; i++) {
  byId.get("step").fire("click");
  if (state().includes("undefined") || state().includes("NaN")) bad = state();
}
if (bad) { console.error("FAIL: broken readout after halt: " + bad); process.exit(1); }
console.log("300 single steps, readout stayed valid ->", state());
speedSel.value = "64";
speedSel.fire("change");
byId.get("lab-run").fire("click"); // resume

const gridSel = byId.get("labgrid");
const before = steps();
gridSel.value = "4";
gridSel.fire("change");
await pump(3);
if (!(steps() > before)) { console.error("FAIL: 4x4 grid stops the animation"); process.exit(1); }
console.log("grid 4x4 keeps running ->", state());


if (byId.get("lg-primary").textContent === "—") {
  console.error("FAIL: chart legend never updated");
  process.exit(1);
}
console.log(`chart legend -> ${byId.get("lg-primary-name").textContent} ${byId.get("lg-primary").textContent}, ${byId.get("lg-secondary-name").textContent} ${byId.get("lg-secondary").textContent}`);

const gridCanvas = byId.get("grid");
const disp = byId.get("display");
// the display list now only picks the *view*; zoom belongs to the wheel
const pxNow = () => Number(gridCanvas.dataset.px);
const bmpOk = (v, full) => v === full || v === Math.ceil(full / 2);
if (!bmpOk(gridCanvas.width, 1160) || !bmpOk(gridCanvas.height, 760)) {
  console.error(`FAIL: bitmap is neither the stage nor half of it (${gridCanvas.width}x${gridCanvas.height})`);
  process.exit(1);
}
const setView = async (v) => {
  disp.value = v;
  disp.fire("change");
  await pump(2);
  return pxNow();
};
const p0 = pxNow();
await setView("cell:lineage");
await setView("cell:code");
const p1 = await setView("bytes:1");
if (p1 !== p0) {
  console.error(`FAIL: switching the view changed the zoom (${p0} -> ${p1})`);
  process.exit(1);
}
// zooming must keep the cell under the cursor put
{
  const rect = gridCanvas.getBoundingClientRect();
  const pt = { clientX: rect.width * 0.32, clientY: rect.height * 0.61 };
  gridCanvas.fire("click", pt);
  const before = g("hint");
  gridCanvas.fire("wheel", { ...pt, deltaY: -240 });
  await pump(40);
  gridCanvas.fire("click", pt);
  console.log("geo after:", gridCanvas.dataset.geo);
  console.log("click resolved:", gridCanvas.dataset.sel);
  const after = g("hint");
  console.log("hint before/after:", before, "/", after);
  if (before !== after) {
    console.error(`FAIL: zoom drifted (${before} -> ${after})`);
    process.exit(1);
  }
  console.log("zoom anchor: the cell under the cursor stays put");

  // some trackpads report wheel events with no position at all (0,0); those must
  // fall back to the last pointer position instead of zooming the top-left corner
  const pt2 = { clientX: rect.width * 0.7, clientY: rect.height * 0.3 };
  gridCanvas.fire("pointermove", pt2);
  gridCanvas.fire("click", pt2);
  const before2 = g("hint");
  gridCanvas.fire("wheel", { clientX: 0, clientY: 0, deltaY: -200 });
  await pump(40);
  gridCanvas.fire("click", pt2);
  if (g("hint") !== before2) {
    console.error(`FAIL: positionless wheel lost the anchor (${before2} -> ${g("hint")})`);
    process.exit(1);
  }
  console.log("positionless wheel: falls back to the pointer position");
}

console.log("sidebar toggle:", byId.get("panels") ? "wired" : "MISSING");
if (!byId.get("panels")) { console.error("FAIL: no sidebar toggle"); process.exit(1); }
console.log(`display selector: view modes leave the zoom alone (${p1} px/byte), bitmap ${gridCanvas.width}x${gridCanvas.height}`);

if (missing.size) console.log("note: ids not in static HTML:", [...missing].join(", "));
