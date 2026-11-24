import '../style.css';
import { ORDERS, RECIPES, UPGRADES, findRecipe, targetRadius } from '../game/data';
import {
  annealTemperatureC,
  criticalCoolingRate,
  effectiveViscosity,
  scoreShape,
  vftLogEta,
  viscosity,
  wallThickness,
} from '../game/physics';
import { store } from '../game/store';
import type { Order, PageId, Workpiece } from '../game/types';
import { GlassRenderer } from '../render/GlassRenderer';
import {
  drawAnnealChart,
  drawTemperatureMap,
  drawRadialProfile,
  drawVftChart,
} from './charts';

function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing UI element: ${selector}`);
  return el;
}

function money(value: number): string {
  return `¥${Math.round(value).toLocaleString('zh-CN')}`;
}

function profileSVG(order: Order): string {
  const w = 300;
  const h = 150;
  const padX = 24;
  const centerY = h / 2 + 8;
  const plotW = w - padX * 2;
  const scale = 620;
  const topPoints: Array<[number, number]> = [];
  const bottomPoints: Array<[number, number]> = [];
  for (let i = 0; i <= 54; i += 1) {
    const u = i / 54;
    const x = padX + u * plotW;
    const r = targetRadius(order.profile, u) * scale;
    topPoints.push([x, centerY - r]);
    bottomPoints.push([x, centerY + r]);
  }
  const upper = topPoints.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${upper} ${bottomPoints.reverse().map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} Z`;
  const lower = bottomPoints.reverse().map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return `
    <svg class="order-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${order.title}轮廓">
      <defs>
        <linearGradient id="glassFill-${order.id}" x1="0" x2="1">
          <stop offset="0" stop-color="#67e8f9" stop-opacity="0.08"/>
          <stop offset="0.5" stop-color="#60a5fa" stop-opacity="0.2"/>
          <stop offset="1" stop-color="#a5f3fc" stop-opacity="0.08"/>
        </linearGradient>
      </defs>
      <line x1="${padX}" y1="${centerY}" x2="${w - padX}" y2="${centerY}" stroke="rgba(180,210,255,.18)" stroke-dasharray="4 5"/>
      <path d="${area}" fill="url(#glassFill-${order.id})" stroke="none"/>
      <path d="${upper}" fill="none" stroke="#8eeeff" stroke-width="2.4" stroke-linecap="round"/>
      <path d="${lower}" fill="none" stroke="#8eeeff" stroke-width="2.4" stroke-linecap="round"/>
      <text x="${padX}" y="20" fill="rgba(220,235,255,.55)" font-size="10">底</text>
      <text x="${w - padX - 24}" y="20" fill="rgba(220,235,255,.55)" font-size="10">口沿</text>
    </svg>`;
}

function shellHTML(): string {
  return `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">炽璃工坊<small>Thermal Glass Studio</small></div>
      <nav class="tabs" aria-label="主导航">
        <button class="tab active" data-page="bench">工作台</button>
        <button class="tab" data-page="temperature">温度分布</button>
        <button class="tab" data-page="orders">作品订单</button>
        <button class="tab" data-page="manage">工坊经营</button>
      </nav>
      <div class="top-stats">
        <span class="stat-pill cash" id="cashPill">现金 <b>¥0</b></span>
        <span class="stat-pill">声望 <b id="repPill">0</b></span>
        <span class="stat-pill fps-good" id="fpsPill">FPS <b>--</b></span>
      </div>
    </header>
    <main class="page-host">
      <section class="page active" id="page-bench">${benchHTML()}</section>
      <section class="page" id="page-temperature">${temperatureHTML()}</section>
      <section class="page" id="page-orders"><div class="orders-grid" id="ordersGrid"></div></section>
      <section class="page" id="page-manage"><div class="manage-grid" id="manageGrid"></div></section>
    </main>
    <div class="toast-host" id="toastHost"></div>
  </div>`;
}

function benchHTML(): string {
  return `
  <div class="workbench-grid">
    <section class="panel stage-card">
      <canvas id="glCanvas" aria-label="WebGL2 玻璃变形视图"></canvas>
      <div class="stage-hud">
        <span class="hud-badge" id="hudPhase"><b>台空</b></span>
        <span class="hud-badge hot" id="hudTemp">均温 --°C</span>
        <span class="hud-badge" id="hudRpm">转速 0 RPM</span>
        <span class="hud-badge" id="hudThickness">壁厚 -- mm</span>
      </div>
      <div class="stage-hint">拖动画面旋转视角 · 滚轮缩放。按住吹气/回炉/夹压，松开即停；空格吹气，H 回炉。</div>
      <div class="stage-overlay" id="stageOverlay"></div>
    </section>

    <aside class="control-panel">
      <section class="panel control-section">
        <div class="section-title">玻璃配方 <span class="tag">VFT 黏度</span></div>
        <div class="recipe-grid" id="recipeChoices"></div>
        <div id="activeOrderMini" style="margin-top:10px"></div>
        <button class="btn primary" id="gatherBtn" style="width:100%;margin-top:10px">从熔炉挑出一团料</button>
      </section>

      <section class="panel control-section">
        <div class="section-title">吹制与加热 <span class="tag">软处先鼓</span></div>
        <div class="btn-row">
          <button class="btn cyan hold" id="blowBtn">按住吹气</button>
          <button class="btn primary hold" id="heatBtn">按住回炉</button>
        </div>
        <label class="control-line">
          <span>气压</span>
          <input id="pressureRange" type="range" min="18" max="100" value="58" />
          <output id="pressureOut">58%</output>
        </label>
      </section>

      <section class="panel control-section">
        <div class="section-title">转吹管 <span class="tag">均化重力 · 离心张口</span></div>
        <label class="control-line">
          <span>目标转速</span>
          <input id="rpmRange" type="range" min="0" max="220" value="62" />
          <output id="rpmOut">62</output>
        </label>
        <div class="btn-row four">
          <button class="btn ghost rpm-preset" data-rpm="0">停</button>
          <button class="btn ghost rpm-preset" data-rpm="42">慢转</button>
          <button class="btn ghost rpm-preset" data-rpm="92">稳转</button>
          <button class="btn ghost rpm-preset" data-rpm="180">快转</button>
        </div>
      </section>

      <section class="panel control-section">
        <div class="section-title">夹、压、剪 <span class="tag" id="toolTempTag">工具点 --°C</span></div>
        <label class="control-line">
          <span>轴向位置</span>
          <input id="toolURange" type="range" min="20" max="94" value="68" />
          <output id="toolUOut">0.68</output>
        </label>
        <label class="control-line">
          <span>夹口宽度</span>
          <input id="widthRange" type="range" min="18" max="140" value="55" />
          <output id="widthOut">0.055</output>
        </label>
        <div class="btn-row three">
          <button class="btn hold" id="clampBtn">按住夹颈</button>
          <button class="btn hold" id="pressBtn">按住压肩</button>
          <button class="btn danger" id="cutBtn">剪口/修短</button>
        </div>
      </section>

      <section class="panel control-section">
        <div class="section-title">退火窑 <span class="tag">应力判定</span></div>
        <div class="btn-row" style="margin-bottom:8px">
          <button class="btn green" id="annealStandard">标准慢冷</button>
          <button class="btn ghost" id="annealFast">快速退火</button>
        </div>
        <div class="btn-row">
          <button class="btn danger" id="annealQuench">直接风冷</button>
          <button class="btn ghost" id="annealCustom">自定义速率</button>
        </div>
        <label class="control-line" style="margin-top:10px">
          <span>冷速</span>
          <input id="customRateRange" type="range" min="5" max="320" value="45" />
          <output id="customRateOut">0.45 K/s</output>
        </label>
        <div class="btn-row four" style="margin-top:8px">
          <button class="btn ghost warp-btn" data-warp="30">30×</button>
          <button class="btn ghost warp-btn" data-warp="120">120×</button>
          <button class="btn ghost warp-btn active" data-warp="300">300×</button>
          <button class="btn ghost warp-btn" data-warp="600">600×</button>
        </div>
        <div id="annealStatus" style="margin-top:10px"></div>
      </section>

      <section class="panel control-section">
        <div class="section-title">实时状态 <span class="tag">物理芯 42×5</span></div>
        <div class="telemetry" id="telemetryGrid"></div>
        <div class="warning-list" id="benchMessages"></div>
      </section>
    </aside>
  </div>`;
}

function temperatureHTML(): string {
  return `
  <div class="temp-grid">
    <section class="panel chart-card tall">
      <div class="panel-h">
        <div><h2>轴向 × 径向温度分布</h2><p>表面辐射散热、内层传导、薄壁更快失温；最上行是外表面。</p></div>
      </div>
      <div class="canvas-wrap"><canvas id="heatmapCanvas"></canvas></div>
    </section>
    <div class="manage-col">
      <section class="panel">
        <div class="panel-h"><h2>热状态</h2></div>
        <div class="panel-b"><div class="telemetry" id="tempStats"></div></div>
      </section>
      <section class="panel chart-card">
        <div class="panel-h"><h2>VFT 黏度曲线</h2><p>log₁₀ η = A + B / (T − T₀)，白点为当前有效温度。</p></div>
        <div class="canvas-wrap"><canvas id="vftCanvas"></canvas></div>
      </section>
    </div>
  </div>

  <div class="temp-grid" style="margin-top:16px">
    <section class="panel chart-card">
      <div class="panel-h"><h2>退火温度 / 应力历程</h2><p>冷速超过厚壁临界值时，径向温差产生的应力会越过破裂强度。</p></div>
      <div class="canvas-wrap"><canvas id="annealCanvas"></canvas></div>
    </section>
    <section class="panel chart-card">
      <div class="panel-h"><h2>工具截面径向层</h2><p>五层有限体积导热；冷硬外层最容易在夹压时开裂。</p></div>
      <div class="canvas-wrap"><canvas id="radialCanvas"></canvas></div>
    </section>
  </div>

  <section class="panel" style="margin-top:16px">
    <div class="panel-h"><h2>采用的传热与判定公式</h2></div>
    <div class="panel-b">
      <div class="formula">
VFT：log₁₀η(T) = A + B / ((T + 273.15) − T₀)<br>
径向导热：ρc·(w/N)·dTⱼ/dt = k/(w/N)·(Tⱼ₋₁ − 2Tⱼ + Tⱼ₊₁) − q_rad − q_conv<br>
表面辐射：q = εσ(T_s⁴ − T_env⁴) + h(T_s − T_env)；时间尺度 ∝ w²/α<br>
吹胀：ε̇ = [pR/(2w) + ρΩ²R²·rim] / (3η_eff)，故软处先鼓、薄处应力更高<br>
临界退火冷速：q_c ≈ 2α_th σ_fail(1−ν) / [E α_exp w²]
      </div>
      <p class="small-note" style="margin-top:10px">说明：为了让一件作品能在几分钟内完成，交互和退火窑使用了可切换的时间倍率；VFT、导热、薄壁应力和临界冷速之间的关系仍按上述公式实时计算。</p>
    </div>
  </section>`;
}

export function mountApp(root: HTMLElement): () => void {
  root.innerHTML = shellHTML();
  let renderer: GlassRenderer | null = null;
  try {
    renderer = new GlassRenderer(must<HTMLCanvasElement>('#glCanvas'));
  } catch (error) {
    console.error(error);
    const overlay = must<HTMLElement>('#stageOverlay');
    overlay.hidden = false;
    overlay.innerHTML = `<div class="overlay-card"><h2>无法启动 WebGL2</h2><p>${(error as Error).message}<br>请使用最新版 Chrome / Edge / Firefox，并确认硬件加速已开启。</p></div>`;
  }

  const cashPill = must('#cashPill b');
  const repPill = must('#repPill');
  const fpsPill = must('#fpsPill');
  const toastHost = must('#toastHost');
  const ordersGrid = must('#ordersGrid');
  const manageGrid = must('#manageGrid');
  const recipeChoices = must('#recipeChoices');
  const stageOverlay = must<HTMLElement>('#stageOverlay');

  function renderRecipes(): void {
    recipeChoices.innerHTML = RECIPES.map((r) => {
      const locked = Boolean(r.requiredUpgrade && !(store.upgrades[r.requiredUpgrade] > 0));
      const active = store.selectedRecipeId === r.id;
      return `
        <button class="recipe-choice ${active ? 'active' : ''}" data-recipe="${r.id}" ${locked ? 'disabled' : ''}>
          <b>${r.name}${locked ? ' 🔒' : ''}</b>
          <small>${locked ? '需高温熔窑' : r.subtitle}</small>
        </button>`;
    }).join('');
  }

  function activeOrder(): Order | undefined {
    return ORDERS.find((o) => o.id === store.activeOrderId);
  }

  function renderOrderMini(): void {
    const el = must('#activeOrderMini');
    const order = activeOrder();
    if (!order) {
      el.innerHTML = `<div class="chip">自由创作：没有订单轮廓限制</div>`;
      return;
    }
    const progress = store.orderProgress[order.id] ?? 0;
    el.innerHTML = `
      <div class="chip good">当前目标：${order.title} · ${progress}/${order.quantity}</div>
      <div class="small-note" style="margin-top:6px">最低评分 ${order.minScore}，容差 ${Math.round(order.tolerance * 100)}%。青色线为目标轮廓。</div>`;
  }

  function renderOrders(): void {
    ordersGrid.innerHTML = ORDERS.map((order) => {
      const accepted = store.acceptedOrderIds.includes(order.id);
      const completed = store.completedOrderIds.includes(order.id);
      const progress = store.orderProgress[order.id] ?? 0;
      const matchingWorks = store.works.filter((w) => w.orderId === order.id);
      const options = matchingWorks.length
        ? matchingWorks.map((w) => `<option value="${w.id}">#${w.id.slice(-5)} · ${w.score}分 · ${w.shapeScore}轮廓</option>`).join('')
        : `<option value="">暂无按此轮廓制作的成品</option>`;
      return `
      <article class="panel order-card ${store.activeOrderId === order.id ? 'active' : ''} ${completed ? 'complete' : ''}">
        <div class="order-head">
          <div><h3>${order.title}</h3><div class="client">${order.client} · ${order.deadline}</div></div>
          <div class="reward"><b>${money(order.reward)}</b><span>+${order.reputation} 声望</span></div>
        </div>
        ${profileSVG(order)}
        <p class="order-story">${order.story}</p>
        <div class="order-meta">
          <span class="chip">${order.kind === 'cup' ? '杯具' : order.kind === 'vase' ? '花瓶' : '浅钵'}</span>
          <span class="chip">${order.quantity} 件</span>
          <span class="chip">高 ${Math.round(order.profile.height * 1000)} mm</span>
          <span class="chip">腹径 ${Math.round(order.profile.bellyRadius * 2000)} mm</span>
          <span class="chip good">${order.minScore} 分验收</span>
          ${order.preferredRecipeId ? `<span class="chip">推荐 ${findRecipe(order.preferredRecipeId).name}</span>` : ''}
        </div>
        <div class="order-actions">
          ${completed ? `<button class="btn green" disabled>已完成交付</button>` : accepted ? `
            <div class="chip good">已接受 · 进度 ${progress}/${order.quantity}</div>
            <button class="btn cyan" data-action="set-active-order" data-id="${order.id}">设为工作台目标</button>
            <div class="deliver-row">
              <select data-order-select="${order.id}" ${matchingWorks.length ? '' : 'disabled'}>${options}</select>
              <button class="btn green" data-action="deliver" data-id="${order.id}" ${matchingWorks.length ? '' : 'disabled'}>交付</button>
            </div>
          ` : `<button class="btn primary" data-action="accept-order" data-id="${order.id}">接受订单</button>`}
        </div>
      </article>`;
    }).join('');
  }

  function renderManage(): void {
    const workRows = store.works.length
      ? store.works.map((w) => `
        <div class="work-row">
          <div>
            <b>${w.name}</b>
            <small>${w.date} · 综合 ${w.score}（轮廓 ${w.shapeScore}/退火 ${w.annealScore}）· 峰值应力 ${w.maxStressMPa.toFixed(1)} MPa</small>
          </div>
          <div class="work-actions">
            <button class="btn ghost" data-action="sell-work" data-id="${w.id}">代售</button>
          </div>
        </div>`).join('')
      : `<p class="small-note">作品库还是空的。完成退火后可入库，再从订单页交付或在这里代售。</p>`;

    manageGrid.innerHTML = `
      <div class="manage-col">
        <section class="panel kpi-grid">
          <div class="panel kpi"><span>现金</span><b>${money(store.cash)}</b></div>
          <div class="panel kpi"><span>声望</span><b>${store.reputation}</b></div>
          <div class="panel kpi"><span>完成订单</span><b>${store.completedOrders}</b></div>
          <div class="panel kpi"><span>失败作品</span><b>${store.failedPieces}</b></div>
        </section>
        <section class="panel">
          <div class="panel-h"><h2>经营提示</h2></div>
          <div class="panel-b">
            <p class="small-note" style="font-size:13px;color:var(--muted)">高评分和低残余应力会带来回头订单。冷裂、退火炸裂会计入失败作品，但不会扣现金；材料成本在挑料时支付。</p>
            <button class="btn danger" data-action="reset" style="width:100%;margin-top:10px">重置工坊存档</button>
          </div>
        </section>
        <section class="panel">
          <div class="panel-h"><h2>成品库 / 展窗</h2></div>
          <div class="panel-b">${workRows}</div>
        </section>
      </div>
      <div class="manage-col">
        <section class="panel">
          <div class="panel-h"><h2>设备升级</h2><p>升级保存在此浏览器。</p></div>
          <div class="panel-b">
            ${UPGRADES.map((u) => {
              const level = store.upgrades[u.id] ?? 0;
              const maxed = level >= u.maxLevel;
              const cost = maxed ? 0 : u.costs[level];
              return `
              <div class="upgrade">
                <div>
                  <h4>${u.name} <span class="small-note">Lv.${level}/${u.maxLevel}</span></h4>
                  <p>${u.description}</p>
                  <div class="level-dots">${Array.from({ length: u.maxLevel }, (_, i) => `<i class="dot ${i < level ? 'on' : ''}"></i>`).join('')}</div>
                </div>
                <button class="btn ${maxed ? 'ghost' : 'primary'}" data-action="buy-upgrade" data-id="${u.id}" ${maxed || store.cash < cost ? 'disabled' : ''}>
                  ${maxed ? '已满级' : money(cost)}
                </button>
              </div>`;
            }).join('')}
          </div>
        </section>
        <section class="panel">
          <div class="panel-h"><h2>配方物性</h2></div>
          <div class="panel-b" style="overflow-x:auto">
            <table class="data-table">
              <thead><tr><th>配方</th><th class="num">A</th><th class="num">B(K)</th><th class="num">T₀(K)</th><th class="num">退火点</th><th class="num">膨胀 /K</th></tr></thead>
              <tbody>
                ${RECIPES.map((r) => `<tr>
                  <td>${r.name}</td><td class="num">${r.vft.A}</td><td class="num">${r.vft.B}</td><td class="num">${r.vft.T0}</td>
                  <td class="num">${Math.round(annealTemperatureC(r))}°C</td><td class="num">${r.expansion.toExponential(1)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </section>
      </div>`;
  }

  function renderToasts(): void {
    toastHost.innerHTML = store.toasts.map((t) => `<div class="toast ${t.kind}">${t.text}</div>`).join('');
  }

  function renderAll(): void {
    cashPill.textContent = money(store.cash);
    repPill.textContent = String(store.reputation);
    renderRecipes();
    renderOrderMini();
    renderOrders();
    renderManage();
    renderToasts();
  }

  store.addEventListener('change', renderAll);
  renderAll();

  // Tabs
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const page = tab.dataset.page as PageId;
      store.setPage(page);
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
      requestAnimationFrame(() => renderer?.resize());
    });
  });

  // Static controls
  must('#gatherBtn').addEventListener('click', () => store.gather());
  must('#cutBtn').addEventListener('click', () => store.cut());
  must('#annealStandard').addEventListener('click', () => store.startAnneal('standard'));
  must('#annealFast').addEventListener('click', () => store.startAnneal('fast'));
  must('#annealQuench').addEventListener('click', () => store.startAnneal('quench'));
  must('#annealCustom').addEventListener('click', () => {
    const rate = Number(must<HTMLInputElement>('#customRateRange').value) / 100;
    store.startAnneal('custom', rate);
  });

  recipeChoices.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-recipe]');
    if (btn?.dataset.recipe) store.selectRecipe(btn.dataset.recipe);
  });

  function bindHold(buttonId: string, control: 'blowing' | 'heating' | 'clamping' | 'pressing', key?: string): void {
    const btn = must<HTMLButtonElement>(buttonId);
    const set = (value: boolean) => {
      store.patchControls({ [control]: value } as Partial<typeof store.controls>);
      btn.classList.toggle('active', value);
    };
    btn.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      btn.setPointerCapture(event.pointerId);
      set(true);
    });
    btn.addEventListener('pointerup', () => set(false));
    btn.addEventListener('pointercancel', () => set(false));
    btn.addEventListener('lostpointercapture', () => set(false));
    if (key) {
      window.addEventListener('keydown', (event) => {
        if (event.code !== key || event.repeat) return;
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
        event.preventDefault();
        set(true);
      });
      window.addEventListener('keyup', (event) => {
        if (event.code === key) set(false);
      });
    }
  }
  bindHold('#blowBtn', 'blowing', 'Space');
  bindHold('#heatBtn', 'heating', 'KeyH');
  bindHold('#clampBtn', 'clamping', 'KeyJ');
  bindHold('#pressBtn', 'pressing', 'KeyF');

  window.addEventListener('blur', () => {
    store.patchControls({ blowing: false, heating: false, clamping: false, pressing: false });
    document.querySelectorAll('.hold.active').forEach((el) => el.classList.remove('active'));
  });

  const pressureRange = must<HTMLInputElement>('#pressureRange');
  pressureRange.addEventListener('input', () => {
    const value = Number(pressureRange.value);
    must('#pressureOut').textContent = `${value}%`;
    store.patchControls({ pressure: value / 100 });
  });

  const rpmRange = must<HTMLInputElement>('#rpmRange');
  rpmRange.addEventListener('input', () => {
    must('#rpmOut').textContent = rpmRange.value;
    store.patchControls({ targetRpm: Number(rpmRange.value) });
  });
  document.querySelectorAll<HTMLButtonElement>('.rpm-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rpm = Number(btn.dataset.rpm);
      rpmRange.value = String(rpm);
      must('#rpmOut').textContent = String(rpm);
      store.patchControls({ targetRpm: rpm });
    });
  });

  const toolURange = must<HTMLInputElement>('#toolURange');
  toolURange.addEventListener('input', () => {
    const value = Number(toolURange.value) / 100;
    must('#toolUOut').textContent = value.toFixed(2);
    store.patchControls({ toolU: value });
  });
  const widthRange = must<HTMLInputElement>('#widthRange');
  widthRange.addEventListener('input', () => {
    const value = Number(widthRange.value) / 1000;
    must('#widthOut').textContent = value.toFixed(3);
    store.patchControls({ toolWidth: value });
  });
  const customRateRange = must<HTMLInputElement>('#customRateRange');
  customRateRange.addEventListener('input', () => {
    must('#customRateOut').textContent = `${(Number(customRateRange.value) / 100).toFixed(2)} K/s`;
  });

  document.querySelectorAll<HTMLButtonElement>('.warp-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.warp-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      store.setAnnealWarp(Number(btn.dataset.warp));
    });
  });

  root.addEventListener('click', (event) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id ?? '';
    if (action === 'accept-order') store.acceptOrder(id);
    if (action === 'set-active-order') store.setActiveOrder(id);
    if (action === 'buy-upgrade') store.buyUpgrade(id);
    if (action === 'sell-work') store.sellWork(id);
    if (action === 'reset' && window.confirm('确定清空现金、升级、订单和成品存档吗？')) store.resetGame();
    if (action === 'collect') store.collectFinished();
    if (action === 'discard') store.discardFailed();
    if (action === 'deliver') {
      const select = document.querySelector<HTMLSelectElement>(`[data-order-select="${id}"]`);
      if (select?.value) store.deliverWork(select.value, id);
    }
  });

  function overlayHTML(wp: Workpiece | null): string {
    if (!wp) {
      return `<div class="overlay-card">
        <h2>从一团 1000°C 以上的玻璃料开始</h2>
        <p>出炉后表面会以辐射和对流快速散热，薄壁冷得更快。温度决定 VFT 黏度，黏度决定哪里先鼓、哪里下垂、哪里会被夹裂。</p>
        <button class="btn primary" data-action="gather-overlay" style="width:100%;margin-top:8px">去挑料</button>
      </div>`;
    }
    if (wp.phase === 'failed') {
      return `<div class="overlay-card">
        <h2 style="color:var(--red)">工件报废</h2>
        <p>${wp.failReason ?? '玻璃裂成了无法修复的碎片。'}</p>
        <button class="btn danger" data-action="discard" style="width:100%">清理台面</button>
      </div>`;
    }
    if (wp.phase === 'finished') {
      const shape = scoreShape(wp, activeOrder());
      return `<div class="overlay-card">
        <h2 style="color:var(--green)">退火完成</h2>
        <p>${wp.anneal?.verdict ?? ''}</p>
        <p>当前轮廓评分 <b>${shape.total.toFixed(0)}</b>，直线度 ${shape.straight.toFixed(0)}，壁厚均匀度 ${shape.thickness.toFixed(0)}。</p>
        <button class="btn green" data-action="collect" style="width:100%">收入作品库</button>
      </div>`;
    }
    return '';
  }

  root.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest('[data-action="gather-overlay"]');
    if (btn) store.gather();
  });

  function metric(label: string, value: string, tone = ''): string {
    return `<div class="metric"><span>${label}</span><b class="${tone}">${value}</b></div>`;
  }

  function updateBenchUI(): void {
    const wp = store.workpiece;
    const order = activeOrder();
    const recipe = findRecipe(store.selectedRecipeId);

    cashPill.textContent = money(store.cash);
    repPill.textContent = String(store.reputation);

    must('#hudPhase').innerHTML = wp
      ? `<b>${{ working: '塑形中', annealing: '退火中', finished: '已完成', failed: '已报废', idle: '台空' }[wp.phase]}</b>`
      : '<b>台空</b>';

    if (!wp) {
      must('#hudTemp').innerHTML = '均温 --°C';
      must('#hudRpm').textContent = '转速 0 RPM';
      must('#hudThickness').textContent = '壁厚 -- mm';
      must('#telemetryGrid').innerHTML = [
        metric('VFT 公式', 'A+B/(T-T₀)'),
        metric('当前配方', recipe.name),
        metric('临界冷速', '挑料后计算'),
        metric('目标订单', order?.title ?? '自由创作'),
      ].join('');
      must('#benchMessages').innerHTML = `<div class="warning ok">提示：先接受订单，再挑料；青色参考线会显示目标轮廓。</div>`;
      must('#annealStatus').innerHTML = '';
      must('#toolTempTag').textContent = '工具点 --°C';
      stageOverlay.hidden = false;
      stageOverlay.innerHTML = overlayHTML(null);
      return;
    }

    if (wp.phase === 'failed' || wp.phase === 'finished') {
      stageOverlay.hidden = false;
      stageOverlay.innerHTML = overlayHTML(wp);
    } else {
      stageOverlay.hidden = true;
      stageOverlay.innerHTML = '';
    }

    let tempSum = 0;
    let outerSum = 0;
    let minT = Infinity;
    let maxT = -Infinity;
    let maxW = 0;
    for (let i = 0; i < wp.activeCells; i += 1) {
      for (let j = 0; j < wp.radialLayers; j += 1) {
        const t = wp.T[i * wp.radialLayers + j];
        tempSum += t;
        minT = Math.min(minT, t);
        maxT = Math.max(maxT, t);
      }
      outerSum += wp.T[i * wp.radialLayers + wp.radialLayers - 1];
      maxW = Math.max(maxW, wallThickness(wp, i));
    }
    const count = wp.activeCells * wp.radialLayers;
    const avgT = tempSum / count;
    const avgOuter = outerSum / wp.activeCells;
    const toolIndex = Math.max(0, Math.min(wp.activeCells - 1, Math.round(store.controls.toolU * (wp.activeCells - 1))));
    const toolOuter = wp.T[toolIndex * wp.radialLayers + wp.radialLayers - 1];
    const toolEta = effectiveViscosity(wp, recipe, toolIndex);
    const qCrit = criticalCoolingRate(recipe, maxW);
    const shape = scoreShape(wp, order);

    must('#hudTemp').innerHTML = `均温 <b>${Math.round(avgT)}°C</b>`;
    must('#hudRpm').textContent = `转速 ${Math.round(wp.rpm)} RPM`;
    must('#hudThickness').textContent = `最大壁厚 ${(maxW * 1000).toFixed(1)} mm`;
    must('#toolTempTag').textContent = `工具点 ${Math.round(toolOuter)}°C`;

    const tempTone = avgT > recipe.toolSafeC + 120 ? 'hot' : avgT < recipe.toolSafeC ? 'cold' : '';
    must('#telemetryGrid').innerHTML = [
      metric('温度范围', `${Math.round(minT)}–${Math.round(maxT)}°C`, tempTone),
      metric('平均外表面', `${Math.round(avgOuter)}°C`, avgOuter < recipe.toolSafeC ? 'cold' : 'hot'),
      metric('工具点 logη', vftLogEta(recipe, wp.T[toolIndex * wp.radialLayers + 2]).toFixed(2), toolOuter < recipe.toolSafeC ? 'bad' : ''),
      metric('有效黏度', formatEta(toolEta)),
      metric('临界退火冷速', `${qCrit.toFixed(2)} K/s`),
      metric('实时轮廓分', shape.total.toFixed(0), shape.total >= (order?.minScore ?? 70) ? 'good' : 'bad'),
      metric('直线度 / 下垂', `${shape.straight.toFixed(0)} · ${(shape.maxDroopM * 100).toFixed(1)}cm`, shape.straight < 65 ? 'bad' : 'good'),
      metric('壁厚均值', `${shape.meanThicknessMm.toFixed(1)} mm`),
    ].join('');

    const messages: string[] = [];
    if (avgOuter < recipe.toolSafeC) messages.push(`外表面低于安全工具温度 ${recipe.toolSafeC}°C：夹压会累积裂纹，先回炉。`);
    if (wp.rpm < 18 && avgT > recipe.gatherC - 260) messages.push('转速过低：热料会在重力下持续弯垂，开慢转或稳转均化。');
    if (wp.rpm > 145) messages.push('高速旋转：离心力正在拉张口沿，注意目标半径。');
    if (shape.meanThicknessMm < 1.1) messages.push('壁厚已很薄：继续猛吹可能吹破。');
    if (wp.cracks.length) messages.push(`已记录 ${wp.cracks.length} 处裂纹/微裂；退火破裂强度会下降。`);
    if (order && shape.total < order.minScore - 8) messages.push(`轮廓分离目标 ${order.minScore - shape.total | 0} 分，可用夹、压和局部回炉修正。`);
    if (!messages.length) messages.push('状态可控：软处会先鼓，保持转动并短促吹气。');
    must('#benchMessages').innerHTML = messages.map((text, i) => `<div class="warning ${text.includes('裂') || text.includes('过低') || text.includes('薄') ? (i === 0 && wp.cracks.length ? 'error' : '') : 'ok'}">${text}</div>`).join('');

    const anneal = wp.anneal;
    const annealEl = must('#annealStatus');
    if (anneal) {
      const progress = anneal.status === 'holding'
        ? Math.min(100, (anneal.elapsed / Math.max(1, anneal.holdDuration)) * 45)
        : Math.min(100, 45 + ((anneal.maxStressMPa > 0 ? 1 : 0) + anneal.coolingElapsed / 260) * 40);
      annealEl.innerHTML = `
        <div class="small-note" style="margin-bottom:7px">${anneal.verdict}</div>
        <div class="progress hot"><i style="width:${anneal.status === 'holding' ? Math.min(45, anneal.elapsed / Math.max(1, anneal.holdDuration) * 45) : '72%'}"></i></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px">
          <span class="chip">状态：${{ ready: '准备', holding: '均热', cooling: '冷却', done: '完成', shattered: '炸裂' }[anneal.status]}</span>
          <span class="chip">应力 ${anneal.maxStressMPa.toFixed(1)} MPa</span>
          <span class="chip">实测冷速 ${anneal.maxMeasuredRate.toFixed(2)} K/s</span>
          <span class="chip">临界 ${anneal.qCritMin.toFixed(2)} K/s</span>
        </div>
        <div class="progress stress" style="margin-top:8px"><i style="width:${Math.min(100, anneal.maxStressMPa / (findRecipe(wp.recipeId).strength / 1e6) * 100)}%"></i></div>`;
      void progress;
    } else {
      annealEl.innerHTML = `<div class="small-note">轮廓满意后选择退火程序。标准程序会先在 VFT η≈10¹³ Pa·s 的退火点保温松弛应力。</div>`;
    }

    const phaseWorking = wp.phase === 'working';
    (['#blowBtn', '#heatBtn', '#clampBtn', '#pressBtn', '#cutBtn', '#annealStandard', '#annealFast', '#annealQuench', '#annealCustom'] as const)
      .forEach((selector) => { must<HTMLButtonElement>(selector).disabled = !phaseWorking; });
  }

  function formatEta(eta: number): string {
    if (eta >= 1e6) return `${(eta / 1e6).toFixed(1)}M Pa·s`;
    if (eta >= 1e3) return `${(eta / 1e3).toFixed(1)}k Pa·s`;
    return `${eta.toFixed(0)} Pa·s`;
  }

  let lastTime = performance.now();
  let fps = 60;
  let uiAccumulator = 0;
  let chartAccumulator = 0;
  let rafId = 0;
  let destroyed = false;

  function frame(now: number): void {
    if (destroyed) return;
    const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    const instantFps = 1 / Math.max(dt, 0.0001);
    fps += (instantFps - fps) * 0.08;

    store.tick(dt);
    const wp = store.workpiece;
    if (store.page === 'bench' && renderer) {
      renderer.render(wp, activeOrder(), store.controls.toolU);
    }

    uiAccumulator += dt;
    if (uiAccumulator > 0.1) {
      uiAccumulator = 0;
      updateBenchUI();
      fpsPill.innerHTML = `FPS <b>${Math.round(fps)}</b>`;
      fpsPill.className = `stat-pill ${fps >= 55 ? 'fps-good' : 'fps-bad'}`;
    }

    chartAccumulator += dt;
    if (store.page === 'temperature' && chartAccumulator > 0.18) {
      chartAccumulator = 0;
      drawTemperatureMap(must<HTMLCanvasElement>('#heatmapCanvas'), wp);
      drawVftChart(must<HTMLCanvasElement>('#vftCanvas'), findRecipe(store.selectedRecipeId), averageCoreTemp(wp));
      drawRadialProfile(must<HTMLCanvasElement>('#radialCanvas'), wp);
      drawAnnealChart(must<HTMLCanvasElement>('#annealCanvas'), wp);
      updateTempStats(wp);
    }

    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
  updateBenchUI();

  function updateTempStats(wp: Workpiece | null): void {
    const el = must('#tempStats');
    if (!wp) {
      el.innerHTML = [
        metric('导热方程', '5 层有限体积'),
        metric('厚度关系', 'q_c ∝ 1/w²'),
        metric('表面散热', '辐射 + 对流'),
        metric('等待挑料', '—'),
      ].join('');
      return;
    }
    const recipe = findRecipe(wp.recipeId);
    let core = 0;
    let surface = 0;
    let maxW = 0;
    for (let i = 0; i < wp.activeCells; i += 1) {
      core += wp.T[i * wp.radialLayers + 2];
      surface += wp.T[i * wp.radialLayers + wp.radialLayers - 1];
      maxW = Math.max(maxW, wallThickness(wp, i));
    }
    core /= wp.activeCells;
    surface /= wp.activeCells;
    el.innerHTML = [
      metric('平均芯温', `${core.toFixed(0)}°C`, 'hot'),
      metric('平均表温', `${surface.toFixed(0)}°C`, surface < recipe.toolSafeC ? 'cold' : ''),
      metric('表芯温差', `${(core - surface).toFixed(0)} K`, core - surface > 130 ? 'bad' : 'good'),
      metric('最大壁厚', `${(maxW * 1000).toFixed(1)} mm`),
      metric('热扩散率', `${(recipe.conductivity / (recipe.density * recipe.heatCapacity) * 1e7).toFixed(2)}×10⁻⁷`),
      metric('临界冷速', `${criticalCoolingRate(recipe, maxW).toFixed(2)} K/s`),
      metric('退火点', `${annealTemperatureC(recipe).toFixed(0)}°C`),
      metric('当前黏度', formatEta(viscosity(recipe, core))),
    ].join('');
  }

  function averageCoreTemp(wp: Workpiece | null): number | undefined {
    if (!wp) return undefined;
    let sum = 0;
    for (let i = 0; i < wp.activeCells; i += 1) sum += wp.T[i * wp.radialLayers + 2];
    return sum / wp.activeCells;
  }

  // Redraw charts after first layout and on viewport changes.
  const resizeObserver = new ResizeObserver(() => {
    renderer?.resize();
    const wp = store.workpiece;
    if (store.page === 'temperature') {
      drawTemperatureMap(must<HTMLCanvasElement>('#heatmapCanvas'), wp);
      drawVftChart(must<HTMLCanvasElement>('#vftCanvas'), findRecipe(store.selectedRecipeId), averageCoreTemp(wp));
      drawRadialProfile(must<HTMLCanvasElement>('#radialCanvas'), wp);
      drawAnnealChart(must<HTMLCanvasElement>('#annealCanvas'), wp);
    }
  });
  resizeObserver.observe(root);

  return () => {
    destroyed = true;
    cancelAnimationFrame(rafId);
    resizeObserver.disconnect();
  };
}
