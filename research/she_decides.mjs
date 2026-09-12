// Does the fly produce a deterministic, reproducible decision?
// Same circuit, same stimulus, same seed -> the same spike train, and therefore
// the same derived value. Anyone can re-run this and get the same answer.
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { FlyCircuit } from '../js/lif.js';

const data = JSON.parse(readFileSync(new URL('../data/circuit.json', import.meta.url)));

// The decision: MN9 has to fire THRESHOLD times. That is the fly choosing to eat.
const THRESHOLD = 40;
const MAX_MS = 3000;

function run(seed, silenced = []){
  const c = new FlyCircuit(data, { seed });
  if (silenced.length) c.setSilenced(silenced);
  const times = [];
  const steps = Math.round(MAX_MS / c.dt);
  let decidedAt = null;
  for (let s = 0; s < steps; s++){
    for (const i of c.step(data.params.r_poi)){
      if (i === c.mn9){
        times.push(+(s * c.dt).toFixed(1));
        if (times.length === THRESHOLD && decidedAt === null) decidedAt = s * c.dt;
      }
    }
    if (decidedAt !== null) break;
  }
  const train = times.join(',');
  const h = createHash('sha256').update(train).digest('hex');
  const pool = JSON.parse(readFileSync(new URL('./tickers.json', import.meta.url))).list;
  const ticker = '$' + pool[Number(BigInt('0x' + h.slice(0, 12)) % BigInt(pool.length))];
  return { decidedAt, spikes: times.length, hash: h, ticker, train };
}

const a = run(1337), b = run(1337), c = run(9001);
console.log('--- same fly, same stimulus, twice ---');
console.log(`  run 1: decided at ${a.decidedAt} ms | ${a.spikes} MN9 spikes | ${a.hash.slice(0,16)}… | ${a.ticker}`);
console.log(`  run 2: decided at ${b.decidedAt} ms | ${b.spikes} MN9 spikes | ${b.hash.slice(0,16)}… | ${b.ticker}`);
console.log(`  identical: ${a.hash === b.hash && a.decidedAt === b.decidedAt}`);
console.log('--- different noise seed ---');
console.log(`  run 3: decided at ${c.decidedAt} ms | ${c.hash.slice(0,16)}… | ${c.ticker}`);
console.log(`  differs: ${a.hash !== c.hash}`);
console.log('\n--- what a mutated fly decides (a few seeds) ---');
for (const s of ['40-0','40-2','40-7']){
  const m = JSON.parse(readFileSync(new URL('../../results/test_muts.json', import.meta.url)))[s];
  const r = run(1337, m);
  console.log(`  mutation ${s}: ${r.decidedAt === null ? 'never decided (refused to eat)' :
    `decided at ${String(r.decidedAt).padStart(6)} ms | ${r.ticker}`}`);
}
