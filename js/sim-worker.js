// The simulation runs here, off the UI thread.
import { FlyCircuit } from './lif.js';

let c = null, datos = null, corriendo = false, drive = 0;
const PASO_MS = 50;          // every 50 ms of wall clock we simulate 50 ms of fly

self.onmessage = async (e) => {
  const m = e.data;
  if (m.tipo === 'init') {
    datos = m.datos;
    c = new FlyCircuit(datos);
    if (m.silenciadas?.length) c.silence(m.silenciadas);
    self.postMessage({ tipo: 'listo', n: datos.ids.length, sinapsis: datos.pre.length });
    if (!corriendo) { corriendo = true; bucle(); }
  } else if (m.tipo === 'drive') {
    drive = m.valor;
  } else if (m.tipo === 'silenciar') {
    c.setSilenced(m.indices);
    self.postMessage({ tipo: 'silencio', n: m.indices.length });
  } else if (m.tipo === 'ficha') {
    // data for a single neuron, for the inspector panel
    self.postMessage({ tipo: 'ficha', i: m.i, signo: c.signo(m.i),
                       grado: c.grado[m.i], spikes: c.spikes[m.i],
                       silenciada: c.silenciadas.has(m.i) });
  }
};

function bucle() {
  let anterior = performance.now();
  const tick = () => {
    if (!corriendo) return;
    const ahora = performance.now();
    let ms = Math.min(ahora - anterior, 200);   // if the tab went to sleep, don't pile up simulation time
    anterior = ahora;
    const pasos = Math.round(ms / c.dt);
    const disparos = new Uint8Array(c.n);
    let mn9 = 0, exc = 0, inh = 0;
    for (let s = 0; s < pasos; s++) {
      const spk = c.step(drive);
      for (const i of spk) {
        disparos[i] = 1;
        if (i === c.mn9) mn9++;
        // the sign of its outgoing synapses says excitatory or inhibitory
        const e0 = c.rowStart[i];
        if (e0 < c.rowStart[i + 1]) (c.colW[e0] >= 0 ? exc++ : inh++);
      }
    }
    self.postMessage({ tipo: 'frame', disparos, mn9, exc, inh, ms });
    setTimeout(tick, PASO_MS);
  };
  tick();
}
