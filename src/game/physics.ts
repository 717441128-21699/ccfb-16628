import { CELL_COUNT, RADIAL_LAYERS, findRecipe, orderTarget, smoothstep, targetRadius } from './data';
import type {
  AnnealMode,
  BenchControls,
  CrackRecord,
  Order,
  Recipe,
  Workpiece,
} from './types';

const SIGMA = 5.670374419e-8;
const GRAVITY = 9.81;
const TWO_PI = Math.PI * 2;

export type UpgradeLevels = Record<string, number>;

export function vftLogEta(recipe: Recipe, tempC: number): number {
  const tk = tempC + 273.15;
  const denominator = Math.max(1, tk - recipe.vft.T0);
  const value = recipe.vft.A + recipe.vft.B / denominator;
  return Math.max(-2, Math.min(18, value));
}

export function viscosity(recipe: Recipe, tempC: number): number {
  return 10 ** vftLogEta(recipe, tempC);
}

export function characteristicTempC(recipe: Recipe, logEta: number): number {
  const tk = recipe.vft.T0 + recipe.vft.B / (logEta - recipe.vft.A);
  return tk - 273.15;
}

export function annealTemperatureC(recipe: Recipe): number {
  return characteristicTempC(recipe, recipe.annealLogEta);
}

export function strainTemperatureC(recipe: Recipe): number {
  return characteristicTempC(recipe, recipe.strainLogEta);
}

export function thermalDiffusivity(recipe: Recipe): number {
  return recipe.conductivity / (recipe.density * recipe.heatCapacity);
}

export function innerRadius(wp: Workpiece, i: number): number {
  const area = wp.volume[i] / wp.dx[i];
  return Math.sqrt(Math.max(0, wp.R[i] * wp.R[i] - area / Math.PI));
}

export function wallThickness(wp: Workpiece, i: number): number {
  const r = innerRadius(wp, i);
  return Math.max(0.00045, wp.R[i] - r);
}

export function effectiveViscosity(wp: Workpiece, recipe: Recipe, i: number): number {
  let fluidity = 0;
  const base = i * wp.radialLayers;
  for (let j = 0; j < wp.radialLayers; j += 1) {
    fluidity += 1 / viscosity(recipe, wp.T[base + j]);
  }
  fluidity /= wp.radialLayers;
  return 1 / Math.max(fluidity, 1e-18);
}

/** K/s. Thick walls have a lower safe uniform cooling rate. */
export function criticalCoolingRate(recipe: Recipe, thicknessM: number): number {
  const alpha = thermalDiffusivity(recipe);
  const w = Math.max(0.0015, thicknessM);
  const geometry = 1.38;
  return (
    (geometry * 2 * alpha * recipe.strength * (1 - recipe.poisson)) /
    (recipe.youngModulus * recipe.expansion * w * w)
  );
}

let workpieceSerial = 1;

export function createWorkpiece(
  recipeId: string,
  orderId: string | undefined,
  upgrades: UpgradeLevels = {},
): Workpiece {
  const recipe = findRecipe(recipeId);
  const n = CELL_COUNT;
  const layers = RADIAL_LAYERS;
  const R = new Float32Array(n);
  const dx = new Float32Array(n);
  const volume = new Float32Array(n);
  const T = new Float32Array(n * layers);
  const crack = new Float32Array(n);
  const stress = new Float32Array(n);
  const prevGradient = new Float32Array(n);
  const prevLockedStress = new Float32Array(n);
  const curvature = new Float32Array(n);
  const sag = new Float32Array(n + 1);
  const centerX = new Float32Array(n + 1);

  const totalLength = 0.22;
  const cellLength = totalLength / n;

  for (let i = 0; i < n; i += 1) {
    const u = (i + 0.5) / n;
    const bulb = Math.pow(Math.sin(Math.PI * Math.min(0.98, u * 0.96)), 0.72);
    R[i] = 0.016 + 0.027 * bulb + 0.003 * u;
    dx[i] = cellLength;
    const inner = R[i] * 0.42;
    const area = Math.PI * (R[i] * R[i] - inner * inner);
    volume[i] = area * cellLength;

    for (let j = 0; j < layers; j += 1) {
      const radial = j / (layers - 1);
      const surfaceLoss = 52 * smoothstep(0.55, 1, radial);
      const innerLoss = 10 * (1 - smoothstep(0, 0.35, radial));
      T[i * layers + j] = recipe.gatherC + 14 - surfaceLoss - innerLoss;
    }
  }

  const gloryLevel = upgrades['glory-heater'] ?? 0;
  const wp: Workpiece = {
    id: workpieceSerial++,
    recipeId,
    orderId,
    phase: 'working',
    createdAt: 0,
    simTime: 0,
    cellCount: n,
    activeCells: n,
    R,
    dx,
    volume,
    T,
    radialLayers: layers,
    crack,
    stress,
    prevGradient,
    prevLockedStress,
    curvature,
    sag,
    centerX,
    rpm: 58,
    targetRpm: 58,
    pressure: 0,
    blowEnergy: 0,
    symmetry: 100,
    inGlory: false,
    gloryBonusC: gloryLevel * 45,
    ambientC: 25,
    pipeChill: 1,
    cracks: [],
    warnings: [],
  };
  reconstructCenterline(wp);
  return wp;
}

interface ThermalEnvironment {
  ambientC: number;
  gloryC?: number;
  convection?: number;
}

function stepThermal(wp: Workpiece, dt: number, env: ThermalEnvironment): void {
  if (dt <= 0) return;
  const recipe = findRecipe(wp.recipeId);
  const n = wp.activeCells;
  const layers = wp.radialLayers;
  const rhoCp = recipe.density * recipe.heatCapacity;
  const alpha = recipe.conductivity / rhoCp;
  const hConv = env.convection ?? 18;
  const hInner = 12;
  const temp = new Float32Array(layers);

  let minLayer = Infinity;
  for (let i = 0; i < n; i += 1) {
    minLayer = Math.min(minLayer, wallThickness(wp, i) / layers);
  }
  // Explicit finite-volume stability: dt <~ dr^2 / (2 alpha).
  const stableDt = Math.max(0.0008, (0.18 * minLayer * minLayer) / alpha);
  const substeps = Math.max(1, Math.min(240, Math.ceil(dt / stableDt)));
  const subDt = dt / substeps;

  for (let step = 0; step < substeps; step += 1) {
    for (let i = 0; i < n; i += 1) {
      const w = wallThickness(wp, i);
      const layerThickness = w / layers;
      const heatCapacity = rhoCp * layerThickness;
      const conductance = recipe.conductivity / layerThickness;

      for (let j = 0; j < layers; j += 1) temp[j] = wp.T[i * layers + j];

      for (let j = 0; j < layers; j += 1) {
        let rate = 0;
        if (j > 0) rate += conductance * (temp[j - 1] - temp[j]);
        if (j < layers - 1) rate += conductance * (temp[j + 1] - temp[j]);

        if (j === 0) {
          rate += hInner * (38 - temp[j]);
          if (i < 2) rate += 55 * wp.pipeChill * (180 - temp[j]);
        }

        if (j === layers - 1) {
          const ts = temp[j] + 273.15;
          if (env.gloryC !== undefined) {
            const tg = env.gloryC + 273.15;
            const radiation = recipe.emissivity * SIGMA * (tg ** 4 - ts ** 4);
            const convection = 82 * (env.gloryC - temp[j]);
            rate += radiation + convection;
          } else {
            const ta = env.ambientC + 273.15;
            const radiation = recipe.emissivity * SIGMA * (ts ** 4 - ta ** 4);
            const convection = hConv * (temp[j] - env.ambientC);
            rate -= radiation + convection;
          }
        }

        const nextT = temp[j] + (rate / heatCapacity) * subDt;
        wp.T[i * layers + j] = Number.isFinite(nextT) ? Math.max(20, Math.min(2400, nextT)) : temp[j];
      }
    }
  }
}

function addCrackRecord(wp: Workpiece, i: number, reason: string): void {
  const u = (i + 0.5) / wp.activeCells;
  const exists = wp.cracks.some((c) => Math.abs(c.u - u) < 0.035 && c.reason === reason);
  if (!exists) {
    const record: CrackRecord = { u, severity: wp.crack[i], reason, time: wp.simTime };
    wp.cracks.push(record);
  }
}

function fail(wp: Workpiece, reason: string): void {
  wp.phase = 'failed';
  wp.failReason = reason;
  wp.pressure = 0;
  if (wp.anneal) wp.anneal.status = wp.anneal.status === 'shattered' ? 'shattered' : 'ready';
}

export function reconstructCenterline(wp: Workpiece): void {
  const n = wp.activeCells;
  let x = 0;
  let y = 0;
  let angle = 0;
  wp.centerX[0] = 0;
  wp.sag[0] = 0;

  for (let i = 0; i < n; i += 1) {
    angle += wp.curvature[i] * wp.dx[i];
    x += wp.dx[i] * Math.cos(angle);
    y += wp.dx[i] * Math.sin(angle);
    wp.centerX[i + 1] = x;
    wp.sag[i + 1] = y;
  }
}

function applyToolsAndForces(
  wp: Workpiece,
  dt: number,
  controls: BenchControls,
  upgrades: UpgradeLevels,
): void {
  const recipe = findRecipe(wp.recipeId);
  const n = wp.activeCells;
  const precision = upgrades['precision-tools'] ?? 0;
  const toolActive = controls.clamping || controls.pressing;
  const force = Math.max(0, Math.min(1, controls.pressure));
  const widthScale = 1 - precision * 0.09;
  const clampWidth = Math.max(0.012, controls.toolWidth * widthScale);
  const pressWidth = Math.min(0.24, clampWidth * 2.6);

  for (let i = 0; i < n; i += 1) {
    const u = i / Math.max(1, n - 1);
    const eta = effectiveViscosity(wp, recipe, i);
    const logEta = vftLogEta(recipe, wp.T[i * wp.radialLayers + 2]);
    const inner = innerRadius(wp, i);
    const w = Math.max(0.0007, wp.R[i] - inner);
    const omega = (wp.rpm * TWO_PI) / 60;

    // Thin-wall hoop stress plus a deliberately rim-weighted centrifugal term.
    const blowPa = 1600 + force * 6800;
    const blowStress = wp.pressure * blowPa * wp.R[i] / Math.max(0.0016, 2 * w);
    const rimFactor = 0.25 + 2.7 * u ** 4;
    const centrifugalStress = 0.16 * recipe.density * omega * omega * wp.R[i] ** 2 * rimFactor;
    const radialStrain = (blowStress + centrifugalStress) / (3 * eta);
    wp.R[i] = Math.min(0.092, Math.max(0.006, wp.R[i] * Math.exp(radialStrain * dt * 0.42)));

    // Recompute thickness after radial deformation.
    const inner2 = innerRadius(wp, i);
    const w2 = Math.max(0.0005, wp.R[i] - inner2);
    if (wp.pressure > 0.05 && w2 < 0.00085) {
      wp.crack[i] = Math.min(1, wp.crack[i] + dt * wp.pressure * (0.00085 - w2) * 900);
      if (wp.crack[i] > 0.22) addCrackRecord(wp, i, '吹得过薄');
    }

    if (toolActive) {
      const d = u - controls.toolU;
      const width = controls.clamping ? clampWidth : pressWidth;
      const weight = Math.exp(-(d * d) / (width * width));
      const toolPa = (controls.clamping ? 165000 : 92000) * (0.35 + force * 0.65);
      const strain = (toolPa * weight) / (3 * eta);
      const response = controls.clamping ? 0.58 : 0.34;
      wp.R[i] = Math.max(0.0065, wp.R[i] * Math.exp(-strain * dt * response));

      // Volume conservation for a solid/closed section gives dx = V/(pi R^2).
      // Cap local elongation so an over-long held tool cannot create metre-long cells;
      // once the cap is reached, the radius is held at the corresponding floor.
      const maxCellDx = 0.028;
      const requiredDx = wp.volume[i] / (Math.PI * wp.R[i] * wp.R[i]);
      if (wp.dx[i] < requiredDx) wp.dx[i] = Math.min(maxCellDx, requiredDx);
      const radiusFloor = Math.sqrt(wp.volume[i] / (wp.dx[i] * Math.PI));
      if (wp.R[i] < radiusFloor) wp.R[i] = radiusFloor;

      const outerC = wp.T[i * wp.radialLayers + wp.radialLayers - 1];
      const cold = Math.max(0, Math.min(1, (recipe.toolSafeC + 85 - outerC) / 360));
      if (cold > 0.02) {
        const precisionFactor = 1 - precision * 0.13;
        wp.crack[i] = Math.min(
          1,
          wp.crack[i] + dt * (0.22 + force * 0.55) * cold * precisionFactor,
        );
        if (wp.crack[i] > 0.24) addCrackRecord(wp, i, '冷表面被工具压裂');
      }
    }

    if (wp.crack[i] >= 0.82) {
      fail(wp, '玻璃表面已经冷硬，夹压力超过裂纹临界值，工件炸裂。');
      return;
    }

    // Viscous cantilever bending from the weight of distal glass.
    let moment = 0;
    const xi = wp.centerX[i] ?? 0;
    for (let j = i + 1; j < n; j += 1) {
      const xj = wp.centerX[j] ?? wp.centerX[i + 1] ?? xi;
      moment += recipe.density * wp.volume[j] * GRAVITY * Math.max(0.015, xj - xi);
    }
    const sectionInertia = Math.max(1e-9, Math.PI * wp.R[i] ** 3 * w);
    const curvatureRate = (moment / Math.max(1e-6, 3 * eta * sectionInertia)) * 0.014;
    const asym = 1 / (1 + (wp.rpm / 34) ** 2);
    wp.curvature[i] -= Math.min(2.2, curvatureRate) * asym * dt;

    const hot = Math.max(0, Math.min(1, (9.2 - logEta) / 6.4));
    const spin = Math.max(0, Math.min(1, wp.rpm / 85));
    const leveling = 0.04 + 1.28 * spin * hot;
    wp.curvature[i] *= Math.exp(-leveling * dt);
    wp.curvature[i] = Math.max(-7.5, Math.min(1.5, wp.curvature[i]));
  }

  reconstructCenterline(wp);

  let maxDroop = 0;
  const length = wp.centerX[n] || 1;
  for (let i = 0; i <= n; i += 1) maxDroop = Math.max(maxDroop, Math.abs(wp.sag[i]));
  const straight = Math.max(0, Math.min(100, 100 * (1 - maxDroop / Math.max(0.025, length * 0.22))));
  wp.symmetry += (straight - wp.symmetry) * Math.min(1, dt * 1.8);
  wp.blowEnergy += wp.pressure * dt;
}

export function stepWorking(
  wp: Workpiece,
  rawDt: number,
  controls: BenchControls,
  upgrades: UpgradeLevels,
): void {
  if (wp.phase !== 'working') return;
  const dt = Math.min(0.05, Math.max(0, rawDt));
  wp.simTime += dt;
  wp.inGlory = controls.heating;
  wp.targetRpm = controls.targetRpm;
  wp.rpm += (wp.targetRpm - wp.rpm) * (1 - Math.exp(-dt * 3.4));
  const targetPressure = controls.blowing ? Math.max(0.05, controls.pressure) : 0;
  wp.pressure += (targetPressure - wp.pressure) * (1 - Math.exp(-dt * 10));

  const recipe = findRecipe(wp.recipeId);
  if (controls.heating) {
    stepThermal(wp, dt, { ambientC: 25, gloryC: recipe.gloryC + wp.gloryBonusC });
  } else {
    stepThermal(wp, dt, { ambientC: wp.ambientC, convection: 18 });
  }

  applyToolsAndForces(wp, dt, controls, upgrades);
}

export function cutWorkpiece(wp: Workpiece, cutU: number): { ok: boolean; message: string } {
  if (wp.phase !== 'working') return { ok: false, message: '当前阶段不能剪切。' };
  const recipe = findRecipe(wp.recipeId);
  const u = Math.max(0.18, Math.min(0.96, cutU));
  const nextCount = Math.max(10, Math.min(wp.activeCells, Math.round(u * wp.cellCount)));
  const cutIndex = Math.min(wp.activeCells - 1, nextCount - 1);
  const outerC = wp.T[cutIndex * wp.radialLayers + wp.radialLayers - 1];

  if (outerC < recipe.cutSafeC - 120) {
    for (let i = Math.max(0, cutIndex - 2); i <= Math.min(wp.activeCells - 1, cutIndex + 2); i += 1) {
      wp.crack[i] = Math.max(wp.crack[i], 0.9);
      addCrackRecord(wp, i, '冷剪造成崩裂');
    }
    fail(wp, '剪刀接触处太冷，冷硬玻璃被剪出放射裂纹并炸裂。');
    return { ok: false, message: '太冷了！剪刀让工件直接崩裂。' };
  }

  wp.activeCells = nextCount;
  // Slight rim thickening/fold at the fresh mouth.
  for (let k = Math.max(0, nextCount - 3); k < nextCount; k += 1) {
    wp.volume[k] *= 1.018;
    wp.R[k] *= outerC > recipe.gloryC - 250 ? 1.012 : 0.995;
  }
  reconstructCenterline(wp);

  if (outerC < recipe.cutSafeC) {
    wp.crack[cutIndex] = Math.max(wp.crack[cutIndex], 0.38);
    addCrackRecord(wp, cutIndex, '低温剪口微裂');
    return { ok: true, message: '剪口偏冷，出现了轻微裂纹；退火时可能扩展。' };
  }
  if (outerC > recipe.gloryC - 40) {
    wp.curvature[nextCount - 1] -= 1.2;
    return { ok: true, message: '剪口很热，口沿偏软，注意快转找圆。' };
  }
  return { ok: true, message: '咔嚓——多余料头落下，口沿已打开。' };
}

export interface ShapeScore {
  total: number;
  profile: number;
  straight: number;
  thickness: number;
  heightM: number;
  maxDroopM: number;
  meanThicknessMm: number;
}

export function scoreShape(wp: Workpiece, order?: Order): ShapeScore {
  const n = wp.activeCells;
  let height = 0;
  const thicknesses: number[] = [];
  for (let i = 0; i < n; i += 1) {
    height += wp.dx[i];
    thicknesses.push(wallThickness(wp, i));
  }

  let maxDroop = 0;
  for (let i = 0; i <= n; i += 1) maxDroop = Math.max(maxDroop, Math.abs(wp.sag[i]));
  const straight = Math.max(0, Math.min(100, 100 * (1 - maxDroop / Math.max(0.018, height * 0.2))));

  const meanT = thicknesses.reduce((a, b) => a + b, 0) / thicknesses.length;
  const variance = thicknesses.reduce((a, b) => a + (b - meanT) ** 2, 0) / thicknesses.length;
  const cv = Math.sqrt(variance) / Math.max(0.001, meanT);
  const thicknessScore = Math.max(0, Math.min(100, 100 * (1 - Math.min(1, cv / 0.7))));

  let profile = 72;
  if (order) {
    const samples = 28;
    let sumSq = 0;
    let heightPenalty = Math.abs(height - order.profile.height) / (order.profile.height * 0.2);
    for (let s = 0; s < samples; s += 1) {
      const u = s / (samples - 1);
      const idx = Math.min(n - 1, Math.max(0, Math.round(u * (n - 1))));
      const target = targetRadius(order.profile, u);
      const normalizedError = (wp.R[idx] - target) / (target * order.tolerance);
      sumSq += normalizedError * normalizedError;
    }
    const rmse = Math.sqrt(sumSq / samples);
    profile = Math.max(0, Math.min(100, 100 - 37 * rmse ** 1.18 - 12 * heightPenalty));
  }

  const crackPenalty = wp.cracks.reduce((sum, c) => sum + c.severity * 18, 0);
  const total = Math.max(
    0,
    Math.min(100, profile * 0.7 + straight * 0.18 + thicknessScore * 0.12 - crackPenalty),
  );
  return {
    total,
    profile,
    straight,
    thickness: thicknessScore,
    heightM: height,
    maxDroopM: maxDroop,
    meanThicknessMm: meanT * 1000,
  };
}

export function beginAnneal(
  wp: Workpiece,
  mode: AnnealMode,
  upgrades: UpgradeLevels,
  customRate?: number,
): void {
  const recipe = findRecipe(wp.recipeId);
  const shape = scoreShape(wp, orderTarget(wp.orderId));
  wp.shapeScore = shape.total;
  wp.straightScore = shape.straight;
  wp.thicknessScore = shape.thickness;
  wp.phase = 'annealing';

  let maxThickness = 0.002;
  let criticalCell = 0;
  let coreSum = 0;
  let surfaceSum = 0;
  for (let i = 0; i < wp.activeCells; i += 1) {
    const thickness = wallThickness(wp, i);
    if (thickness > maxThickness) {
      maxThickness = thickness;
      criticalCell = i;
    }
    const layers = wp.radialLayers;
    coreSum += wp.T[i * layers + 2];
    surfaceSum += wp.T[i * layers + layers - 1];
    const gradient = wp.T[i * layers + 2] - wp.T[i * layers + layers - 1];
    wp.prevGradient[i] = gradient;
  }
  const avgCoreC = coreSum / wp.activeCells;
  const avgSurfaceC = surfaceSum / wp.activeCells;
  const criticalCoreC =
    Array.from({ length: wp.radialLayers }, (_, j) => wp.T[criticalCell * wp.radialLayers + j]).reduce((a, b) => a + b, 0) /
    wp.radialLayers;
  const qCrit = criticalCoolingRate(recipe, maxThickness);
  wp.prevLockedStress.fill(0);
  const annealer = upgrades['annealer'] ?? 0;
  const safeMargin = 0.38 - annealer * 0.035;

  let holdDuration = 1450;
  let targetRate = qCrit * safeMargin;
  if (mode === 'fast') {
    holdDuration = 360;
    targetRate = qCrit * (2.05 - annealer * 0.12);
  } else if (mode === 'quench') {
    holdDuration = 0;
    targetRate = Math.max(8, qCrit * 6);
  } else if (mode === 'custom') {
    holdDuration = 820;
    targetRate = Math.max(0.02, customRate ?? qCrit * 0.5);
  }

  const holdC = annealTemperatureC(recipe);
  const gentleStart = mode === 'quench' ? 25 : Math.max(holdC, avgCoreC + 8);
  wp.anneal = {
    status: 'holding',
    mode,
    elapsed: 0,
    holdDuration,
    targetRate,
    timeWarp: 300,
    holdC,
    startC: avgCoreC,
    lastCoreC: criticalCoreC,
    lehrTargetC: gentleStart,
    coolingElapsed: 0,
    measuredRate: 0,
    maxMeasuredRate: 0,
    qCritMin: qCrit,
    criticalCell,
    maxStressMPa: 0,
    samples: [
      {
        t: 0,
        coreC: avgCoreC,
        surfaceC: avgSurfaceC,
        stressMPa: 0,
        rate: 0,
      },
    ],
    verdict: '退火炉已闭合，正在按壁厚控制初始降温并保温松弛应力。',
  };
}

function finishAnneal(wp: Workpiece, shattered: boolean, verdict: string): void {
  if (!wp.anneal) return;
  wp.anneal.verdict = verdict;
  if (shattered) {
    wp.anneal.status = 'shattered';
    wp.phase = 'failed';
    wp.failReason = verdict;
  } else {
    wp.anneal.status = 'done';
    wp.phase = 'finished';
  }
}

export function stepAnneal(wp: Workpiece, rawDt: number, _upgrades: UpgradeLevels): void {
  const anneal = wp.anneal;
  if (!anneal || wp.phase !== 'annealing' || anneal.status === 'done' || anneal.status === 'shattered') {
    return;
  }
  const frameDt = Math.min(0.05, Math.max(0, rawDt));
  const totalSimDt = frameDt * anneal.timeWarp;
  if (totalSimDt <= 0) return;

  const recipe = findRecipe(wp.recipeId);
  const shearModulus = recipe.youngModulus / (2 * (1 + recipe.poisson));
  const stressScale = (recipe.youngModulus * recipe.expansion) / (1 - recipe.poisson);
  let remaining = totalSimDt;
  const chunkMax = 0.25;

  while (
    remaining > 0 &&
    (anneal.status as string) !== 'shattered' &&
    (anneal.status as string) !== 'done'
  ) {
    const dt = Math.min(chunkMax, remaining);
    remaining -= dt;
    anneal.elapsed += dt;

    if (anneal.status === 'holding') {
      if (anneal.mode === 'quench') {
        anneal.lehrTargetC = 25;
      } else if (anneal.lehrTargetC > anneal.holdC + 0.5) {
        const preCoolRate =
          anneal.mode === 'fast' ? anneal.qCritMin * 1.08 : anneal.qCritMin * 0.3;
        anneal.lehrTargetC = Math.max(
          anneal.holdC,
          anneal.lehrTargetC - Math.max(0.05, preCoolRate) * dt,
        );
      } else if (anneal.lehrTargetC < anneal.holdC - 0.5) {
        anneal.lehrTargetC = Math.min(anneal.holdC, anneal.lehrTargetC + 3 * dt);
      } else {
        anneal.lehrTargetC = anneal.holdC;
      }

      if (
        anneal.elapsed >= anneal.holdDuration &&
        Math.abs(anneal.lehrTargetC - anneal.holdC) < 1
      ) {
        anneal.status = 'cooling';
        anneal.coolingElapsed = 0;
      }
    }

    if (anneal.status === 'cooling') {
      anneal.coolingElapsed += dt;
      if (anneal.mode === 'quench') {
        anneal.lehrTargetC = 25;
      } else {
        anneal.lehrTargetC = Math.max(
          25,
          anneal.holdC - anneal.targetRate * anneal.coolingElapsed,
        );
      }
    }

    const convection = anneal.mode === 'quench' ? 95 : anneal.mode === 'fast' ? 48 : 32;
    stepThermal(wp, dt, { ambientC: anneal.lehrTargetC, convection });

    let coreSum = 0;
    let surfaceSum = 0;
    let maxStress = 0;
    for (let i = 0; i < wp.activeCells; i += 1) {
      const layers = wp.radialLayers;
      const base = i * layers;
      const coreC = wp.T[base + 2];
      const surfaceC = wp.T[base + layers - 1];
      coreSum += coreC;
      surfaceSum += surfaceC;
      const gradient = coreC - surfaceC;
      const dg = gradient - wp.prevGradient[i];
      wp.stress[i] += stressScale * dg;

      const coreLogEta = vftLogEta(recipe, coreC);
      const lock = smoothstep(recipe.annealLogEta, recipe.strainLogEta, coreLogEta);
      const lockedTarget = lock * stressScale * gradient;
      wp.stress[i] += lockedTarget - wp.prevLockedStress[i];
      wp.prevLockedStress[i] = lockedTarget;

      const eta = viscosity(recipe, coreC);
      const tau = Math.max(0.08, eta / shearModulus);
      wp.stress[i] *= Math.exp(-dt / tau);
      wp.prevGradient[i] = gradient;

      const stressAbs = Math.abs(wp.stress[i]);
      maxStress = Math.max(maxStress, stressAbs);
      const limit = recipe.strength * (1 - Math.min(0.92, wp.crack[i] * 0.82));
      if (stressAbs > limit) {
        const rateText = anneal.maxMeasuredRate.toFixed(2);
        finishAnneal(
          wp,
          true,
          `应力达到 ${(stressAbs / 1e6).toFixed(1)} MPa，超过该截面的破裂强度；实测降温峰值 ${rateText} K/s，临界速率约 ${anneal.qCritMin.toFixed(2)} K/s。`,
        );
        break;
      }
    }

    if ((anneal.status as string) === 'shattered') break;

    const coreC = coreSum / wp.activeCells;
    const surfaceC = surfaceSum / wp.activeCells;
    const criticalBase = anneal.criticalCell * wp.radialLayers;
    let criticalMeanNow = 0;
    for (let j = 0; j < wp.radialLayers; j += 1) criticalMeanNow += wp.T[criticalBase + j];
    criticalMeanNow /= wp.radialLayers;
    const chunkRate = Math.max(0, -(criticalMeanNow - anneal.lastCoreC) / dt);
    anneal.measuredRate += (chunkRate - anneal.measuredRate) * 0.35;
    anneal.maxMeasuredRate = Math.max(anneal.maxMeasuredRate, anneal.measuredRate);
    anneal.lastCoreC = criticalMeanNow;
    const last = anneal.samples[anneal.samples.length - 1];
    anneal.maxStressMPa = Math.max(anneal.maxStressMPa, maxStress / 1e6);

    if (anneal.elapsed - (last?.t ?? 0) >= 2 || anneal.samples.length === 0) {
      anneal.samples.push({
        t: anneal.elapsed,
        coreC,
        surfaceC,
        stressMPa: maxStress / 1e6,
        rate: anneal.measuredRate,
      });
      if (anneal.samples.length > 520) anneal.samples.shift();
    }

    if (anneal.status === 'cooling' && coreC < 68) {
      anneal.samples.push({
        t: anneal.elapsed,
        coreC,
        surfaceC,
        stressMPa: maxStress / 1e6,
        rate: anneal.measuredRate,
      });
      const ratio = anneal.maxMeasuredRate / anneal.qCritMin;
      const verdict =
        ratio > 1
          ? `作品幸存，但峰值降温 ${anneal.maxMeasuredRate.toFixed(2)} K/s 已超过厚壁处临界值 ${anneal.qCritMin.toFixed(2)} K/s，残留应力偏高。`
          : `退火完成。峰值降温 ${anneal.maxMeasuredRate.toFixed(2)} K/s，低于临界值 ${anneal.qCritMin.toFixed(2)} K/s。`;
      finishAnneal(wp, false, verdict);
      break;
    }
  }
}

export function annealQuality(wp: Workpiece): number {
  if (!wp.anneal) return 0;
  const residual = wp.anneal.maxStressMPa;
  return Math.max(0, Math.min(100, 100 - residual * 1.45));
}
