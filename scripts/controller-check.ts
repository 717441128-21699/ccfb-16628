import { ORDERS, targetRadius } from '../src/game/data';
import { createWorkpiece, cutWorkpiece, scoreShape, stepWorking } from '../src/game/physics';
import type { BenchControls } from '../src/game/types';

const order = ORDERS[0];
const wp = createWorkpiece(order.preferredRecipeId ?? 'soda-lime', order.id, { 'precision-tools': 2 });
const controls: BenchControls = {
  blowing: false,
  heating: false,
  clamping: false,
  pressing: false,
  pressure: 0.5,
  toolU: 0.5,
  toolWidth: 0.05,
  targetRpm: 96,
};

cutWorkpiece(wp, order.profile.height / 0.22);
let mode: 'wait' | 'blow' | 'clamp' | 'heat' = 'heat';
let hold = 30;

for (let frame = 0; frame < 60 * 120 && wp.phase === 'working'; frame += 1) {
  hold -= 1;
  if (hold <= 0) {
    let core = 0;
    let outer = 0;
    let worstExcess = -Infinity;
    let worstU = 0.5;
    let deficitSum = 0;
    for (let i = 0; i < wp.activeCells; i += 1) {
      core += wp.T[i * wp.radialLayers + 2];
      outer += wp.T[i * wp.radialLayers + wp.radialLayers - 1];
      const u = i / (wp.activeCells - 1);
      const err = wp.R[i] - targetRadius(order.profile, u);
      if (err > worstExcess && i > 1 && i < wp.activeCells - 1) {
        worstExcess = err;
        worstU = u;
      }
      deficitSum += Math.max(0, -err);
    }
    core /= wp.activeCells;
    outer /= wp.activeCells;
    const avgDeficit = deficitSum / wp.activeCells;

    if (outer < 790) {
      mode = 'heat';
      hold = 20;
    } else if (worstExcess > 0.0035) {
      mode = 'clamp';
      controls.toolU = worstU;
      controls.pressure = 0.55;
      hold = 16;
    } else if (avgDeficit > 0.003 && core > 840) {
      mode = 'blow';
      controls.pressure = 0.34;
      hold = 7;
    } else {
      mode = 'wait';
      hold = 12;
    }
  }

  controls.heating = mode === 'heat';
  controls.clamping = mode === 'clamp';
  controls.blowing = mode === 'blow';
  stepWorking(wp, 1 / 60, controls, { 'precision-tools': 2 });
}

const score = wp.phase === 'working' ? scoreShape(wp, order) : null;
console.log({
  phase: wp.phase,
  reason: wp.failReason,
  score: score?.total.toFixed(1),
  profile: score?.profile.toFixed(1),
  straight: score?.straight.toFixed(1),
  droopCm: score ? (score.maxDroopM * 100).toFixed(2) : undefined,
  heightCm: score ? (score.heightM * 100).toFixed(2) : undefined,
  thickness: score?.thickness.toFixed(1),
  required: order.minScore,
  cracks: wp.cracks.length,
});
if (!score || score.total < order.minScore) process.exitCode = 1;
