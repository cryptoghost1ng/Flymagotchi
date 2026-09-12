// The live circuit on the page. Same simulator the extension ships, no changes:
// lib/ is copied from the extension by tools/sync_web.py.
import { FlyCircuit } from './lib/lif.js';
import { Fly } from './lib/fly-draw.js';
import { mutationFromSeed } from './lib/mutation.js';

const $ = s => document.querySelector(s);
const flyC = $('#fly'), fctx = flyC.getContext('2d');
const netC = $('#net'), nctx = netC.getContext('2d');

let circuit, sim, fly, XY, glow, edgeBg, outEdges;
let silenced = new Set(), hover = -1;
let drive = 0, mn9Hz = 0, activeN = 0, excN = 0, inhN = 0;
// Rates are averaged over a window: per frame, one spike reads as 62 Hz and the
// number flickers between 0 and 200 for no real reason.
const WINDOW = 320;
let accMs = 0, accMn9 = 0, accExc = 0, accInh = 0, accActive = 0, accFrames = 0;
let dimFly, dimNet;

function fit(cv, ctx, h){
  const dpr = devicePixelRatio || 1, w = cv.clientWidth || 320;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}
const measure = () => {
  dimFly = fit(flyC, fctx, flyC.clientHeight || 300);
  dimNet = fit(netC, nctx, netC.clientHeight || 190);
};

(async function start(){
  circuit = await (await fetch('data/circuit.json')).json();
  glow = new Float32Array(circuit.ids.length);

  // a visitor gets a fly too, kept in this browser only
  let seed = localStorage.getItem('flymagotchi-seed');
  if (!seed){
    seed = [...crypto.getRandomValues(new Uint8Array(8))]
      .map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('flymagotchi-seed', seed);
  }
  silenced = new Set(await mutationFromSeed(seed, circuit.pool, 40));

  sim = new FlyCircuit(circuit, { seed: 7 });
  sim.setSilenced([...silenced]);

  const sp = {};
  for (const n of ['body','wing']){ const i = new Image(); i.src = `assets/${n}.png`; sp[n] = i; }
  fly = new Fly(sp);

  measure(); layout(); buildEdges();
  addEventListener('resize', () => { measure(); layout(); paintEdgeBg(); });

  $('#feed').addEventListener('click', feed);
  netC.addEventListener('mousemove', e => {
    const r = netC.getBoundingClientRect();
    hover = nearest(e.clientX - r.left, e.clientY - r.top);
  });
  netC.addEventListener('mouseleave', () => { hover = -1; });
  netC.addEventListener('click', e => {
    const r = netC.getBoundingClientRect();
    const i = nearest(e.clientX - r.left, e.clientY - r.top);
    if (i < 0) return;
    if (i === circuit.mn9){ say('MN9 is the readout — it cannot be silenced.'); return; }
    silenced.has(i) ? silenced.delete(i) : silenced.add(i);
    sim.setSilenced([...silenced]);
    const sign = sim.sign(i);
    say(`${circuit.ids[i]} · ${sign > 0 ? 'excitatory' : sign < 0 ? 'inhibitory' : 'no outputs'}`
      + ` · ${sim.grado[i]} outputs · ${silenced.has(i) ? 'silenced' : 'restored'}`);
  });

  requestAnimationFrame(loop);
})();

function say(t){ $('#hint').innerHTML = t; }

function layout(){
  const m = 10, w = dimNet.w, h = dimNet.h;
  XY = circuit.xy.map(([x,y]) => [m + (x+1)/2*(w-2*m), m + (1-(y+1)/2)*(h-2*m)]);
}

function nearest(px, py){
  let best = -1, d2 = 12*12;
  for (let i = 0; i < XY.length; i++){
    const dx = XY[i][0]-px, dy = XY[i][1]-py, d = dx*dx+dy*dy;
    if (d < d2){ d2 = d; best = i; }
  }
  return best;
}

let feeding = 0;
function feed(){
  drive = circuit.params.r_poi;
  feeding = 2600;
}

function buildEdges(){
  const n = circuit.ids.length, pre = circuit.pre, post = circuit.post, w = circuit.w;
  const start = new Int32Array(n + 1);
  for (let i = 0; i < pre.length; i++) start[pre[i]+1]++;
  for (let i = 0; i < n; i++) start[i+1] += start[i];
  const to = new Int32Array(pre.length), sign = new Int8Array(pre.length);
  const fill = start.slice(0, n);
  for (let i = 0; i < pre.length; i++){
    const j = fill[pre[i]]++; to[j] = post[i]; sign[j] = w[i] >= 0 ? 1 : -1;
  }
  outEdges = { start, to, sign };
  paintEdgeBg();
}

function paintEdgeBg(){
  const dpr = devicePixelRatio || 1;
  edgeBg = document.createElement('canvas');
  edgeBg.width = Math.round(dimNet.w*dpr); edgeBg.height = Math.round(dimNet.h*dpr);
  const c = edgeBg.getContext('2d'); c.setTransform(dpr,0,0,dpr,0,0);
  c.strokeStyle = 'rgba(90,125,190,.10)'; c.lineWidth = .45; c.beginPath();
  const step = Math.max(1, Math.floor(circuit.pre.length / 3500));
  for (let i = 0; i < circuit.pre.length; i += step){
    const a = XY[circuit.pre[i]], b = XY[circuit.post[i]];
    if (a && b){ c.moveTo(a[0],a[1]); c.lineTo(b[0],b[1]); }
  }
  c.stroke();
}

let prev = performance.now();
function loop(now){
  const ms = Math.min(60, now - prev); prev = now;

  if (feeding > 0){ feeding -= ms; if (feeding <= 0) drive = 0; }

  // ---- simulate ----
  let mn9 = 0, exc = 0, inh = 0;
  const steps = Math.round(ms / sim.dt);
  for (let s = 0; s < steps; s++){
    for (const i of sim.step(drive)){
      glow[i] = 1;
      if (i === sim.mn9) mn9++;
      const e0 = sim.rowStart[i];
      if (e0 < sim.rowStart[i+1]) (sim.colW[e0] >= 0 ? exc++ : inh++);
    }
  }
  let nowActive = 0;
  for (let i = 0; i < glow.length; i++){ if (glow[i] > .02) nowActive++; glow[i] *= .82; }

  accMs += ms; accMn9 += mn9; accExc += exc; accInh += inh;
  accActive += nowActive; accFrames++;
  if (accMs >= WINDOW){
    mn9Hz = accMn9 / (accMs / 1000);
    excN = Math.round(accExc / accFrames);
    inhN = Math.round(accInh / accFrames);
    activeN = Math.round(accActive / accFrames);
    accMs = accMn9 = accExc = accInh = accActive = accFrames = 0;
  }

  // ---- the fly ----
  fctx.clearRect(0,0,dimFly.w,dimFly.h);
  fly.update(ms, { walk: Math.min(1, activeN/220), eat: Math.min(1, mn9Hz/45), fly: 0, turn: 0 });
  fctx.save(); fctx.translate(dimFly.w/2, dimFly.h*0.52);
  fly.draw(fctx, Math.min(dimFly.w*0.30, dimFly.h*0.31));
  fctx.restore();

  // ---- the circuit ----
  nctx.clearRect(0,0,dimNet.w,dimNet.h);
  if (edgeBg) nctx.drawImage(edgeBg, 0, 0, dimNet.w, dimNet.h);
  liveSynapses();
  const sugar = new Set(circuit.sugar);
  for (let i = 0; i < XY.length; i++){
    const g = glow[i], [x,y] = XY[i];
    const isMn9 = i === circuit.mn9, off = silenced.has(i);
    nctx.fillStyle = off ? '#5c1f2b'
      : isMn9 ? `rgba(245,159,0,${.42+.58*g})`
      : sugar.has(i) ? `rgba(55,178,77,${.34+.66*g})`
      : `rgba(34,184,207,${.12+.88*g})`;
    nctx.beginPath(); nctx.arc(x, y, isMn9 ? 3.4+2.4*g : 1.4+2.2*g, 0, 7); nctx.fill();
    if (off){
      nctx.strokeStyle = '#e64980'; nctx.lineWidth = 1;
      nctx.beginPath(); nctx.moveTo(x-2.4,y-2.4); nctx.lineTo(x+2.4,y+2.4);
      nctx.moveTo(x+2.4,y-2.4); nctx.lineTo(x-2.4,y+2.4); nctx.stroke();
    }
  }
  if (hover >= 0){
    const [x,y] = XY[hover];
    nctx.beginPath(); nctx.arc(x,y,7,0,7);
    nctx.strokeStyle = 'rgba(233,237,244,.9)'; nctx.lineWidth = 1.3; nctx.stroke();
  }

  $('#r-mn9').textContent = `${mn9Hz.toFixed(0)} Hz`;
  $('#r-active').textContent = `${activeN} / ${circuit.ids.length}`;
  $('#r-exc').textContent = excN;
  $('#r-inh').textContent = inhN;
  requestAnimationFrame(loop);
}

function liveSynapses(){
  if (!outEdges) return;
  const order = [];
  for (let i = 0; i < glow.length; i++) if (glow[i] > .22) order.push(i);
  order.sort((a,b) => glow[b]-glow[a]);
  let drawn = 0; const CAP = 1100;
  nctx.lineWidth = .7;
  for (const i of order){
    if (drawn > CAP) break;
    const a = XY[i]; if (!a) continue;
    const al = Math.min(.38, glow[i]*.4);
    for (let e = outEdges.start[i]; e < outEdges.start[i+1] && drawn <= CAP; e++){
      const b = XY[outEdges.to[e]]; if (!b) continue;
      nctx.strokeStyle = outEdges.sign[e] > 0 ? `rgba(34,184,207,${al})` : `rgba(230,73,128,${al})`;
      nctx.beginPath(); nctx.moveTo(a[0],a[1]); nctx.lineTo(b[0],b[1]); nctx.stroke();
      drawn++;
    }
  }
}

/* ===================================================================
   Fig. 2 — one bite, slowed down.

   Same circuit, same model, but simulated at about a sixteenth of real
   time so a spike crossing a synapse becomes something you can watch.
   Every travelling dot is one spike on one real connection.
   =================================================================== */
(async function slowFigure(){
  const cv = document.querySelector('#slow');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const data = await (await fetch('data/circuit.json')).json();
  const anat = await (await fetch('data/anatomy.json')).json();

  const sim = new FlyCircuit(data, { seed: 3 });
  const SLOW = 16;                       // 1 ms of fly per ~16 ms of wall clock
  const TRAVEL = 620;                    // ms on screen for one synaptic hop
  const MAX_PULSES = 2600;

  // outgoing edges, so a spike knows which synapses to send a pulse down
  const n = data.ids.length;
  const start = new Int32Array(n + 1);
  for (let i = 0; i < data.pre.length; i++) start[data.pre[i] + 1]++;
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const to = new Int32Array(data.pre.length), sg = new Int8Array(data.pre.length);
  { const fill = start.slice(0, n);
    for (let i = 0; i < data.pre.length; i++){
      const j = fill[data.pre[i]]++; to[j] = data.post[i]; sg[j] = data.w[i] >= 0 ? 1 : -1;
    } }

  let XY2 = [], dim = { w: 0, h: 0 }, bg = null;

  // Anatomical coordinates: the frontal projection FlyWire is rendered in.
  // Two optic lobes on the sides, central brain between them.
  function fitSlow(){
    const dpr = devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dim = { w, h };

    // fit the whole brain into the band, keeping its proportions
    const pad = 22;
    let ex = 0, ey = 0;
    for (const [x, y] of anat.brain){ if (x > ex) ex = x; if (y > ey) ey = y; }
    const k = Math.min((w - 2 * pad) / ex, (h - 2 * pad) / ey);
    const ox = (w - ex * k) / 2, oy = (h - ey * k) / 2;
    const put = ([x, y]) => [ox + x * k, oy + y * k];
    XY2 = anat.circuit.map(put);

    bg = document.createElement('canvas');
    bg.width = cv.width; bg.height = cv.height;
    const c = bg.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);

    // the brain itself: 13,000 real neurons, so the circuit has a head to sit in.
    // Drawn additively so overlapping cells build up density, like the EM renders.
    c.globalCompositeOperation = 'lighter';
    for (const p of anat.brain){
      const [x, y] = put(p);
      c.fillStyle = p[2] ? 'rgba(34,120,168,.46)' : 'rgba(196,142,48,.40)';
      c.fillRect(x - .6, y - .6, 1.9, 1.9);
    }
    c.globalCompositeOperation = 'source-over';
    // and the synapses of our circuit over it
    c.strokeStyle = 'rgba(150,190,240,.13)'; c.lineWidth = .55; c.beginPath();
    const step = Math.max(1, Math.floor(data.pre.length / 4200));
    for (let i = 0; i < data.pre.length; i += step){
      const a = XY2[data.pre[i]], b = XY2[data.post[i]];
      if (a && b){ c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
    }
    c.stroke();
  }
  fitSlow(); addEventListener('resize', fitSlow);

  const sugar = new Set(data.sugar);
  const glow2 = new Float32Array(n);
  let pulses = [];
  let simT = 0, carry = 0, cycle = 0, drive2 = 0, running = false;

  // only animate while the figure is actually on screen
  new IntersectionObserver(es => { running = es[0].isIntersecting; },
    { threshold: 0.08 }).observe(cv);

  let prev2 = performance.now();
  function frame(now){
    const ms = Math.min(48, now - prev2); prev2 = now;
    requestAnimationFrame(frame);
    if (!running) return;

    // --- advance the simulation slowly ---
    cycle += ms;
    if (cycle > 5200){ cycle = 0; simT = 0; pulses.length = 0; sim.setSilenced([]); }
    drive2 = (cycle > 700 && cycle < 2100) ? data.params.r_poi : 0;

    carry += ms / SLOW;
    const steps = Math.floor(carry / sim.dt);
    carry -= steps * sim.dt;
    for (let s = 0; s < steps; s++){
      simT += sim.dt;
      for (const i of sim.step(drive2)){
        glow2[i] = 1;
        if (pulses.length < MAX_PULSES){
          for (let e = start[i]; e < start[i + 1]; e++){
            if (pulses.length >= MAX_PULSES) break;
            pulses.push({ a: i, b: to[e], t: now, s: sg[e] });
          }
        }
      }
    }

    // --- draw ---
    ctx.clearRect(0, 0, dim.w, dim.h);
    if (bg) ctx.drawImage(bg, 0, 0, dim.w, dim.h);

    let alive = 0;
    for (const p of pulses){
      const u = (now - p.t) / TRAVEL;
      if (u >= 1) continue;
      pulses[alive++] = p;
      const A = XY2[p.a], B = XY2[p.b];
      if (!A || !B) continue;
      const x = A[0] + (B[0] - A[0]) * u, y = A[1] + (B[1] - A[1]) * u;
      const fade = Math.sin(Math.PI * u);            // fades in and out along the way
      ctx.fillStyle = p.s > 0 ? `rgba(34,184,207,${.72 * fade})` : `rgba(230,73,128,${.72 * fade})`;
      ctx.beginPath(); ctx.arc(x, y, 1.5 + 1.1 * fade, 0, 7); ctx.fill();
    }
    pulses.length = alive;

    for (let i = 0; i < n; i++){
      const g = glow2[i]; glow2[i] *= .93;
      const [x, y] = XY2[i];
      const isMn9 = i === data.mn9;
      if (g < .02 && !isMn9 && !sugar.has(i)){
        ctx.fillStyle = 'rgba(150,180,225,.26)';
        ctx.beginPath(); ctx.arc(x, y, 1.3, 0, 7); ctx.fill();
        continue;
      }
      ctx.fillStyle = isMn9 ? `rgba(245,159,0,${.5 + .5 * g})`
        : sugar.has(i) ? `rgba(55,178,77,${.42 + .58 * g})`
        : `rgba(120,200,235,${.18 + .82 * g})`;
      ctx.beginPath(); ctx.arc(x, y, isMn9 ? 4.5 + 4 * g : 1.5 + 3.4 * g, 0, 7); ctx.fill();
      if (isMn9 && g > .05){
        ctx.strokeStyle = `rgba(245,159,0,${.5 * g})`; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(x, y, 9 + 16 * (1 - g), 0, 7); ctx.stroke();
      }
    }
    // MN9 always labelled, so you know what to watch
    const M = XY2[data.mn9];
    ctx.fillStyle = 'rgba(245,159,0,.85)';
    ctx.font = '600 11px IBM Plex Mono, monospace';
    ctx.fillText('MN9', M[0] + 12, M[1] + 4);

    document.querySelector('#slow-t').textContent = `${simT.toFixed(1)} ms`;
    document.querySelector('#slow-phase').textContent =
      drive2 ? 'sugar on the mouthparts' :
      pulses.length > 40 ? `${pulses.length} spikes in flight` :
      simT > 1 ? 'settling' : 'waiting for sugar';
  }
  requestAnimationFrame(frame);
})();

/* The launch block. Every number comes from results/decision.json via
   src/build_launch.py — never typed by hand. If there is no contract address
   yet, the whole section stays hidden rather than claiming something untrue. */
(async function launchBlock(){
  const sec = document.querySelector('#token');
  if (!sec) return;
  let L;
  try { L = await (await fetch('data/launch.json')).json(); } catch { return; }
  if (!L.live) return;                       // nothing launched yet: say nothing

  const set = (sel, v) => document.querySelectorAll(sel).forEach(e => e.textContent = v);
  set('#tk-ticker, .tk-ticker', L.ticker);
  set('#tk-decided, .tk-decided', L.decidedAt);
  set('#tk-threshold', L.threshold);
  set('#tk-chain', L.chain);
  set('#tk-ca', L.ca);
  set('#tk-seed', L.seed);
  set('#tk-hash8', L.hash.slice(0, 12));

  const link = document.querySelector('#tk-explorer');
  if (L.explorer) link.href = L.explorer; else link.hidden = true;

  const btn = document.querySelector('#tk-copy');
  btn.addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(L.ca); ok = true; }
    catch {
      // the async clipboard needs focus and a secure context; this works anywhere
      const ta = document.createElement('textarea');
      ta.value = L.ca; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch {}
      ta.remove();
    }
    btn.textContent = ok ? 'Copied' : 'Select it and copy';
    btn.classList.toggle('done', ok);
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1800);
  });

  sec.hidden = false;
})();

/* The stock pairing, shown only when there actually is one. */
(async function pairBlock(){
  const h = document.querySelector('#pair-h'), block = document.querySelector('#pair-block');
  if (!h || !block) return;
  let L;
  try { L = await (await fetch('data/launch.json')).json(); } catch { return; }
  if (!L.live || !L.pair){ h.hidden = true; block.hidden = true; return; }
  document.querySelectorAll('.tk-pair').forEach(e => e.textContent = L.pair);
  // the Google line only makes sense for Google; any other pair drops it
  const why = document.querySelector('#pair-why');
  if (!/^GOOGL?$/i.test(L.pair) && !/alphabet|google/i.test(L.pairName || '')) why.remove();
})();
