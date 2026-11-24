import { ORDERS, UPGRADES, findRecipe } from './data';
import {
  annealQuality,
  beginAnneal,
  createWorkpiece,
  cutWorkpiece,
  stepAnneal,
  stepWorking,
  type UpgradeLevels,
} from './physics';
import type {
  AnnealMode,
  BenchControls,
  FinishedWork,
  PageId,
  Toast,
  Workpiece,
} from './types';

const SAVE_KEY = 'glass-workshop-save-v1';

export interface PersistedState {
  cash: number;
  reputation: number;
  completedOrders: number;
  failedPieces: number;
  upgrades: UpgradeLevels;
  acceptedOrderIds: string[];
  activeOrderId?: string;
  orderProgress: Record<string, number>;
  works: FinishedWork[];
  selectedRecipeId: string;
}

class GameStore extends EventTarget {
  page: PageId = 'bench';
  cash = 680;
  reputation = 0;
  completedOrders = 0;
  failedPieces = 0;
  upgrades: UpgradeLevels = {};
  acceptedOrderIds: string[] = ['order-tea-cups'];
  activeOrderId: string | undefined = 'order-tea-cups';
  orderProgress: Record<string, number> = {};
  completedOrderIds: string[] = [];
  works: FinishedWork[] = [];
  selectedRecipeId = 'soda-lime';
  workpiece: Workpiece | null = null;
  controls: BenchControls = {
    blowing: false,
    heating: false,
    clamping: false,
    pressing: false,
    pressure: 0.58,
    toolU: 0.68,
    toolWidth: 0.055,
    targetRpm: 62,
  };
  toasts: Toast[] = [];
  private toastSerial = 1;
  private failedCountedId: number | null = null;

  constructor() {
    super();
    this.load();
  }

  emit(): void {
    this.dispatchEvent(new CustomEvent('change'));
    this.save();
  }

  setPage(page: PageId): void {
    this.page = page;
    this.emit();
  }

  patchControls(patch: Partial<BenchControls>): void {
    Object.assign(this.controls, patch);
    this.dispatchEvent(new CustomEvent('controls'));
  }

  toast(text: string, kind: Toast['kind'] = 'info'): void {
    const toast: Toast = { id: this.toastSerial++, text, kind };
    this.toasts.push(toast);
    if (this.toasts.length > 4) this.toasts.shift();
    this.emit();
    window.setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== toast.id);
      this.emit();
    }, 3600);
  }

  gather(): void {
    if (this.workpiece?.phase === 'working' || this.workpiece?.phase === 'annealing') {
      this.toast('台面上还有一件正在制作的玻璃。', 'warning');
      return;
    }
    if (this.workpiece?.phase === 'finished') {
      this.toast('请先把完成的作品收入作品库，再挑新料。', 'warning');
      return;
    }
    const recipe = findRecipe(this.selectedRecipeId);
    if (recipe.requiredUpgrade && !(this.upgrades[recipe.requiredUpgrade] > 0)) {
      this.toast(`${recipe.name}需要先购买对应窑炉升级。`, 'error');
      return;
    }
    const materialCost = Math.round(recipe.costPerKg * 0.9);
    if (this.cash < materialCost) {
      this.toast(`买料需要 ¥${materialCost}，现金不足。`, 'error');
      return;
    }
    this.cash -= materialCost;
    this.workpiece = createWorkpiece(this.selectedRecipeId, this.activeOrderId, this.upgrades);
    this.failedCountedId = null;
    this.controls.blowing = false;
    this.controls.heating = false;
    this.controls.clamping = false;
    this.controls.pressing = false;
    this.toast(`从炉中挑出一团${recipe.name}，材料成本 ¥${materialCost}。`, 'success');
    this.emit();
  }

  tick(dt: number): void {
    const wp = this.workpiece;
    if (!wp) return;

    if (wp.phase === 'working') {
      stepWorking(wp, dt, this.controls, this.upgrades);
      const phase = wp.phase as string;
      if (phase === 'failed' && this.failedCountedId !== wp.id) {
        this.failedCountedId = wp.id;
        this.failedPieces += 1;
        this.controls.blowing = false;
        this.controls.heating = false;
        this.controls.clamping = false;
        this.controls.pressing = false;
        this.toast(wp.failReason ?? '工件裂了。', 'error');
        this.emit();
      }
    } else if (wp.phase === 'annealing') {
      stepAnneal(wp, dt, this.upgrades);
      const phase = wp.phase as string;
      if (phase === 'failed' && this.failedCountedId !== wp.id) {
        this.failedCountedId = wp.id;
        this.failedPieces += 1;
        this.toast(wp.failReason ?? '退火时炸裂。', 'error');
        this.emit();
      } else if (phase === 'finished') {
        this.controls.blowing = false;
        this.controls.heating = false;
        this.emit();
      }
    }
  }

  cut(): void {
    if (!this.workpiece || this.workpiece.phase !== 'working') return;
    const result = cutWorkpiece(this.workpiece, this.controls.toolU);
    this.toast(result.message, result.ok ? 'info' : 'error');
    this.emit();
  }

  startAnneal(mode: AnnealMode, customRate?: number): void {
    const wp = this.workpiece;
    if (!wp || wp.phase !== 'working') return;
    beginAnneal(wp, mode, this.upgrades, customRate);
    this.controls.blowing = false;
    this.controls.heating = false;
    this.controls.clamping = false;
    this.controls.pressing = false;
    this.toast('工件已送入退火窑。可在温度分布页观察应力曲线。', 'info');
    this.emit();
  }

  setAnnealWarp(warp: number): void {
    if (this.workpiece?.anneal) {
      this.workpiece.anneal.timeWarp = warp;
      this.dispatchEvent(new CustomEvent('controls'));
    }
  }

  collectFinished(): FinishedWork | null {
    const wp = this.workpiece;
    if (!wp || wp.phase !== 'finished' || !wp.anneal) return null;
    const shape = wp.shapeScore ?? 0;
    const anneal = annealQuality(wp);
    const score = Math.round(shape * 0.62 + anneal * 0.38);
    const recipe = findRecipe(wp.recipeId);
    const work: FinishedWork = {
      id: `work-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: `${recipe.name}作品 #${wp.id}`,
      recipeId: wp.recipeId,
      orderId: wp.orderId,
      score,
      shapeScore: Math.round(shape),
      annealScore: Math.round(anneal),
      maxStressMPa: wp.anneal.maxStressMPa,
      date: new Date().toLocaleDateString('zh-CN'),
      profileSummary: `轮廓 ${Math.round((wp.shapeScore ?? 0))} 分 · 退火 ${Math.round(anneal)} 分`,
    };
    this.works.unshift(work);
    this.workpiece = null;
    this.toast(`作品已入库，综合评分 ${score}。`, 'success');
    this.emit();
    return work;
  }

  discardFailed(): void {
    if (!this.workpiece || this.workpiece.phase !== 'failed') return;
    this.workpiece = null;
    this.emit();
  }

  acceptOrder(orderId: string): void {
    if (!this.acceptedOrderIds.includes(orderId)) this.acceptedOrderIds.push(orderId);
    this.activeOrderId = orderId;
    this.toast('订单已设为工作台目标，轮廓参考线已开启。', 'success');
    this.emit();
  }

  setActiveOrder(orderId: string): void {
    this.activeOrderId = orderId;
    if (!this.acceptedOrderIds.includes(orderId)) this.acceptedOrderIds.push(orderId);
    this.emit();
  }

  deliverWork(workId: string, orderId: string): void {
    const work = this.works.find((w) => w.id === workId);
    const order = ORDERS.find((o) => o.id === orderId);
    if (!work || !order) return;
    if (work.orderId !== orderId) {
      this.toast('这件作品不是按该订单轮廓制作的，请在工作台选择对应订单后重做。', 'warning');
      return;
    }
    if (work.score < order.minScore) {
      this.toast(`综合评分 ${work.score}，未达到订单要求 ${order.minScore}。`, 'error');
      return;
    }

    const current = this.orderProgress[orderId] ?? 0;
    if (current >= order.quantity) return;
    const showroom = this.upgrades['showroom'] ?? 0;
    const multiplier = 1 + showroom * 0.12;
    const unitPay = Math.round((order.reward / order.quantity) * multiplier);
    const nextProgress = current + 1;
    this.orderProgress[orderId] = nextProgress;

    if (nextProgress >= order.quantity) {
      const totalPay = Math.round(order.reward * multiplier);
      const alreadyPaid = unitPay * (order.quantity - 1);
      this.cash += Math.max(unitPay, totalPay - alreadyPaid);
      this.reputation += order.reputation;
      this.completedOrders += 1;
      if (!this.completedOrderIds.includes(orderId)) this.completedOrderIds.push(orderId);
      if (this.activeOrderId === orderId) this.activeOrderId = this.acceptedOrderIds.find((id) => id !== orderId);
      this.toast(`订单「${order.title}」完成！尾款与声望已结算。`, 'success');
    } else {
      this.cash += unitPay;
      this.toast(`已交付 ${nextProgress}/${order.quantity} 件，收到 ¥${unitPay}。`, 'success');
    }
    this.works = this.works.filter((w) => w.id !== workId);
    this.emit();
  }

  sellWork(workId: string): void {
    const work = this.works.find((w) => w.id === workId);
    if (!work) return;
    const showroom = this.upgrades['showroom'] ?? 0;
    const value = Math.round((35 + work.score * 7.5) * (1 + showroom * 0.12));
    this.cash += value;
    this.works = this.works.filter((w) => w.id !== workId);
    this.toast(`展窗代售成功，收入 ¥${value}。`, 'success');
    this.emit();
  }

  buyUpgrade(id: string): void {
    const def = UPGRADES.find((u) => u.id === id);
    if (!def) return;
    const level = this.upgrades[id] ?? 0;
    if (level >= def.maxLevel) return;
    const cost = def.costs[level];
    if (this.cash < cost) {
      this.toast('现金不足，先交付几个订单吧。', 'error');
      return;
    }
    this.cash -= cost;
    this.upgrades[id] = level + 1;
    this.toast(`升级完成：${def.name} Lv.${level + 1}`, 'success');
    this.emit();
  }

  selectRecipe(id: string): void {
    this.selectedRecipeId = id;
    this.emit();
  }

  resetGame(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // Storage may be unavailable; in-memory reset still works.
    }
    this.cash = 680;
    this.reputation = 0;
    this.completedOrders = 0;
    this.failedPieces = 0;
    this.upgrades = {};
    this.acceptedOrderIds = ['order-tea-cups'];
    this.activeOrderId = 'order-tea-cups';
    this.orderProgress = {};
    this.completedOrderIds = [];
    this.works = [];
    this.selectedRecipeId = 'soda-lime';
    this.workpiece = null;
    this.failedCountedId = null;
    this.emit();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Partial<PersistedState>;
      if (typeof data.cash === 'number') this.cash = data.cash;
      if (typeof data.reputation === 'number') this.reputation = data.reputation;
      if (typeof data.completedOrders === 'number') this.completedOrders = data.completedOrders;
      if (typeof data.failedPieces === 'number') this.failedPieces = data.failedPieces;
      if (data.upgrades) this.upgrades = data.upgrades;
      if (Array.isArray(data.acceptedOrderIds) && data.acceptedOrderIds.length) {
        this.acceptedOrderIds = data.acceptedOrderIds;
      }
      if (data.activeOrderId) this.activeOrderId = data.activeOrderId;
      if (data.orderProgress) this.orderProgress = data.orderProgress;
      if (Array.isArray(data.works)) this.works = data.works;
      if (data.selectedRecipeId) this.selectedRecipeId = data.selectedRecipeId;
    } catch {
      // Ignore corrupted save and start a fresh workshop.
    }
  }

  private save(): void {
    const data: PersistedState = {
      cash: this.cash,
      reputation: this.reputation,
      completedOrders: this.completedOrders,
      failedPieces: this.failedPieces,
      upgrades: this.upgrades,
      acceptedOrderIds: this.acceptedOrderIds,
      activeOrderId: this.activeOrderId,
      orderProgress: this.orderProgress,
      works: this.works,
      selectedRecipeId: this.selectedRecipeId,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      // Private mode or quota errors do not affect gameplay.
    }
  }
}

export const store = new GameStore();
export const ALL_ORDERS = ORDERS;
