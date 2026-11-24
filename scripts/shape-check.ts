import { ORDERS, targetRadius } from '../src/game/data';
import { createWorkpiece, cutWorkpiece, scoreShape, stepWorking } from '../src/game/physics';
import type { BenchControls } from '../src/game/types';

const c: BenchControls = {
  blowing: false,
  heating: false,
  clamping: false,
  pressing: false,
  pressure: 0.65,
  toolU: 0.7,
  toolWidth: 0.05,
  targetRpm: 95,
};

for (const order of ORDERS) {
  const wp = createWorkpiece(order.preferredRecipeId ?? 'soda-lime', order.id, {});
  const s0 = scoreShape(wp, order);

  const ideal = createWorkpiece(order.preferredRecipeId ?? 'soda-lime', order.id, {});
  ideal.activeCells = 36;
  for (let i = 0; i < ideal.activeCells; i += 1) {
    ideal.R[i] = targetRadius(order.profile, i / (ideal.activeCells - 1));
    ideal.dx[i] = order.profile.height / ideal.activeCells;
  }
  ideal.sag.fill(0);
  const sIdeal = scoreShape(ideal, order);

  // Gentle controlled blow in short pulses, with rotation.
  for (let tick = 0; tick < 900; tick += 1) {
    c.blowing = tick % 90 < 34;
    c.pressure = order.kind === 'bowl' ? 0.82 : 0.62;
    c.targetRpm = 105;
    if (tick > 420 && tick < 650 && order.profile.neckRadius < order.profile.bellyRadius * 0.65) {
      c.clamping = tick % 2 < 1;
      c.toolU = order.profile.neckU;
      c.pressure = 0.72;
    } else {
      c.clamping = false;
    }
    stepWorking(wp, 1 / 60, c, { 'precision-tools': 1 });
    if (wp.phase !== 'working') break;
  }
  c.blowing = false;
  c.clamping = false;
  if (wp.phase === 'working') cutWorkpiece(wp, order.kind === 'cup' ? 0.82 : 0.94);
  const s1 = wp.phase === 'working' ? scoreShape(wp, order) : null;
  console.log(order.id, {
    initial: s0.total.toFixed(0),
    ideal: sIdeal.total.toFixed(0),
    scripted: s1?.total.toFixed(0) ?? wp.phase,
    profile: s1?.profile.toFixed(0),
    straight: s1?.straight.toFixed(0),
    thickness: s1?.thickness.toFixed(0),
    min: order.minScore,
  });
}
