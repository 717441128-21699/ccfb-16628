import { ORDERS, findRecipe } from '../src/game/data';
import {
  beginAnneal,
  createWorkpiece,
  criticalCoolingRate,
  scoreShape,
  stepAnneal,
  stepWorking,
  wallThickness,
} from '../src/game/physics';
import type { BenchControls } from '../src/game/types';

function controls(partial: Partial<BenchControls> = {}): BenchControls {
  return {
    blowing: false,
    heating: false,
    clamping: false,
    pressing: false,
    pressure: 0.7,
    toolU: 0.68,
    toolWidth: 0.055,
    targetRpm: 70,
    ...partial,
  };
}

function run(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${label}`);
  } catch (error) {
    console.error(`FAIL ${label}`, error);
    process.exitCode = 1;
  }
}

run('create and cool for 20 simulated seconds', () => {
  const wp = createWorkpiece('soda-lime', ORDERS[0].id, {});
  const c = controls();
  for (let f = 0; f < 1200; f += 1) stepWorking(wp, 1 / 60, c, {});
  let avg = 0;
  let outer = 0;
  let wmax = 0;
  for (let i = 0; i < wp.activeCells; i += 1) {
    for (let j = 0; j < wp.radialLayers; j += 1) avg += wp.T[i * wp.radialLayers + j];
    outer += wp.T[i * wp.radialLayers + 4];
    wmax = Math.max(wmax, wallThickness(wp, i));
  }
  avg /= wp.activeCells * wp.radialLayers;
  outer /= wp.activeCells;
  console.log({ phase: wp.phase, avg: avg.toFixed(1), outer: outer.toFixed(1), droop: (wp.sag[wp.activeCells] * 100).toFixed(2) + 'cm', wmax: (wmax * 1000).toFixed(2), qcrit: criticalCoolingRate(findRecipe('soda-lime'), wmax)});
  if (wp.phase !== 'working') throw new Error('unexpected fail during normal rotation');
  if (outer > avg) throw new Error('surface should not be hotter on average');
});

run('blow expands soft parison', () => {
  const wp = createWorkpiece('soda-lime', ORDERS[0].id, {});
  const before = wp.R[20];
  const c = controls({ blowing: true, targetRpm: 100, pressure: 0.85 });
  for (let f = 0; f < 240; f += 1) stepWorking(wp, 1 / 60, c, {});
  const after = wp.R[20];
  console.log({ before: (before * 1000).toFixed(1), after: (after * 1000).toFixed(1), ratio: (after / before).toFixed(2), phase: wp.phase, cracks: wp.cracks.length });
  if (after < before * 1.25) throw new Error('blow expansion too weak');
});

run('cold clamp cracks/fails', () => {
  const wp = createWorkpiece('soda-lime', undefined, {});
  wp.T.fill(260);
  const c = controls({ clamping: true, pressure: 1, targetRpm: 0 });
  for (let f = 0; f < 240 && wp.phase === 'working'; f += 1) stepWorking(wp, 1 / 60, c, { 'precision-tools': 0 });
  console.log({ phase: wp.phase, reason: wp.failReason, maxCrack: Math.max(...wp.crack) });
  if (wp.phase !== 'failed') throw new Error('cold clamp should fail');
});

for (const mode of ['standard', 'fast', 'quench'] as const) {
  run(`anneal ${mode} gives a stress verdict`, () => {
    const wp = createWorkpiece('soda-lime', ORDERS[0].id, {});
    const c = controls({ blowing: true, pressure: 0.75, targetRpm: 100 });
    for (let f = 0; f < 300 && wp.phase === 'working'; f += 1) stepWorking(wp, 1 / 60, c, {});
    c.blowing = false;
    beginAnneal(wp, mode, { annealer: 1 });
    if (!wp.anneal) throw new Error('anneal missing');
    wp.anneal.timeWarp = 180;
    let steps = 0;
    while ((wp.phase as string) === 'annealing' && steps < 20000) {
      stepAnneal(wp, 1 / 30, { annealer: 1 });
      steps += 1;
    }
    const shape = scoreShape(wp, ORDERS[0]);
    console.log({
      mode,
      phase: wp.phase,
      steps,
      simMin: (wp.anneal.elapsed / 60).toFixed(1),
      maxStress: wp.anneal.maxStressMPa.toFixed(1),
      maxRate: wp.anneal.maxMeasuredRate.toFixed(2),
      qcrit: wp.anneal.qCritMin.toFixed(2),
      shape: shape.total.toFixed(0),
      verdict: wp.anneal.verdict,
    });
    if (mode === 'standard' && wp.phase !== 'finished') throw new Error('standard anneal should survive');
    if (mode === 'quench' && wp.phase !== 'failed') throw new Error('quench should shatter');
  });
}

run('working step stays fast enough for 60fps', () => {
  const wp = createWorkpiece('borosilicate', ORDERS[3].id, {});
  const c = controls({ blowing: true, clamping: true });
  const start = performance.now();
  const frames = 600;
  for (let f = 0; f < frames; f += 1) stepWorking(wp, 1 / 60, c, { 'precision-tools': 2 });
  const elapsed = performance.now() - start;
  const perFrame = elapsed / frames;
  console.log({ elapsedMs: elapsed.toFixed(1), perFrameMs: perFrame.toFixed(3), budgetMs: 16.7 });
  if (perFrame > 4) throw new Error('physics too slow');
});
