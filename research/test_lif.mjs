// Calibracion: el LIF en JS contra el mismo circuito en Brian2.
// Usa EXACTAMENTE las mismas neuronas silenciadas (volcadas desde Python).
import { readFileSync } from 'fs';
import { FlyCircuit } from '../extension/js/lif.js';

const data = JSON.parse(readFileSync(new URL('../extension/data/circuito.json', import.meta.url)));
const muts = JSON.parse(readFileSync(new URL('../results/test_muts.json', import.meta.url)));
const REF = { salvaje: 67.3, '40-0': 31.7, '40-2': 88.7, '40-7': 111.7 };   // Brian2, reducido
const MS = 1000, SEMILLAS = [1,2,3,4,5,6,7,8,9,10];

const correr = (sil, semilla) => {
  const c = new FlyCircuit(data, { seed: semilla });
  if (sil.length) c.silence(sil);
  const n = Math.round(MS / c.dt);
  const t0 = Date.now();
  for (let s = 0; s < n; s++) c.step(data.params.r_poi);
  return { hz: c.rate(c.mn9, MS), cpu: Date.now() - t0,
           act: c.spikes.reduce((a, x) => a + (x > 0 ? 1 : 0), 0) };
};

console.log('cond        Brian2      JS  (media +/- sd)      delta     act   cpu');
let peor = 0, cpuTot = 0;
for (const [nom, sil] of Object.entries(muts)) {
  const r = SEMILLAS.map(s => correr(sil, s));
  const hz = r.map(x => x.hz);
  const m = hz.reduce((a, b) => a + b) / hz.length;
  const sd = Math.sqrt(hz.reduce((a, b) => a + (b - m) ** 2, 0) / hz.length);
  const d = m - REF[nom], pc = 100 * d / REF[nom];
  peor = Math.max(peor, Math.abs(pc));
  cpuTot += r.reduce((a, x) => a + x.cpu, 0) / r.length;
  console.log(`${nom.padEnd(9)} ${REF[nom].toFixed(1).padStart(6)}  ` +
    `${m.toFixed(1).padStart(6)} +/- ${sd.toFixed(1).padStart(4)}   ` +
    `${(d >= 0 ? '+' : '') + d.toFixed(1)} Hz (${(pc >= 0 ? '+' : '') + pc.toFixed(1)}%)`.padStart(20) +
    `  ${String(r[0].act).padStart(4)}  ${Math.round(r.reduce((a, x) => a + x.cpu, 0) / r.length)} ms`);
}
console.log(`\ndesvio maximo: ${peor.toFixed(1)}%  |  ` +
  `CPU medio: ${Math.round(cpuTot / 4)} ms por 1000 ms simulados ` +
  `(x${(1000 / (cpuTot / 4)).toFixed(1)} tiempo real)`);
