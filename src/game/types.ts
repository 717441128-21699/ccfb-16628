export type PageId = 'bench' | 'temperature' | 'orders' | 'manage';

export type Phase = 'idle' | 'working' | 'annealing' | 'finished' | 'failed';

export interface VFTParams {
  /** log10(eta / Pa s) = A + B / (T_K - T0) */
  A: number;
  B: number;
  T0: number;
}

export interface Recipe {
  id: string;
  name: string;
  subtitle: string;
  vft: VFTParams;
  /** kg/m^3 */
  density: number;
  /** W/(m K) */
  conductivity: number;
  /** J/(kg K) */
  heatCapacity: number;
  emissivity: number;
  /** 1/K */
  expansion: number;
  /** Pa */
  youngModulus: number;
  poisson: number;
  /** Pa, cold modulus of rupture */
  strength: number;
  /** log10 eta at annealing point, commonly 13 */
  annealLogEta: number;
  strainLogEta: number;
  gatherC: number;
  gloryC: number;
  toolSafeC: number;
  cutSafeC: number;
  color: [number, number, number];
  opacity: number;
  costPerKg: number;
  requiredUpgrade?: string;
}

export interface ProfileParams {
  height: number;
  baseRadius: number;
  bellyRadius: number;
  bellyU: number;
  neckRadius: number;
  neckU: number;
  mouthRadius: number;
  flare: number;
  width: number;
}

export interface Order {
  id: string;
  title: string;
  client: string;
  kind: 'cup' | 'vase' | 'bowl';
  quantity: number;
  reward: number;
  reputation: number;
  tolerance: number;
  minScore: number;
  preferredRecipeId?: string;
  deadline: string;
  story: string;
  profile: ProfileParams;
}

export interface UpgradeDef {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  costs: number[];
}

export interface FinishedWork {
  id: string;
  name: string;
  recipeId: string;
  orderId?: string;
  score: number;
  shapeScore: number;
  annealScore: number;
  maxStressMPa: number;
  date: string;
  profileSummary: string;
}

export interface CrackRecord {
  u: number;
  severity: number;
  reason: string;
  time: number;
}

export interface AnnealSample {
  t: number;
  coreC: number;
  surfaceC: number;
  stressMPa: number;
  rate: number;
}

export type AnnealMode = 'standard' | 'fast' | 'quench' | 'custom';
export type AnnealStatus = 'ready' | 'holding' | 'cooling' | 'done' | 'shattered';

export interface AnnealState {
  status: AnnealStatus;
  mode: AnnealMode;
  elapsed: number;
  holdDuration: number;
  targetRate: number;
  timeWarp: number;
  holdC: number;
  startC: number;
  lastCoreC: number;
  lehrTargetC: number;
  coolingElapsed: number;
  measuredRate: number;
  maxMeasuredRate: number;
  qCritMin: number;
  criticalCell: number;
  maxStressMPa: number;
  samples: AnnealSample[];
  verdict: string;
}

export interface Workpiece {
  id: number;
  recipeId: string;
  orderId?: string;
  phase: Phase;
  failReason?: string;
  createdAt: number;
  simTime: number;

  cellCount: number;
  activeCells: number;
  /** Outer radius, m */
  R: Float32Array;
  /** Axial cell length, m. volume_i = glassArea_i * dx_i */
  dx: Float32Array;
  /** Conserved glass volume per cell before cutting, m^3 */
  volume: Float32Array;
  /** Temperature [cell][radial layer], degrees C */
  T: Float32Array;
  radialLayers: number;
  /** Accumulated crack severity 0..1 per cell */
  crack: Float32Array;
  /** Maxwell stress, Pa per cell */
  stress: Float32Array;
  /** Previous radial temperature difference, K */
  prevGradient: Float32Array;
  /** Previous viscosity-locked thermal stress target, Pa */
  prevLockedStress: Float32Array;
  /** Viscous beam curvature, 1/m per cell */
  curvature: Float32Array;
  sag: Float32Array;
  centerX: Float32Array;

  rpm: number;
  targetRpm: number;
  pressure: number;
  blowEnergy: number;
  symmetry: number;

  inGlory: boolean;
  gloryBonusC: number;
  ambientC: number;
  pipeChill: number;

  cracks: CrackRecord[];
  warnings: string[];
  shapeScore?: number;
  thicknessScore?: number;
  straightScore?: number;
  anneal?: AnnealState;
}

export interface BenchControls {
  blowing: boolean;
  heating: boolean;
  clamping: boolean;
  pressing: boolean;
  pressure: number;
  toolU: number;
  toolWidth: number;
  targetRpm: number;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'error';
  text: string;
}
