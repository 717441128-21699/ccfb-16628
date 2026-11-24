import { findRecipe, RECIPES } from '../game/data';
import {
  annealTemperatureC,
  criticalCoolingRate,
  vftLogEta,
  wallThickness,
} from '../game/physics';
import type { Recipe, Workpiece } from '../game/types';

function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

export function tempColor(tempC: number): [number, number, number] {
  const stops: Array<[number, [number, number, number]]> = [
    [20, [38, 70, 110]],
    [420, [88, 28, 34]],
    [560, [170, 38, 24]],
    [720, [232, 83, 28]],
    [900, [255, 145, 35]],
    [1060, [255, 211, 88]],
    [1250, [255, 246, 214]],
    [2000, [255, 255, 255]],
  ];
  if (tempC <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (tempC <= t1) {
      const k = (tempC - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * k),
        Math.round(c0[1] + (c1[1] - c0[1]) * k),
        Math.round(c0[2] + (c1[2] - c0[2]) * k),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

function rgb(c: [number, number, number], alpha = 1): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

export function drawTemperatureMap(canvas: HTMLCanvasElement, wp: Workpiece | null): void {
  const ctx = setupCanvas(canvas);
  if (!ctx) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  ctx.fillStyle = 'rgba(8,14,24,0.92)';
  ctx.fillRect(0, 0, w, h);

  if (!wp) {
    ctx.fillStyle = 'rgba(220,235,255,0.58)';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('从熔炉挑料后，这里会显示轴向 × 径向温度分布', w / 2, h / 2);
    return;
  }

  const n = wp.activeCells;
  const rows = wp.radialLayers;
  const labelW = 54;
  const topH = 24;
  const bottomH = 28;
  const plotW = w - labelW - 14;
  const plotH = h - topH - bottomH;
  const cellW = plotW / n;
  const rowH = plotH / rows;

  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const rowLabels = ['内壁', 'r-1', '中心', 'r+1', '表面'];
  for (let r = 0; r < rows; r += 1) {
    const y = topH + (rows - 1 - r) * rowH + rowH / 2;
    ctx.fillStyle = 'rgba(210,226,255,0.72)';
    ctx.fillText(rowLabels[r] ?? `${r}`, labelW - 8, y);
  }

  for (let i = 0; i < n; i += 1) {
    for (let r = 0; r < rows; r += 1) {
      // Draw outer layer on top row.
      const sourceRow = rows - 1 - r;
      const t = wp.T[i * rows + sourceRow];
      ctx.fillStyle = rgb(tempColor(t));
      const x = labelW + i * cellW;
      const y = topH + r * rowH;
      ctx.fillRect(x + 0.5, y + 0.5, Math.max(1, cellW - 1), Math.max(1, rowH - 1));
    }
  }

  // Tool position marker.
  const toolIndex = Math.round((wp as unknown as { toolU?: number }).toolU ?? 0.68 * (n - 1));
  void toolIndex;

  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  ctx.strokeRect(labelW + 0.5, topH + 0.5, plotW - 1, plotH - 1);

  ctx.fillStyle = 'rgba(220,235,255,0.7)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('贴管端 / 底部 u=0', labelW + plotW * 0.18, h - 20);
  ctx.fillText('剪切后的口沿 u=1', labelW + plotW * 0.82, h - 20);

  // Legend gradient.
  const legendW = Math.min(260, plotW * 0.5);
  const lx = labelW;
  const ly = 7;
  for (let x = 0; x < legendW; x += 2) {
    const t = 300 + (x / legendW) * 1000;
    ctx.fillStyle = rgb(tempColor(t));
    ctx.fillRect(lx + x, ly, 2, 8);
  }
  ctx.fillStyle = 'rgba(225,238,255,0.75)';
  ctx.textAlign = 'left';
  ctx.fillText('300°C', lx, ly + 11);
  ctx.textAlign = 'right';
  ctx.fillText('1300°C', lx + legendW, ly + 11);
}

export function drawVftChart(canvas: HTMLCanvasElement, selected: Recipe, currentC?: number): void {
  const ctx = setupCanvas(canvas);
  if (!ctx) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.fillStyle = 'rgba(8,14,24,0.92)';
  ctx.fillRect(0, 0, w, h);

  const pad = { l: 46, r: 14, t: 16, b: 30 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  const tMin = 450;
  const tMax = 1950;
  const yMin = -1;
  const yMax = 16;
  const x = (t: number): number => pad.l + ((t - tMin) / (tMax - tMin)) * pw;
  const y = (logEta: number): number => pad.t + (1 - (logEta - yMin) / (yMax - yMin)) * ph;

  ctx.strokeStyle = 'rgba(180,205,240,0.16)';
  ctx.fillStyle = 'rgba(215,230,255,0.68)';
  ctx.font = '10px ui-monospace, monospace';
  ctx.lineWidth = 1;
  for (let log = 0; log <= 16; log += 2) {
    const yy = y(log);
    ctx.beginPath();
    ctx.moveTo(pad.l, yy);
    ctx.lineTo(pad.l + pw, yy);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(log), pad.l - 6, yy);
  }
  for (let t = 500; t <= 1900; t += 200) {
    const xx = x(t);
    ctx.beginPath();
    ctx.moveTo(xx, pad.t);
    ctx.lineTo(xx, pad.t + ph);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${t}`, xx, pad.t + ph + 7);
  }

  RECIPES.forEach((recipe) => {
    ctx.beginPath();
    for (let t = tMin; t <= tMax; t += 10) {
      const logEta = vftLogEta(recipe, t);
      const xx = x(t);
      const yy = y(logEta);
      if (t === tMin) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    }
    const selectedRecipe = recipe.id === selected.id;
    ctx.strokeStyle = selectedRecipe ? rgb(recipeColor(recipe), 0.98) : 'rgba(150,170,200,0.28)';
    ctx.lineWidth = selectedRecipe ? 2.6 : 1.2;
    ctx.stroke();
  });

  const annealC = annealTemperatureC(selected);
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = 'rgba(120,190,255,0.55)';
  ctx.beginPath();
  ctx.moveTo(x(annealC), pad.t);
  ctx.lineTo(x(annealC), pad.t + ph);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(180,220,255,0.9)';
  ctx.textAlign = 'center';
  ctx.fillText(`退火点 ${Math.round(annealC)}°C`, x(annealC), 2);

  if (currentC !== undefined && currentC >= tMin && currentC <= tMax) {
    const logEta = vftLogEta(selected, currentC);
    ctx.fillStyle = '#fff2b8';
    ctx.strokeStyle = 'rgba(255,220,120,0.9)';
    ctx.beginPath();
    ctx.arc(x(currentC), y(logEta), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(225,238,255,0.78)';
  ctx.textAlign = 'left';
  ctx.fillText('log₁₀ η (Pa·s)', 8, 12);
  ctx.textAlign = 'right';
  ctx.fillText('温度 °C', w - 12, h - 8);
}

function recipeColor(recipe: Recipe): [number, number, number] {
  if (recipe.id === 'lead-crystal') return [255, 205, 92];
  if (recipe.id === 'borosilicate') return [105, 240, 210];
  if (recipe.id === 'fused-quartz') return [210, 230, 255];
  return [105, 190, 255];
}

export function drawRadialProfile(canvas: HTMLCanvasElement, wp: Workpiece | null): void {
  const ctx = setupCanvas(canvas);
  if (!ctx) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.fillStyle = 'rgba(8,14,24,0.92)';
  ctx.fillRect(0, 0, w, h);
  if (!wp) {
    ctx.fillStyle = 'rgba(220,235,255,0.58)';
    ctx.textAlign = 'center';
    ctx.fillText('选择轴向位置后显示径向层温度', w / 2, h / 2);
    return;
  }

  const selected = Math.max(0, Math.min(wp.activeCells - 1, Math.round(0.68 * (wp.activeCells - 1))));
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.min(w, h) * 0.36;
  const thickness = wallThickness(wp, selected);
  const outer = maxR;
  const inner = outer * Math.max(0.25, 1 - thickness / Math.max(wp.R[selected], thickness) * 2.8);
  const layerW = (outer - inner) / wp.radialLayers;

  for (let j = 0; j < wp.radialLayers; j += 1) {
    const t = wp.T[selected * wp.radialLayers + j];
    const rOuter = inner + (j + 1) * layerW;
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
    ctx.fillStyle = rgb(tempColor(t));
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, inner - 1, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(5,10,18,0.96)';
  ctx.fill();
  ctx.fillStyle = 'rgba(230,242,255,0.86)';
  ctx.font = '12px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`u=${(selected / wp.activeCells).toFixed(2)}`, cx, h - 18);
}

export function drawAnnealChart(canvas: HTMLCanvasElement, wp: Workpiece | null): void {
  const ctx = setupCanvas(canvas);
  if (!ctx) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.fillStyle = 'rgba(8,14,24,0.94)';
  ctx.fillRect(0, 0, w, h);
  if (!wp?.anneal || wp.anneal.samples.length < 2) {
    ctx.fillStyle = 'rgba(220,235,255,0.58)';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('送入退火窑后，这里绘制温度、降温速率与应力', w / 2, h / 2);
    return;
  }

  const samples = wp.anneal.samples;
  const pad = { l: 48, r: 48, t: 18, b: 28 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  const maxT = Math.max(600, ...samples.map((s) => s.coreC));
  const maxTime = Math.max(10, samples[samples.length - 1].t);
  const maxStress = Math.max(12, wp.anneal.maxStressMPa * 1.15);
  const x = (t: number): number => pad.l + (t / maxTime) * pw;
  const yTemp = (t: number): number => pad.t + (1 - t / maxT) * ph;
  const yStress = (s: number): number => pad.t + (1 - s / maxStress) * ph;

  ctx.strokeStyle = 'rgba(180,205,240,0.16)';
  ctx.fillStyle = 'rgba(215,230,255,0.65)';
  ctx.font = '10px ui-monospace, monospace';
  for (let k = 0; k <= 4; k += 1) {
    const yy = pad.t + (k / 4) * ph;
    ctx.beginPath();
    ctx.moveTo(pad.l, yy);
    ctx.lineTo(pad.l + pw, yy);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(maxT * (1 - k / 4))}°C`, pad.l - 6, yy);
    ctx.textAlign = 'left';
    ctx.fillText(`${(maxStress * (1 - k / 4)).toFixed(0)}`, pad.l + pw + 6, yy);
  }

  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#ffc857';
  ctx.beginPath();
  samples.forEach((s, i) => {
    if (i === 0) ctx.moveTo(x(s.t), yTemp(s.coreC));
    else ctx.lineTo(x(s.t), yTemp(s.coreC));
  });
  ctx.stroke();

  ctx.strokeStyle = '#ff5d5d';
  ctx.beginPath();
  samples.forEach((s, i) => {
    if (i === 0) ctx.moveTo(x(s.t), yStress(s.stressMPa));
    else ctx.lineTo(x(s.t), yStress(s.stressMPa));
  });
  ctx.stroke();

  const recipe = findRecipe(wp.recipeId);
  const limitMPa = recipe.strength / 1e6;
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = 'rgba(255,95,95,0.75)';
  ctx.beginPath();
  ctx.moveTo(pad.l, yStress(limitMPa));
  ctx.lineTo(pad.l + pw, yStress(limitMPa));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffc857';
  ctx.fillText('● 核心温度', pad.l, 12);
  ctx.fillStyle = '#ff7b7b';
  ctx.fillText('● 最大应力 MPa', pad.l + 92, 12);
  ctx.fillStyle = 'rgba(220,235,255,0.7)';
  ctx.textAlign = 'right';
  ctx.fillText(`临界降温 ${wp.anneal.qCritMin.toFixed(2)} K/s · 峰值 ${wp.anneal.maxMeasuredRate.toFixed(2)} K/s`, w - 10, 12);
}

export function qcriticForCurrent(wp: Workpiece | null): number | null {
  if (!wp) return null;
  const recipe = findRecipe(wp.recipeId);
  let maxW = 0;
  for (let i = 0; i < wp.activeCells; i += 1) maxW = Math.max(maxW, wallThickness(wp, i));
  return criticalCoolingRate(recipe, maxW);
}
