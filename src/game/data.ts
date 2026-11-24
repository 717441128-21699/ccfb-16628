import type { Order, ProfileParams, Recipe, UpgradeDef } from './types';

export const RADIAL_LAYERS = 5;
export const CELL_COUNT = 42;

export const RECIPES: Recipe[] = [
  {
    id: 'soda-lime',
    name: '钠钙透明玻璃',
    subtitle: '新手友好 · 工作区间宽 · 冷却较快',
    vft: { A: -2.62, B: 4300, T0: 540 },
    density: 2480,
    conductivity: 1.05,
    heatCapacity: 960,
    emissivity: 0.86,
    expansion: 9.1e-6,
    youngModulus: 68e9,
    poisson: 0.22,
    strength: 46e6,
    annealLogEta: 13,
    strainLogEta: 14.5,
    gatherC: 1035,
    gloryC: 1180,
    toolSafeC: 690,
    cutSafeC: 590,
    color: [0.72, 0.91, 1.0],
    opacity: 0.34,
    costPerKg: 4.2,
  },
  {
    id: 'lead-crystal',
    name: '铅晶玻璃',
    subtitle: '高折射 · 低温柔软 · 口沿易张',
    vft: { A: -2.82, B: 4050, T0: 438 },
    density: 3150,
    conductivity: 0.82,
    heatCapacity: 840,
    emissivity: 0.8,
    expansion: 8.4e-6,
    youngModulus: 61e9,
    poisson: 0.23,
    strength: 41e6,
    annealLogEta: 13,
    strainLogEta: 14.5,
    gatherC: 970,
    gloryC: 1120,
    toolSafeC: 610,
    cutSafeC: 520,
    color: [1.0, 0.88, 0.58],
    opacity: 0.3,
    costPerKg: 9.5,
  },
  {
    id: 'borosilicate',
    name: '硼硅硬质玻璃',
    subtitle: '低膨胀 · 抗热震 · 需要更高炉温',
    vft: { A: -2.08, B: 5200, T0: 468 },
    density: 2230,
    conductivity: 1.18,
    heatCapacity: 1010,
    emissivity: 0.84,
    expansion: 3.3e-6,
    youngModulus: 64e9,
    poisson: 0.2,
    strength: 58e6,
    annealLogEta: 13,
    strainLogEta: 14.5,
    gatherC: 1160,
    gloryC: 1280,
    toolSafeC: 720,
    cutSafeC: 610,
    color: [0.78, 1.0, 0.94],
    opacity: 0.32,
    costPerKg: 7.1,
  },
  {
    id: 'fused-quartz',
    name: '熔融石英',
    subtitle: '极高工作温度 · 几乎不裂 · 需高温炉',
    vft: { A: -1.55, B: 15400, T0: 320 },
    density: 2200,
    conductivity: 1.35,
    heatCapacity: 1050,
    emissivity: 0.9,
    expansion: 0.55e-6,
    youngModulus: 72e9,
    poisson: 0.17,
    strength: 67e6,
    annealLogEta: 13,
    strainLogEta: 14.5,
    gatherC: 1760,
    gloryC: 1920,
    toolSafeC: 1080,
    cutSafeC: 900,
    color: [0.9, 0.96, 1.0],
    opacity: 0.24,
    costPerKg: 22,
    requiredUpgrade: 'high-furnace',
  },
];

export const ORDERS: Order[] = [
  {
    id: 'order-tea-cups',
    title: '两只天青茶盏',
    client: '巷口茶馆 · 林姐',
    kind: 'cup',
    quantity: 2,
    reward: 420,
    reputation: 12,
    tolerance: 0.24,
    minScore: 64,
    deadline: '今日打烊前',
    story: '要厚底、宽口、拿在手里稳。杯壁不必极薄，但两只的轮廓要像一个模子出来的。',
    preferredRecipeId: 'soda-lime',
    profile: {
      height: 0.135,
      baseRadius: 0.034,
      bellyRadius: 0.052,
      bellyU: 0.34,
      neckRadius: 0.05,
      neckU: 0.72,
      mouthRadius: 0.057,
      flare: 0.006,
      width: 0.2,
    },
  },
  {
    id: 'order-honey-vase',
    title: '蜂蜜色圆肚小花瓶',
    client: '花店「野枝」',
    kind: 'vase',
    quantity: 1,
    reward: 680,
    reputation: 18,
    tolerance: 0.2,
    minScore: 68,
    deadline: '3 日内',
    story: '圆肚要能盛水，颈部收窄，口沿微微外张。铅晶的暖黄色很配店里的木架。',
    preferredRecipeId: 'lead-crystal',
    profile: {
      height: 0.235,
      baseRadius: 0.04,
      bellyRadius: 0.073,
      bellyU: 0.38,
      neckRadius: 0.027,
      neckU: 0.72,
      mouthRadius: 0.043,
      flare: 0.012,
      width: 0.16,
    },
  },
  {
    id: 'order-tall-glass',
    title: '直身冷饮杯',
    client: '露营酒吧 · 北岸',
    kind: 'cup',
    quantity: 4,
    reward: 760,
    reputation: 20,
    tolerance: 0.18,
    minScore: 70,
    deadline: '本周周末',
    story: '直筒、厚底、口沿略敞。他们会用洗碗机，退火不足的杯子一定会被退回来。',
    preferredRecipeId: 'soda-lime',
    profile: {
      height: 0.18,
      baseRadius: 0.039,
      bellyRadius: 0.046,
      bellyU: 0.32,
      neckRadius: 0.047,
      neckU: 0.78,
      mouthRadius: 0.052,
      flare: 0.006,
      width: 0.12,
    },
  },
  {
    id: 'order-borosilicate-carafe',
    title: '硼硅凉水壶',
    client: '实验室咖啡',
    kind: 'vase',
    quantity: 1,
    reward: 980,
    reputation: 28,
    tolerance: 0.17,
    minScore: 74,
    deadline: '5 日内',
    story: '要承受冰水和热萃交替。轮廓是简洁锥瓶，退火必须慢，应力报告要漂亮。',
    preferredRecipeId: 'borosilicate',
    profile: {
      height: 0.255,
      baseRadius: 0.052,
      bellyRadius: 0.061,
      bellyU: 0.28,
      neckRadius: 0.034,
      neckU: 0.68,
      mouthRadius: 0.041,
      flare: 0.008,
      width: 0.13,
    },
  },
  {
    id: 'order-wedding-vases',
    title: '婚礼布置细颈瓶',
    client: '策划工作室 MOSS',
    kind: 'vase',
    quantity: 3,
    reward: 1450,
    reputation: 42,
    tolerance: 0.15,
    minScore: 78,
    deadline: '两周',
    story: '细颈、削肩、小口；桌上要排成一列。任何歪斜和冷裂都会在烛光下被放大。',
    preferredRecipeId: 'soda-lime',
    profile: {
      height: 0.275,
      baseRadius: 0.038,
      bellyRadius: 0.064,
      bellyU: 0.36,
      neckRadius: 0.021,
      neckU: 0.7,
      mouthRadius: 0.031,
      flare: 0.006,
      width: 0.13,
    },
  },
  {
    id: 'order-quartz-bowl',
    title: '石英浅钵试样',
    client: '光学实验室',
    kind: 'bowl',
    quantity: 1,
    reward: 2600,
    reputation: 60,
    tolerance: 0.13,
    minScore: 82,
    deadline: '长期委托',
    story: '他们知道石英很难烧。需要高温炉、极慢退火和近乎无应力的浅弧轮廓。',
    preferredRecipeId: 'fused-quartz',
    profile: {
      height: 0.105,
      baseRadius: 0.035,
      bellyRadius: 0.083,
      bellyU: 0.48,
      neckRadius: 0.086,
      neckU: 0.82,
      mouthRadius: 0.088,
      flare: 0.004,
      width: 0.24,
    },
  },
];

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'glory-heater',
    name: '聚焰回火炉',
    description: '每级提高回炉升温速度与炉温 45°C，减少表面冷壳。',
    maxLevel: 3,
    costs: [520, 1100, 1900],
  },
  {
    id: 'precision-tools',
    name: '钨钢精修工具',
    description: '每级让夹压区域更集中，并降低冷表面微裂累积。',
    maxLevel: 3,
    costs: [360, 820, 1450],
  },
  {
    id: 'annealer',
    name: '数控退火窑',
    description: '每级降低 12% 允许降温速率裕度误差，并加快保温时间模拟。',
    maxLevel: 3,
    costs: [700, 1350, 2200],
  },
  {
    id: 'high-furnace',
    name: '高温熔窑',
    description: '可达到熔融石英所需温度，解锁石英配方与光学订单。',
    maxLevel: 1,
    costs: [2400],
  },
  {
    id: 'showroom',
    name: '沿街展窗',
    description: '每级使所有作品售价与订单赏金提高 12%。',
    maxLevel: 3,
    costs: [650, 1250, 2000],
  },
];

function gaussian(u: number, center: number, width: number): number {
  const x = (u - center) / width;
  return Math.exp(-x * x);
}

/** Target radius in metres. u=0 base / pipe end, u=1 mouth. */
export function targetRadius(p: ProfileParams, u: number): number {
  const t = Math.max(0, Math.min(1, u));
  const baseToBelly = p.baseRadius + (p.bellyRadius - p.baseRadius) * smoothstep(0, p.bellyU, t);
  const belly = (p.bellyRadius - baseToBelly) * gaussian(t, p.bellyU, p.width);
  let r = baseToBelly + belly;

  const shoulder = 1 - smoothstep(p.bellyU + 0.08, p.neckU, t);
  const neckMix = smoothstep(p.bellyU + 0.05, p.neckU, t);
  const bellyAtNeck = p.bellyRadius * (1 - neckMix) + p.neckRadius * neckMix;
  if (t > p.bellyU + 0.05) {
    r = r * (1 - neckMix) + bellyAtNeck * neckMix;
  }

  const toMouth = smoothstep(p.neckU, 0.96, t);
  r = r * (1 - toMouth) + p.mouthRadius * toMouth;
  r += p.flare * smoothstep(0.86, 1, t);
  r += (p.neckRadius - r) * 0.18 * gaussian(t, p.neckU, 0.055) * shoulder;
  return Math.max(0.012, r);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function findRecipe(id: string): Recipe {
  const recipe = RECIPES.find((r) => r.id === id);
  if (!recipe) throw new Error(`Unknown recipe: ${id}`);
  return recipe;
}

export function orderTarget(orderId?: string): Order | undefined {
  return ORDERS.find((o) => o.id === orderId);
}
