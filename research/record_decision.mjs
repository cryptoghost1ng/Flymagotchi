// Records the fly's decision for the film. The authoritative run is this one —
// the same JavaScript simulator the website ships, so anyone can reproduce it.
import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { FlyCircuit } from '../js/lif.js';

const data = JSON.parse(readFileSync(new URL('../data/circuit.json', import.meta.url)));
const SEED = Number(process.argv[2] ?? 1337);
const THRESHOLD = 40, MAX_MS = 3000;

const c = new FlyCircuit(data, { seed: SEED });
const events = [];            // [ms, neuronIndex]
const mn9Times = [];
let decidedAt = null;
const steps = Math.round(MAX_MS / c.dt);
for (let s = 0; s < steps; s++){
  const t = +(s * c.dt).toFixed(1);
  for (const i of c.step(data.params.r_poi)){
    events.push([t, i]);
    if (i === c.mn9){
      mn9Times.push(t);
      if (mn9Times.length === THRESHOLD && decidedAt === null) decidedAt = t;
    }
  }
  if (decidedAt !== null) break;
}
const train = mn9Times.join(',');
const hash = createHash('sha256').update(train).digest('hex');
// Her spike timing picks from a list published before the run, so the result is
// always usable AND still hers: the set is fixed, the choice is the circuit's.
const pool = JSON.parse(readFileSync(new URL('./tickers.json', import.meta.url))).list;
const idx = Number(BigInt('0x' + hash.slice(0, 12)) % BigInt(pool.length));
const ticker = '$' + pool[idx];

const out = { seed: SEED, threshold: THRESHOLD, decidedAt, mn9Times, hash, ticker, tickerIndex: idx, poolSize: pool.length,
              events, nEvents: events.length };
writeFileSync(new URL('../../results/decision.json', import.meta.url), JSON.stringify(out));
console.log(`seed ${SEED}`);
console.log(`  decided at ${decidedAt} ms after ${THRESHOLD} MN9 spikes`);
console.log(`  ${events.length.toLocaleString('en')} spikes recorded across the circuit`);
console.log(`  sha256(spike times) = ${hash}`);
console.log(`  ticker = ${ticker}   (index ${idx} of ${pool.length} published candidates)`);
