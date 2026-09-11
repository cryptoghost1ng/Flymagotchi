// GENERADO por src/build_overlay.py — no editar a mano.
// Fuentes: js/lif.js, js/mutation.js, js/fly-draw.js, js/overlay-core.js

// ---------- js/lif.js ----------
// Leaky integrate-and-fire simulator for the fly's feeding circuit.
// Same equations and constants as Shiu et al. 2024 (Nature), solved exactly
// (the system is linear), the same way Brian2's method='linear' does.
//
//   dv/dt = (v_0 - v + g) / t_mbr     (congelado en refractario)
//   dg/dt = -g / tau                  (congelado en refractario)
//   spikes if v > v_th  ->  v = v_rst, g = 0, refractory for t_rfc
//   synapse: when the presynaptic neuron fires, g_post += w after a t_dly delay
class FlyCircuit {
  constructor(data, { dt = 0.1, seed = 1 } = {}) {
    const p = data.params;
    this.dt = dt;
    this.n = data.ids.length;
    this.p = p;
    this.mn9 = data.mn9;
    this.sugar = data.sugar;

    // --- exact integration-step coefficients ---
    const a = 1 / p.t_mbr, b = 1 / p.tau;
    this.ea = Math.exp(-a * dt);
    this.eb = Math.exp(-b * dt);
    this.k = a / (a - b);              // g -> v coupling

    // --- synapses sorted by presynaptic neuron (CSR) ---
    const m = data.pre.length;
    const cnt = new Int32Array(this.n + 1);
    for (let i = 0; i < m; i++) cnt[data.pre[i] + 1]++;
    for (let i = 0; i < this.n; i++) cnt[i + 1] += cnt[i];
    this.rowStart = cnt;
    this.colIdx = new Int32Array(m);
    this.colW = new Float32Array(m);
    this.grado = new Int32Array(this.n);        // outgoing connections per neuron
    const fill = cnt.slice(0, this.n);
    for (let i = 0; i < m; i++) {
      const j = fill[data.pre[i]]++;
      this.colIdx[j] = data.post[i];
      this.colW[j] = data.w[i];
      this.grado[data.pre[i]]++;
    }
    this.colW0 = this.colW.slice();             // original weights, so silencing is reversible
    this.silenciadas = new Set();

    // --- state ---
    this.v = new Float32Array(this.n).fill(p.v_0);
    this.g = new Float32Array(this.n);
    this.rfc = new Float32Array(this.n).fill(p.t_rfc);
    this.until = new Float32Array(this.n);     // end of refractory period
    for (const i of this.sugar) this.rfc[i] = 0;

    // --- synaptic delay queue ---
    this.dSteps = Math.max(1, Math.round(p.t_dly / dt));
    this.queue = Array.from({ length: this.dSteps }, () => new Float32Array(this.n));
    this.qi = 0;
    this.t = 0;
    this.spikes = new Int32Array(this.n);      // spike count per neuron
    this.lastSpike = [];
    this.rng = mulberry32(seed);
  }

  // One dt-ms step. `drive` in Hz onto the sugar GRNs (0 = no food).
  step(drive) {
    const { p, dt, n } = this;
    const inbox = this.queue[this.qi];

    // Poisson input onto the sugar neurons (direct jump in v)
    if (drive > 0) {
      const lam = drive * dt / 1000, wp = p.w_syn * p.f_poi;
      for (const i of this.sugar) {
        let k = poisson(lam, this.rng);
        if (k) this.v[i] += wp * k;
      }
    }

    this.lastSpike.length = 0;
    for (let i = 0; i < n; i++) {
      // While refractory a neuron neither integrates NOR receives input: verified
      // against Brian2 (three synaptic pulses onto a refractory neuron leave g at 0).
      if (this.t < this.until[i]) { inbox[i] = 0; continue; }
      const g0 = this.g[i] + inbox[i];
      inbox[i] = 0;
      const gn = g0 * this.eb;
      const vn = p.v_0 + this.k * g0 * this.eb
               + (this.v[i] - p.v_0 - this.k * g0) * this.ea;
      if (vn > p.v_th) {
        this.v[i] = p.v_rst; this.g[i] = 0;
        this.until[i] = this.t + this.rfc[i];
        this.spikes[i]++; this.lastSpike.push(i);
      } else { this.v[i] = vn; this.g[i] = gn; }
    }

    // deliver spikes after the synaptic delay
    const dest = inbox;     // already emptied: reused, and read again dSteps steps from now
    for (const i of this.lastSpike) {
      for (let e = this.rowStart[i]; e < this.rowStart[i + 1]; e++) dest[this.colIdx[e]] += this.colW[e];
    }
    this.qi = (this.qi + 1) % this.dSteps;
    this.t += dt;
    return this.lastSpike;
  }

  silence(indices) { this.setSilenced([...this.silenciadas, ...indices]); }

  // Silencing means zeroing a neuron's OUTGOING synapses, like the optogenetic
  // silencing in the paper. Reversible: always rebuilt from the original weights.
  setSilenced(indices) {
    this.colW.set(this.colW0);
    this.silenciadas = new Set(indices);
    for (const i of this.silenciadas)
      for (let e = this.rowStart[i]; e < this.rowStart[i + 1]; e++) this.colW[e] = 0;
  }

  // +1 excitatory, -1 inhibitory, 0 no outputs (from the sign of its weights)
  signo(i) {
    const a = this.rowStart[i], b = this.rowStart[i + 1];
    if (a >= b) return 0;
    let s = 0;
    for (let e = a; e < b; e++) s += this.colW0[e];
    return s > 0 ? 1 : s < 0 ? -1 : 0;
  }
  rate(i, ms) { return this.spikes[i] / (ms / 1000); }
}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function poisson(lam, rng) {          // Knuth's method; lambda is always tiny here
  const L = Math.exp(-lam);
  let k = 0, pr = 1;
  do { k++; pr *= rng(); } while (pr > L);
  return k - 1;
}


// ---------- js/mutation.js ----------
// Deterministic mutation from a seed: same seed, same fly.
// Mirrors mutation_from_seed() in the Python model.
async function mutationFromSeed(semilla, pool, k = 40) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(semilla));
  const b = new Uint8Array(h);
  let estado = 0n;
  for (let i = 0; i < 8; i++) estado = (estado << 8n) | BigInt(b[i]);
  const rnd = () => {                    // xorshift64* seeded from the hash
    estado ^= estado >> 12n; estado ^= (estado << 25n) & 0xFFFFFFFFFFFFFFFFn;
    estado ^= estado >> 27n;
    return Number((estado * 0x2545F4914F6CDD1Dn & 0xFFFFFFFFFFFFFFFFn) >> 33n) / 2147483648;
  };
  const p = [...pool];
  for (let i = p.length - 1; i > 0; i--) {        // Fisher-Yates
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p.slice(0, k).sort((a, b2) => a - b2);
}
function nameFromSeed(semilla) {
  let h = 0;
  for (const c of semilla) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return '#' + (h >>> 0).toString(16).toUpperCase().padStart(6, '0').slice(0, 6);
}


// ---------- js/fly-draw.js ----------
// Drawing and animation of the fly.
//
// Everything that moves comes from `state`, fed by the circuit readouts:
// walk = leg motor neurons, eat = MN9, fly = wing motor neurons and TTMn.
// Nothing is decided here: it only draws what they say.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

// Six legs. Tripod A = front-left + mid-right + hind-left.
// That is the real insect gait: three feet planted, three swinging, alternating.
const PATAS = [
  { id: 'flL', side: -1, tri: 0, anchor: [-0.30, 0.34], aep: [-0.92, 0.86], pep: [-0.74, 0.24] },
  { id: 'mlL', side: -1, tri: 1, anchor: [-0.34, 0.04], aep: [-1.06, 0.26], pep: [-1.00, -0.42] },
  { id: 'hlL', side: -1, tri: 0, anchor: [-0.30, -0.22], aep: [-0.96, -0.40], pep: [-0.72, -1.04] },
  { id: 'flR', side: 1, tri: 1, anchor: [0.30, 0.34], aep: [0.92, 0.86], pep: [0.74, 0.24] },
  { id: 'mlR', side: 1, tri: 0, anchor: [0.34, 0.04], aep: [1.06, 0.26], pep: [1.00, -0.42] },
  { id: 'hlR', side: 1, tri: 1, anchor: [0.30, -0.22], aep: [0.96, -0.40], pep: [0.72, -1.04] },
];
class Fly {
  constructor(sprites = {}) {
    this.sp = sprites;                 // { body, wing }
    this.gaitPhase = 0;                     // gait phase
    this.beatPhase = 0;                    // wingbeat phase
    this.proboscis = 0;                     // proboscis extended (0..1)
    this.z = 0;                        // flight altitude (0..1)
    this.wingsOpen = 0;                     // wings unfolded (0..1)
    this.groom = 0;                     // grooming (0..1)
    this.groomT = 0;
    this.glint = 0;                   // eye glint
    this.bank = 0;                    // bank angle when turning
    this.flick = 0;                   // wing flick amount (0..1)
    this.flickT = 0;                  // ms until the next flick
    this.wasStill = true;             // was it stopped on the previous frame
  }

  // dt in ms. state: {walk, eat, fly, turn}
  // A missing key used to turn the whole state into NaN and silently stop the
  // legs and the wings from being drawn at all. Now it just reads as zero.
  update(dt, state) {
    const e = {
      walk: +state.walk || 0, eat: +state.eat || 0,
      fly: +state.fly || 0, turn: +state.turn || 0,
    };
    const k = dt / 16.7;
    const ease = (v, o, r) => v + (o - v) * clamp(r * k, 0, 1);

    this.z = ease(this.z, e.fly, 0.10);
    this.wingsOpen = ease(this.wingsOpen, Math.max(e.fly, this.z > 0.02 ? 1 : 0), 0.16);
    this.proboscis = ease(this.proboscis, e.eat, e.eat > this.proboscis ? 0.30 : 0.09);
    this.bank = ease(this.bank, clamp((e.turn || 0) * 9, -0.5, 0.5), 0.12);

    // the gait advances with leg push; it stops while flying or eating
    const walking = e.walk * (1 - this.z) * (1 - this.proboscis * 0.8);
    this.gaitPhase = (this.gaitPhase + walking * 0.40 * k) % TAU;

    // wingbeat: really ~200 Hz, impossible to draw; shown as motion blur
    this.beatPhase = (this.beatPhase + (0.45 + 0.35 * this.z) * k) % TAU;

    // grooming: only when idle, like a real fly
    const busy = e.walk > 0.15 || e.eat > 0.05 || this.z > 0.02;
    this.groomT = busy ? 0 : this.groomT + dt;
    const wants = !busy && this.groomT > 2200 && (Math.sin(this.groomT / 900) > 0.25);
    this.groom = ease(this.groom, wants ? 1 : 0, 0.07);
    this.glint = (this.glint + 0.012 * k) % TAU;

    // wing flick: short, sporadic, only while idle
    this.flickT -= dt;
    if (this.flickT <= 0 && this.wingsOpen < 0.15) {
      this.flickT = 1100 + Math.random() * 3000;
      this.flick = 1;
    }
    this.flick = ease(this.flick, 0, 0.10);
    // flies buzz their wings for a moment when they start moving
    if (e.walk > 0.5 && this.wasStill) this.flick = 1;
    this.wasStill = e.walk < 0.1;
  }

  // S = half body size in pixels. The origin is the centre of the thorax.
  draw(ctx, S) {
    const z = this.z, scale = 1 + 0.30 * z;
    ctx.save();
    if (this.bank) ctx.rotate(this.bank * 0.25);
    ctx.scale(scale, scale);

    if (z > 0.03) this._sombra(ctx, S, z);
    this._patas(ctx, S);
    this._body(ctx, S);
    this._proboscis(ctx, S);
    this._wings(ctx, S, true);          // izquierda
    this._wings(ctx, S, false);         // derecha
    this._eyes(ctx, S);
    ctx.restore();
  }

  _sombra(ctx, S, z) {
    ctx.save();
    ctx.globalAlpha = 0.22 * (1 - z * 0.5);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, S * 0.34 * z * 2.4, S * 0.52 * (1 - z * 0.25), S * 0.30 * (1 - z * 0.25), 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  _patas(ctx, S) {
    const tucked = this.z;                       // tucked in while flying
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const p of PATAS) {
      // tripod: half the legs are planted while the other half swing
      const f = (this.gaitPhase + (p.tri ? Math.PI : 0)) % TAU;
      const stance = f < Math.PI;                    // planted for half the phase
      const u = stance ? f / Math.PI : (f - Math.PI) / Math.PI;
      // stance: the foot goes front to back (it pushes). Swing: it snaps forward.
      const t = stance ? u : 1 - u;
      let px = lerp(p.aep[0], p.pep[0], t);
      let py = lerp(p.aep[1], p.pep[1], t);
      const lift = stance ? 0 : Math.sin(u * Math.PI);   // lift the foot on the way back
      // grooming: the front legs rub against the head
      if (this.groom > 0.05 && Math.abs(p.anchor[1] - 0.34) < 0.01) {
        const r = Math.sin(this.groomT / 90) * 0.16;
        px = lerp(px, p.side * 0.30 + r, this.groom);
        py = lerp(py, 0.72 + Math.abs(r), this.groom);
      }
      if (tucked > 0.02) {                        // tucked in while flying
        px = lerp(px, p.anchor[0] * 1.55, tucked);
        py = lerp(py, p.anchor[1] * 0.5 - 0.52, tucked);
      }
      const ax = p.anchor[0] * S, ay = -p.anchor[1] * S;
      const fx = px * S, fy = -(py + lift * 0.10) * S;
      // knee: out and up, the way an insect's is
      const mx = (ax + fx) / 2 + p.side * 0.26 * S;
      const my = (ay + fy) / 2 - 0.20 * S - lift * 0.10 * S;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(mx, my);
      ctx.lineTo(fx, fy);
      ctx.strokeStyle = stance ? 'rgba(58,42,26,.95)' : 'rgba(84,64,42,.78)';
      ctx.lineWidth = Math.max(1.8, S * 0.080);
      ctx.stroke();
      // tarsus: the little foot
      ctx.beginPath();
      ctx.arc(fx, fy, Math.max(0.8, S * 0.030), 0, TAU);
      ctx.fillStyle = 'rgba(40,28,16,.9)'; ctx.fill();
    }
    ctx.restore();
  }

  _wings(ctx, S, back) {
    // The sprite has its BASE at the bottom and the tip at the top. It is anchored
    // by the base on the thorax and opens backwards, hence the PI rotation.
    const wing = this.sp.wing;
    const side = back ? -1 : 1;                 // left behind, right in front
    const open = this.wingsOpen;
    const rest = 0.13;                          // folded flat along the abdomen
    const mid = 0.68;                           // swept out, but never past the head
    const sweep = Math.sin(this.beatPhase) * 0.32;
    // even at rest a fly twitches its wings: a slow tremor plus the odd flick
    const idle = Math.sin(this.beatPhase * 0.11) * 0.05 + this.flick * 0.55;
    const ang = side * (lerp(rest, mid, open) + sweep * open + idle * (1 - open));
    const copies = open > 0.35 ? 3 : 1;        // blur: they beat at ~200 Hz
    const h = S * 1.62, w = h * 0.32;           // real wings reach past the abdomen
    ctx.save();
    ctx.translate(side * S * 0.13, -S * 0.10);    // hinge on the rear thorax
    for (let c = 0; c < copies; c++) {
      const d = (c - (copies - 1) / 2) * 0.30 * open * side;
      ctx.save();
      ctx.rotate(Math.PI - (ang + d));            // PI: base at origin, tip pointing back
      ctx.globalAlpha = (copies === 1 ? lerp(0.34, 0.58, open) : 0.22) * (back ? 0.9 : 1);
      if (wing?.complete && wing.naturalWidth) ctx.drawImage(wing, -w / 2, -h, w, h);
      else { ctx.fillStyle = '#c9d6ea'; ctx.beginPath();
             ctx.ellipse(0, -h / 2, w * 0.5, h * 0.5, 0, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
    ctx.restore();
  }

  _body(ctx, S) {
    const im = this.sp.body;
    if (im?.complete && im.naturalWidth) {
      const h = S * 2.25, w = h * im.width / im.height;
      ctx.drawImage(im, -w / 2, -h * 0.52, w, h);
    } else {
      ctx.fillStyle = '#3b465f';
      ctx.beginPath(); ctx.ellipse(0, S * 0.42, S * 0.42, S * 0.68, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, -S * 0.16, S * 0.40, S * 0.44, 0, 0, TAU); ctx.fill();
    }
  }

  _proboscis(ctx, S) {
    if (this.proboscis < 0.02) return;
    const L = this.proboscis * 0.62 * S, y0 = -S * 0.78;
    ctx.save();
    ctx.strokeStyle = 'rgba(198,132,64,.95)';
    ctx.lineWidth = Math.max(1.8, S * 0.10); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(0, y0 - L); ctx.stroke();
    // labellum: the two lobes it sucks with
    const r = S * 0.085 * (0.7 + 0.6 * this.proboscis);
    ctx.fillStyle = 'rgba(226,166,96,.95)';
    for (const sx of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(sx * r * 0.75, y0 - L, r, r * 0.78, 0, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  _eyes(ctx, S) {
    // a fly's eyes do not move; what changes is the glint
    const b = 0.45 + 0.25 * Math.sin(this.glint);
    ctx.save();
    ctx.globalAlpha = b;
    ctx.fillStyle = '#fff';
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * S * 0.30, -S * 0.66, S * 0.075, S * 0.055, sx * 0.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

// The sugar drop that falls when you feed it from the panel.
class SugarDrop {
  constructor(W, H, img) {
    this.x = W / 2; this.y = -20; this.alive = true;
    this.target = H * 0.50 - 54; this.img = img; this.r = 15; this.pulse = 0;
  }
  paso(ctx) {
    if (!this.alive) {                       // already landed: pulses slowly
      this.pulse += 0.06; this._pintar(ctx, 1 + 0.05 * Math.sin(this.pulse)); return false;
    }
    this.y += Math.max(1.8, (this.target - this.y) * 0.13);
    this._pintar(ctx, 1);
    if (this.y >= this.target - 1) this.alive = false;
    return true;
  }
  _pintar(ctx, k) {
    const r = this.r * k;
    if (this.img?.complete && this.img.naturalWidth) {
      const w = r * 2.2, h = w * this.img.height / this.img.width;
      ctx.drawImage(this.img, this.x - w / 2, this.y - h / 2, w, h);
    } else {
      ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.arc(this.x, this.y, r * 0.55, 0, TAU); ctx.fill();
    }
  }
}


// ---------- js/overlay-core.js ----------
// Overlay core. It uses NO import() and NO Worker: a page's CSP blocks both
// when this runs as a content script. The simulation runs on the main thread
// (20 ms of CPU per 1000 ms simulated: ~2% of one core).
// Depends on FlyCircuit, mutationFromSeed and Fly, which the bundle inlines first.
(async () => {
  if (window.__moscaSuelta) return;
  window.__moscaSuelta = true;

  const url = p => chrome.runtime.getURL(p);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483600;pointer-events:none';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  root.appendChild(cv);
  const ctx = cv.getContext('2d');
  const dim = () => {
    const d = devicePixelRatio || 1;
    cv.width = innerWidth * d; cv.height = innerHeight * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
  };
  dim(); addEventListener('resize', dim);

  const circuit = await (await fetch(url('data/circuit.json'))).json();

  const { semilla } = await chrome.storage.local.get('semilla');
  const silenced = await mutationFromSeed(semilla || 'demo', circuit.pool, 40);

  const c = new FlyCircuit(circuit, { seed: (Date.now() & 0xffff) || 1 });
  if (silenced.length) c.silence(silenced);
  let drive = 0, mn9Hz = 0, activity = 0;

  const sp = {};
  for (const n of ['body', 'wing']) {
    const i = new Image(); i.src = url(`assets/${n}.png`); sp[n] = i;
  }
  const fly = new Fly(sp);
  let flyAmt = 0, startleT = 0;
  let x = innerWidth * 0.72, y = innerHeight * 0.3, th = -Math.PI / 2;
  let target = newTarget(), pause = 0, S = 46, near = false;
  function newTarget() {
    return { x: 70 + Math.random() * (innerWidth - 140), y: 70 + Math.random() * (innerHeight - 140) };
  }

  let anterior = performance.now(), accMn9 = 0, accMs = 0;
  function loop() {
    const now = performance.now();
    let ms = Math.min(now - anterior, 100);   // if the tab slept, don't pile up time
    anterior = now;

    // The neurons only run while the tab is visible — no point burning CPU on a
    // tab nobody is looking at. Drawing always happens, though: gating the draw
    // too made the fly vanish in any context that reports "hidden" while the
    // user can still see the page.
    if (document.visibilityState === 'visible') {
      const steps = Math.round(ms / c.dt);
      let mn9 = 0, firing = 0;
      for (let s = 0; s < steps; s++) {
        const spk = c.step(drive);
        firing += spk.length;
        for (const i of spk) if (i === c.mn9) mn9++;
      }
      accMn9 += mn9; accMs += ms;
      if (accMs > 250) { mn9Hz = accMn9 / (accMs / 1000); accMn9 = 0; accMs = 0; }
      activity = Math.min(1, firing / Math.max(1, steps) / 3);
    } else {
      ms = 0;                       // freeze the animation, but keep drawing it
    }

    // --- paseo ---
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const speed = pause > 0 ? 0 : 0.35 + activity * 1.6;
    if (pause > 0) pause--;
    const dx = target.x - x, dy = target.y - y;
    if (Math.hypot(dx, dy) < 16) { target = newTarget(); pause = 40 + Math.random() * 120; }
    else {
      const want = Math.atan2(dy, dx);
      const diff = ((want - th + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      th += Math.max(-0.06, Math.min(0.06, diff));
      x += Math.cos(th) * speed; y += Math.sin(th) * speed;
    }
    if (near) {
      ctx.beginPath(); ctx.arc(x, y, S * 1.25, 0, 7);
      ctx.strokeStyle = 'rgba(255,209,102,.55)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // the startle decays on its own; while it lasts, it flies
    if (startleT > 0) { startleT -= ms; flyAmt = Math.min(1, flyAmt + ms / 220); }
    else flyAmt = Math.max(0, flyAmt - ms / 650);
    if (flyAmt > 0.02) { x += Math.cos(th) * flyAmt * 2.6; y += Math.sin(th) * flyAmt * 2.6; }

    fly.update(ms, {
      walk: pause > 0 ? 0 : Math.min(1, 0.25 + activity),
      eat: Math.min(1, mn9Hz / 45),
      fly: flyAmt,
      turn: 0,
    });
    ctx.save();
    ctx.translate(x, y); ctx.rotate(th + Math.PI / 2);
    fly.draw(ctx, S);
    ctx.restore();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  let mx = 0, my = 0, mt = 0;
  addEventListener('mousemove', ev => {
    const d = Math.hypot(ev.clientX - x, ev.clientY - y);
    near = d <= S * 1.6;
    const now = performance.now(), dt = now - mt;
    if (mt && dt > 0 && dt < 120) {
      const prev = Math.hypot(mx - x, my - y);
      const closing = (prev - d) / dt;        // px/ms of approach
      // an object looming at you: that is what triggers the escape response
      if (d < S * 5 && closing > 1.1) { startleT = 900; th += (Math.random() - .5) * 1.2; pause = 0; }
    }
    mx = ev.clientX; my = ev.clientY; mt = now;
  });
  addEventListener('click', ev => {
    if (Math.hypot(ev.clientX - x, ev.clientY - y) > S * 1.3) return;
    drive = circuit.params.r_poi; pause = 160;
    document.dispatchEvent(new CustomEvent('fly:come', { detail: { x, y } }));
    chrome.storage.local.set({ ultima_comida: Date.now() });
    setTimeout(() => {
      drive = 0;
      document.dispatchEvent(new CustomEvent('fly:saciada'));
    }, 2500);
  }, true);

  chrome.runtime.onMessage.addListener(m => {
    if (m === 'recoger') { host.remove(); window.__moscaSuelta = false; }
  });
})();
