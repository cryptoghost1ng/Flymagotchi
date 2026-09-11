// Leaky integrate-and-fire simulator for the fly's feeding circuit.
// Same equations and constants as Shiu et al. 2024 (Nature), solved exactly
// (the system is linear), the same way Brian2's method='linear' does.
//
//   dv/dt = (v_0 - v + g) / t_mbr     (congelado en refractario)
//   dg/dt = -g / tau                  (congelado en refractario)
//   spikes if v > v_th  ->  v = v_rst, g = 0, refractory for t_rfc
//   synapse: when the presynaptic neuron fires, g_post += w after a t_dly delay

export class FlyCircuit {
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
