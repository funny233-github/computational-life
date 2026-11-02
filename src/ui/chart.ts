/** the two-line history chart under the statistics */
export interface Series {
  primary: number[];
  secondary: number[];
}

export function drawChart(canvas: HTMLCanvasElement, s: Series) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(245,244,239,0.025)";
  ctx.fillRect(0, 0, w, h);

  const len = s.primary.length;
  if (len < 2) return;

  // gridlines; the 50% line is the takeover threshold
  for (let i = 1; i < 4; i++) {
    const y = Math.round((h * i) / 4) + 0.5;
    ctx.strokeStyle = i === 2 ? "rgba(245,244,239,0.26)" : "rgba(245,244,239,0.1)";
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const PAD = 3;
  const x = (i: number) => (i / (len - 1)) * w;
  const val = (v: number) => PAD + (1 - Math.min(1, Math.max(0, v))) * (h - PAD * 2);

  // a frame, so the panel still reads as a chart when both lines hug an edge
  ctx.strokeStyle = "rgba(245,244,239,0.08)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  ctx.beginPath();
  ctx.strokeStyle = "#8a8f7d";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < len; i++) {
    const y = val(s.secondary[i]);
    if (i) ctx.lineTo(x(i), y);
    else ctx.moveTo(x(i), y);
  }
  ctx.stroke();

  ctx.beginPath();
  ctx.strokeStyle = "#b9705a";
  ctx.lineWidth = 2;
  for (let i = 0; i < len; i++) {
    const y = val(s.primary[i]);
    if (i) ctx.lineTo(x(i), y);
    else ctx.moveTo(x(i), y);
  }
  ctx.stroke();
}
