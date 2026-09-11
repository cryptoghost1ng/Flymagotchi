import { mutationFromSeed, nameFromSeed } from './mutation.js';
import { Fly, SugarDrop } from './fly-draw.js';

const VERSION = '1789165980';   // la estampa el build: evita que el navegador sirva un worker viejo

// --- almacen: chrome.storage en la extension, localStorage en el banco de pruebas
const store = {
  async get(k){
    if (globalThis.chrome?.storage) return chrome.storage.local.get(k);
    const o={}; for (const n of [].concat(k)) { const v=localStorage.getItem(n); if(v!==null) o[n]=JSON.parse(v); }
    return o;
  },
  async set(o){
    if (globalThis.chrome?.storage) return chrome.storage.local.set(o);
    for (const [n,v] of Object.entries(o)) localStorage.setItem(n, JSON.stringify(v));
  }
};

const HOURS_TO_STARVING = 4;          // full -> starving. Game constant, not biology.
const FULLNESS_PER_MEAL   = 0.42;

const $ = s => document.querySelector(s);
const esc = $('#stage'), ctx = esc.getContext('2d');
const netC = $('#net'), nctx = netC.getContext('2d');
const traceC = $('#trace'), tctx = traceC.getContext('2d');

// los lienzos se estiran por CSS: hay que darles resolucion real o se ven borrosos
function fitCanvas(cv, c2d, alto){
  const dpr = devicePixelRatio || 1, w = cv.clientWidth || 340;
  cv.width = Math.round(w*dpr); cv.height = Math.round(alto*dpr);
  c2d.setTransform(dpr,0,0,dpr,0,0);
  return { w, h: alto };
}
let dimStage, dimNet, dimTrace;
const resize = () => {
  dimStage = fitCanvas(esc, ctx, 320);
  dimNet = fitCanvas(netC, nctx, 210);
  dimTrace = fitCanvas(traceC, tctx, 42);
};
addEventListener('resize', () => { resize(); relayout(); paintEdgeBackground(); });
function relayout(){
  if (!circuit) return;
  const m = 12, w = dimNet.w, h = dimNet.h;
  XY = circuit.xy.map(([x,y]) => [m+(x+1)/2*(w-2*m), m+(1-(y+1)/2)*(h-2*m)]);
}

let circuit, fly, drop = null, worker, sugarImg;
let hunger = 0.5, mn9Hz = 0, activeN = 0, excN = 0, inhN = 0;
let glow, XY, nSilenced = 0, lastMeal = Date.now(), mealCount = 0;
let outEdges = null, edgeBg = null;        // synapse index + static background layer
let silencedNow = new Set(), silencedBase = [], hover = -1, fichaDe = -1;
const history = [];                       // MN9 Hz de los ultimos 20 s

(async function start(){
  circuit = await (await fetch('data/circuit.json')).json();
  glow = new Float32Array(circuit.ids.length);

  let { semilla, nacida, ultima_comida, comidas } = await store.get(
    ['semilla','nacida','ultima_comida','comidas']);
  if (!semilla){
    semilla = [...crypto.getRandomValues(new Uint8Array(8))]
      .map(b=>b.toString(16).padStart(2,'0')).join('');
    nacida = ultima_comida = Date.now(); comidas = 0;
    await store.set({ semilla, nacida, ultima_comida, comidas });
  }
  const silenciadas = await mutationFromSeed(semilla, circuit.pool, 40);
  silencedBase = silenciadas.slice(); silencedNow = new Set(silenciadas);
  nSilenced = silenciadas.length;
  $('#name').textContent = nameFromSeed(semilla);
  $('#mut').textContent = nSilenced;
  $('#age').textContent = ageText(nacida);

  // el hunger avanza con el reloj, aunque cierres el navegador
  lastMeal = ultima_comida; mealCount = comidas || 0;
  hunger = Math.min(1, (Date.now()-ultima_comida)/(HOURS_TO_STARVING*3600e3));

  resize(); relayout();
  buildEdges();

  const sp = {};
  for (const n of ['body', 'wing']) { const i = new Image(); i.src = `assets/${n}.png`; sp[n] = i; }
  sugarImg = new Image(); sugarImg.src = 'assets/sugar.png';
  fly = new Fly(sp);

  worker = new Worker(`js/sim-worker.js?v=${VERSION}`, { type: 'module' });
  worker.onmessage = e => {
    const m2 = e.data;
    if (m2.tipo === 'listo'){
      $('#foot').textContent = `${m2.n} neurons · ${m2.sinapsis.toLocaleString('en')} synapses · `
        + 'extracted from the FlyWire v630 connectome (127,400 neurons). '
        + 'Leaky integrate-and-fire model from Shiu et al. 2024.';
    } else if (m2.tipo === 'ficha'){
      drawCard(m2);
    } else if (m2.tipo === 'silencio'){
      $('#mut').textContent = m2.n;
    } else if (m2.tipo === 'frame'){
      const seg = m2.ms/1000 || 0.05;
      mn9Hz = m2.mn9/seg; excN = m2.exc; inhN = m2.inh;
      activeN = 0;
      for (let i=0;i<glow.length;i++){
        glow[i] *= 0.82;
        if (m2.disparos[i]) { glow[i]=1; activeN++; }
      }
      if (m2.mn9>0) satiate(m2.mn9);
    }
  };
  worker.postMessage({ tipo:'init', datos:circuit, silenciadas });

  netC.addEventListener('mousemove', e => {
    const r = netC.getBoundingClientRect();
    hover = nearestNeuron(e.clientX - r.left, e.clientY - r.top);
  });
  netC.addEventListener('mouseleave', () => { hover = -1; });
  netC.addEventListener('click', e => {
    const r = netC.getBoundingClientRect();
    const i = nearestNeuron(e.clientX - r.left, e.clientY - r.top);
    if (i < 0) return;
    if (i === circuit.mn9) { showCard(i, 'MN9 cannot be silenced: it is the readout'); return; }
    silencedNow.has(i) ? silencedNow.delete(i) : silencedNow.add(i);
    worker.postMessage({ tipo: 'silenciar', indices: [...silencedNow] });
    showCard(i);
  });
  $('#reset').addEventListener('click', () => {
    silencedNow = new Set(silencedBase);
    worker.postMessage({ tipo: 'silenciar', indices: [...silencedNow] });
    fichaDe = -1; $('#card').hidden = true;
  });
  const help = $('#help');
  $('#helpbtn').addEventListener('click', () => { help.hidden = !help.hidden; });
  $('#helpclose').addEventListener('click', () => { help.hidden = true; store.set({ seenHelp: 1 }); });
  const { seenHelp } = await store.get('seenHelp');
  if (!seenHelp) help.hidden = false;        // se abre solo la primera vez
  $('#feed').addEventListener('click', feed);
  if (globalThis.chrome?.permissions) setupRelease(); else $('#release').style.display='none';
  esc.addEventListener('click', feed);
  requestAnimationFrame(draw);
  setInterval(async () => {
    hunger = Math.min(1, hunger + 1/(HOURS_TO_STARVING*3600));   // +1s
    const s = await store.get('ultima_comida');
    $('#age').textContent = ageText(nacida);
  }, 1000);
})().catch(e => {
  // si el start falla, que se vea: antes se quedaba en blanco sin decir nada
  console.error('[flymagotchi] startup failed:', e);
  const el = document.getElementById('estado');
  if (el) { el.textContent = 'error: ' + e.message; el.style.color = '#f87171'; }
});

function feed(){
  if (drop?.activa) return;
  newMeal();
  drop = new SugarDrop(dimStage.w, dimStage.h, sugarImg);
  // el azucar se le ofrece durante 2,5 s: eso es el `drive` sobre las 21 GRNs
  worker.postMessage({ tipo:'drive', valor: circuit.params.r_poi });

  setTimeout(async () => {
    worker.postMessage({ tipo:'drive', valor: 0 });
    const { comidas=0 } = await store.get('comidas');
    mealCount = comidas + 1; lastMeal = Date.now();
    await store.set({ comidas: mealCount, ultima_comida: lastMeal });
    setTimeout(() => { drop = null; }, 1200);
  }, 2500);
}

// Cuanto mas dispara MN9, mas come: la saciedad la marca SU motoneurona.
// Cada comida cuenta sus propios spikes y aporta como mucho FULLNESS_PER_MEAL.
let mealSpikes = 0, mealGiven = 0;
function newMeal(){ mealSpikes = 0; mealGiven = 0; }
function satiate(nSpikes){
  mealSpikes += nSpikes;
  const objetivo = FULLNESS_PER_MEAL * Math.min(1, mealSpikes / 160);
  const delta = objetivo - mealGiven;          // solo lo que falta por feed
  if (delta > 0) { hunger = Math.max(0, hunger - delta); mealGiven = objetivo; }
}

function ageText(nacida){
  const s=(Date.now()-nacida)/1000;
  if (s<3600) return `${Math.floor(s/60)} min old`;
  if (s<86400) return `${Math.floor(s/3600)} h old`;
  return `${Math.floor(s/86400)} days old`;
}

function draw(){
  const act = Math.min(1, activeN/120);
  const ahora = performance.now(); const dt = Math.min(60, ahora - (draw._t || ahora)); draw._t = ahora;
  ctx.clearRect(0, 0, dimStage.w, dimStage.h);
  fly.update(dt, { walk: act * 0.5, eat: Math.min(1, mn9Hz / 45), fly: 0, turn: 0 });
  ctx.save(); ctx.translate(dimStage.w / 2, dimStage.h * 0.52);
  fly.draw(ctx, Math.min(dimStage.w * 0.30, dimStage.h * 0.30));
  ctx.restore();
  if (drop) drop.paso(ctx);

  // el circuit, neurona a neurona
  nctx.clearRect(0,0,dimNet.w,dimNet.h);
  const isSugar = new Set(circuit.sugar);
  for (let i=0;i<XY.length;i++){
    const b = glow[i], [px,py] = XY[i];
    const mn9 = i === circuit.mn9, off = silencedNow.has(i);
    let r = mn9 ? 3.4+2.6*b : 1.4+2.4*b;
    if (off)            nctx.fillStyle = '#5c1f2b';
    else if (mn9)       nctx.fillStyle = `rgba(255,209,102,${0.4+0.6*b})`;
    else if (isSugar.has(i)) nctx.fillStyle = `rgba(74,222,128,${0.35+0.65*b})`;
    else                nctx.fillStyle = `rgba(124,231,255,${0.12+0.88*b})`;
    nctx.beginPath(); nctx.arc(px,py,r,0,7); nctx.fill();
    if (off){                                   // aspa sobre las silenciadas
      nctx.strokeStyle='#f87171'; nctx.lineWidth=1;
      nctx.beginPath(); nctx.moveTo(px-2.6,py-2.6); nctx.lineTo(px+2.6,py+2.6);
      nctx.moveTo(px+2.6,py-2.6); nctx.lineTo(px-2.6,py+2.6); nctx.stroke();
    }
  }
  if (hover >= 0){                              // halo de lo que vas a tocar
    const [px,py] = XY[hover];
    nctx.beginPath(); nctx.arc(px,py,7,0,7);
    nctx.strokeStyle='rgba(232,236,245,.85)'; nctx.lineWidth=1.3; nctx.stroke();
  }
  if (fichaDe >= 0 && fichaDe !== hover){
    const [px,py] = XY[fichaDe];
    nctx.beginPath(); nctx.arc(px,py,6,0,7);
    nctx.strokeStyle='rgba(255,209,102,.75)'; nctx.lineWidth=1.2; nctx.stroke();
  }

  // traza de MN9: aqui se ve el efecto de lo que silencias
  if (!draw._th || ahora - draw._th > 160){
    draw._th = ahora;
    history.push(mn9Hz);
    if (history.length > 125) history.shift();   // ~20 s
    drawTrace();
  }

  $('#mn9').textContent = `${mn9Hz.toFixed(0)} Hz`;
  $('#active').textContent = `${activeN} / ${circuit.ids.length}`;
  $('#exc').textContent = excN; $('#inh').textContent = inhN;
  $('#hunger').style.width = `${hunger*100}%`;
  $('#hunger').style.background = hunger>0.75 ? '#f87171' : hunger>0.45 ? '#facc15' : '#4ade80';
  $('#hunger-val').textContent =
    `${hunger>0.8 ? 'starving' : hunger>0.5 ? 'hungry' : hunger>0.2 ? 'peckish' : 'full'}`
    + ` · ${Math.round(hunger*100)}%`;
  $('#last-meal').textContent = `last meal ${timeAgo(lastMeal)}`;
  $('#meals').textContent = `${mealCount} meal${mealCount === 1 ? '' : 's'}`;
  const chip = $('#state');
  if (mn9Hz > 5){ chip.textContent = 'eating'; chip.classList.add('eating'); }
  else { chip.classList.remove('eating');
         chip.textContent = hunger>0.7 ? 'looking for food' : 'resting'; }
  requestAnimationFrame(draw);
}


// --- soltarla por la web: el permiso se pide AQUI, no al instalar ---------
const RULE = {
  id: 'fly-isOut',
  matches: ['*://*/*'],
  js: ['js/overlay.bundle.js'],     // un solo script clasico: sin import() ni Worker,
  runAt: 'document_idle',           // que el CSP de la pagina bloquearia
};

async function setupRelease(){
  const btn = $('#release');
  const isOut = () => chrome.permissions.contains({ origins: ['*://*/*'] });
  const paintBtn = async () => {
    const s = await isOut();
    btn.textContent = s ? 'Bring it back' : 'Let it out on the web';
    btn.classList.toggle('on', s);
  };
  await paintBtn();

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      if (await isOut()) {
        // recogerla: quitar de las pestañas abiertas y dejar de inyectar
        for (const t of await chrome.tabs.query({})) {
          chrome.tabs.sendMessage(t.id, 'recoger').catch(() => {});
        }
        await chrome.scripting.unregisterContentScripts({ ids: [RULE.id] }).catch(() => {});
        await chrome.permissions.remove({ origins: ['*://*/*'] });
      } else {
        if (!await chrome.permissions.request({ origins: ['*://*/*'] })) return;
        await registerRule();
        // y que aparezca ya en la pestaña que estás mirando, sin recargar
        const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (t?.id && /^https?:/.test(t.url || '')) {
          chrome.scripting.executeScript({ target: { tabId: t.id }, files: RULE.js })
            .catch(e => console.warn('cannot come out here:', e.message));
        }
      }
    } finally { btn.disabled = false; await paintBtn(); }
  });
}

async function registerRule(){
  const ya = await chrome.scripting.getRegisteredContentScripts({ ids: [RULE.id] }).catch(() => []);
  if (ya.length) await chrome.scripting.updateContentScripts([RULE]);
  else await chrome.scripting.registerContentScripts([RULE]);
}


// --- laboratorio: inspeccionar y silenciar neuronas -----------------------
function nearestNeuron(px, py){
  let mejor = -1, d2 = 14 * 14;
  for (let i = 0; i < XY.length; i++){
    const dx = XY[i][0] - px, dy = XY[i][1] - py, d = dx * dx + dy * dy;
    if (d < d2) { d2 = d; mejor = i; }
  }
  return mejor;
}

function showCard(i, aviso){
  fichaDe = i; $('#card').dataset.aviso = aviso || '';
  worker.postMessage({ tipo: 'ficha', i });
}

function drawCard(f){
  const el = $('#card'); el.hidden = false;
  const id = circuit.ids[f.i];
  const papel = f.i === circuit.mn9 ? 'MN9 · extends the proboscis'
    : circuit.sugar.includes(f.i) ? 'sugar sensor · input'
    : 'interneuron';
  const sig = f.signo > 0 ? '<span style="color:#7ce7ff">excitatory</span>'
            : f.signo < 0 ? '<span style="color:#f472b6">inhibitory</span>' : 'no outputs';
  el.innerHTML = `<div class="t">${papel}</div>`
    + `<div><span class="k">FlyWire id</span> ${id}</div>`
    + `<div><span class="k">type</span> ${sig} · <span class="k">outputs</span> ${f.grado}</div>`
    + `<div><span class="k">state</span> ${f.silenciada ? '<span style="color:#f87171">silenced</span>' : 'active'}</div>`
    + (el.dataset.aviso ? `<div style="color:var(--oro)">${el.dataset.aviso}</div>` : '');
}

function drawTrace(){
  const w = dimTrace.w, h = dimTrace.h;
  tctx.clearRect(0, 0, w, h);
  if (history.length < 2) return;
  const max = Math.max(30, ...history);
  $('#trace-max').textContent = `peak ${Math.round(max)} Hz`;
  tctx.beginPath();
  history.forEach((v, k) => {
    const x = k / (history.length - 1) * w, y = h - (v / max) * (h - 4) - 2;
    k ? tctx.lineTo(x, y) : tctx.moveTo(x, y);
  });
  tctx.strokeStyle = '#ffd166'; tctx.lineWidth = 1.4; tctx.stroke();
  tctx.lineTo(w, h); tctx.lineTo(0, h); tctx.closePath();
  tctx.fillStyle = 'rgba(255,209,102,.12)'; tctx.fill();
}


// "3 min ago" / "2 h ago" — so you can see the clock is actually running
function timeAgo(t){
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return `${Math.floor(s)} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}


// --- synapses -------------------------------------------------------------
// Each line is a real synaptic connection. The faint ones are always there;
// the bright ones are the connections that just carried a spike.
function buildEdges(){
  const n = circuit.ids.length, pre = circuit.pre, post = circuit.post, w = circuit.w;
  const count = new Int32Array(n + 1);
  for (let i = 0; i < pre.length; i++) count[pre[i] + 1]++;
  for (let i = 0; i < n; i++) count[i + 1] += count[i];
  const idx = new Int32Array(pre.length), sign = new Int8Array(pre.length);
  const fill = count.slice(0, n);
  for (let i = 0; i < pre.length; i++){
    const j = fill[pre[i]]++;
    idx[j] = post[i]; sign[j] = w[i] >= 0 ? 1 : -1;
  }
  outEdges = { start: count, to: idx, sign };
  paintEdgeBackground();
}

function paintEdgeBackground(){
  if (!XY) return;
  const dpr = devicePixelRatio || 1;
  edgeBg = document.createElement('canvas');
  edgeBg.width = Math.round(dimNet.w * dpr); edgeBg.height = Math.round(dimNet.h * dpr);
  const c = edgeBg.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.strokeStyle = 'rgba(90,120,190,.085)'; c.lineWidth = 0.45;
  // a fixed sample, otherwise 20,901 lines turn the panel into soup
  const step = Math.max(1, Math.floor(circuit.pre.length / 3500));
  c.beginPath();
  for (let i = 0; i < circuit.pre.length; i += step){
    const a = XY[circuit.pre[i]], b = XY[circuit.post[i]];
    if (!a || !b) continue;
    c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
  }
  c.stroke();
}

// Draws the connections leaving the neurons that fired this frame.
function drawLiveSynapses(){
  if (!outEdges) return;
  const orden = [];
  for (let i = 0; i < glow.length; i++) if (glow[i] > 0.20) orden.push(i);
  orden.sort((a, b) => glow[b] - glow[a]);
  let drawn = 0;
  const TOPE = 1600;                      // keeps it at 60 fps on a laptop
  nctx.lineWidth = 0.7;
  for (const i of orden){
    if (drawn > TOPE) break;
    const a = XY[i]; if (!a) continue;
    const alpha = Math.min(0.5, glow[i] * 0.5);
    for (let e = outEdges.start[i]; e < outEdges.start[i + 1] && drawn <= TOPE; e++){
      const b = XY[outEdges.to[e]]; if (!b) continue;
      nctx.strokeStyle = outEdges.sign[e] > 0
        ? `rgba(124,231,255,${alpha})` : `rgba(244,114,182,${alpha})`;
      nctx.beginPath(); nctx.moveTo(a[0], a[1]); nctx.lineTo(b[0], b[1]); nctx.stroke();
      drawn++;
    }
  }
}
