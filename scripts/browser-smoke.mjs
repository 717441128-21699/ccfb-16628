const base = process.env.CDP_URL ?? 'http://127.0.0.1:9222';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getTargets() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${base}/json/list`);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint did not become ready');
}

const targets = await getTargets();
const target = targets.find((t) => t.type === 'page' && t.url.includes('127.0.0.1:4173')) ?? targets.find((t) => t.type === 'page');
if (!target?.webSocketDebuggerUrl) throw new Error('No page target');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    errors.push(message.params.args.map((a) => a.description ?? a.value).join(' '));
  }
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send('Runtime.enable');
await send('Log.enable');
await sleep(1800);

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

const initial = await evaluate(`(() => {
  const canvas = document.querySelector('#glCanvas');
  const gl = canvas ? canvas.getContext('webgl2') : null;
  return {
    title: document.title,
    hasCanvas: !!canvas,
    cssSize: canvas ? [canvas.clientWidth, canvas.clientHeight] : null,
    bufferSize: canvas ? [canvas.width, canvas.height] : null,
    webgl2: !!gl,
    renderer: gl ? gl.getParameter(gl.RENDERER) : null,
    tabs: document.querySelectorAll('.tab').length,
    orders: document.querySelectorAll('.order-card').length,
    recipes: document.querySelectorAll('.recipe-choice').length,
    upgrades: document.querySelectorAll('.upgrade').length,
    cash: document.querySelector('#cashPill b')?.textContent,
    fps: document.querySelector('#fpsPill')?.textContent,
  };
})()`);

await evaluate(`document.querySelector('#gatherBtn').click()`);
await sleep(900);
const afterGather = await evaluate(`(() => ({
  phase: document.querySelector('#hudPhase')?.textContent,
  temp: document.querySelector('#hudTemp')?.textContent,
  rpm: document.querySelector('#hudRpm')?.textContent,
  metrics: document.querySelectorAll('#telemetryGrid .metric').length,
  overlayHidden: document.querySelector('#stageOverlay')?.hidden,
}))()`);

await evaluate(`[...document.querySelectorAll('.tab')].find(t => t.dataset.page === 'temperature').click()`);
await sleep(700);
const tempPage = await evaluate(`(() => ({
  heatmap: [document.querySelector('#heatmapCanvas')?.width, document.querySelector('#heatmapCanvas')?.height],
  vft: [document.querySelector('#vftCanvas')?.width, document.querySelector('#vftCanvas')?.height],
  anneal: [document.querySelector('#annealCanvas')?.width, document.querySelector('#annealCanvas')?.height],
  stats: document.querySelectorAll('#tempStats .metric').length,
}))()`);

await evaluate(`[...document.querySelectorAll('.tab')].find(t => t.dataset.page === 'orders').click()`);
await sleep(300);
const ordersPage = await evaluate(`document.querySelectorAll('.order-card').length`);

await evaluate(`[...document.querySelectorAll('.tab')].find(t => t.dataset.page === 'bench').click()`);
await sleep(500);
const benchSize = await evaluate(`(() => {
  const c = document.querySelector('#glCanvas');
  const r = c.getBoundingClientRect();
  return { client: [c.clientWidth, c.clientHeight], rect: [Math.round(r.width), Math.round(r.height)], buffer: [c.width, c.height] };
})()`);

console.log(JSON.stringify({ initial, afterGather, tempPage, ordersPage, benchSize, errors }, null, 2));
ws.close();
if (errors.length) process.exitCode = 1;
