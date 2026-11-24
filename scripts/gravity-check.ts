import { findRecipe } from '../src/game/data';
import { createWorkpiece, effectiveViscosity, stepWorking } from '../src/game/physics';
import type { BenchControls } from '../src/game/types';

for (const rpm of [0, 60, 180]) {
  const wp = createWorkpiece('soda-lime', undefined, {});
  const c: BenchControls = {
    blowing: false,
    heating: rpm === 0, // keep the stopped piece hot enough to isolate gravity
    clamping: false,
    pressing: false,
    pressure: 0.5,
    toolU: 0.7,
    toolWidth: 0.05,
    targetRpm: rpm,
  };
  for (let f = 0; f < 600; f += 1) stepWorking(wp, 1 / 60, c, {});
  const mouth = wp.activeCells - 1;
  const recipe = findRecipe(wp.recipeId);
  const avgT = wp.T.reduce((a, b) => a + b, 0) / wp.T.length;
  console.log({
    rpm,
    avgT: avgT.toFixed(0),
    eta20: effectiveViscosity(wp, recipe, 20).toExponential(2),
    dx20: wp.dx[20].toFixed(5),
    sagCm: (wp.sag[wp.activeCells] * 100).toFixed(2),
    minCurvature: Math.min(...wp.curvature).toFixed(2),
    mouthRadiusMm: (wp.R[mouth] * 1000).toFixed(1),
    midRadiusMm: (wp.R[20] * 1000).toFixed(1),
    phase: wp.phase,
  });
}
