"""Paso 9: ¿se puede meter el circuito en un navegador?

Tesis: en el modelo completo solo disparan ~386 de 127.400 neuronas. Una
neurona que nunca dispara no manda nada, asi que recortar el modelo a las que
disparan deberia conservar la dinamica. Esto lo comprueba, no lo asume.
"""
import os
# Where the working tree lives (connectome data, results). Override with FLY_HOME.
BASE = os.path.expanduser(os.environ.get('FLY_HOME', '~/fly-arena'))
import sys, json, time, hashlib, os
sys.path.insert(0, BASE + '/src')
import numpy as np, pandas as pd
from arena import Arena, mutation_from_seed, SUGAR, MN9, PATH_COMP, PATH_CON

OUT = BASE + '/data/reducido'
os.makedirs(OUT, exist_ok=True)
bl = json.load(open(BASE + '/results/baseline.json'))
pool = bl['pool']
SEEDS = [0, 1, 2]
MUTS = {'salvaje': [], '40-0': mutation_from_seed(pool, '40-0', 40),
        '40-2': mutation_from_seed(pool, '40-2', 40), '40-7': mutation_from_seed(pool, '40-7', 40)}

full = Arena(t_run=1000, r_poi=100)

# --- 1. nucleo: TODA neurona que dispare alguna vez, en cualquier condicion --
t0 = time.time()
nucleo, ref = set(), {}
for nom, mut in MUTS.items():
    rates = []
    for s in SEEDS:
        tr = full.run(mut, seed=s)
        nucleo |= set(tr.keys())
        rates.append(full.rate(tr, MN9))
    ref[nom] = (float(np.mean(rates)), float(np.std(rates)))
    print(f'[completo] {nom:8s} MN9 = {ref[nom][0]:6.1f} +/- {ref[nom][1]:4.1f} Hz', flush=True)

nucleo |= {full.flyid2i[b] for b in SUGAR} | {full.flyid2i[MN9]}
ids = sorted(full.i2flyid[i] for i in nucleo)
print(f'\n[nucleo] {len(ids)} neuronas de {full.n_neurons:,} '
      f'({100*len(ids)/full.n_neurons:.3f}%)', flush=True)

# --- 2. recortar el conectoma a ese nucleo -------------------------------
con = pd.read_parquet(PATH_CON)
idset = set(ids)
sub = con[con.Presynaptic_ID.isin(idset) & con.Postsynaptic_ID.isin(idset)].copy()
pos = {b: i for i, b in enumerate(ids)}
sub['Presynaptic_Index'] = sub.Presynaptic_ID.map(pos).astype(np.int32)
sub['Postsynaptic_Index'] = sub.Postsynaptic_ID.map(pos).astype(np.int32)
pd.DataFrame({'Completed': True}, index=pd.Index(ids, name='id')).to_csv(f'{OUT}/comp.csv')
sub.to_parquet(f'{OUT}/con.parquet')
print(f'[nucleo] {len(sub):,} sinapsis internas (de {len(con):,} totales) '
      f'-> {100*len(sub)/len(con):.3f}%', flush=True)

# --- 3. mismo modelo, solo que pequeno -----------------------------------
import arena as A
A.PATH_COMP, A.PATH_CON = f'{OUT}/comp.csv', f'{OUT}/con.parquet'
red = Arena(t_run=1000, r_poi=100)

print('\n--- comparacion completo vs reducido ---', flush=True)
ok = True
for nom, mut in MUTS.items():
    mut_r = [m for m in mut if m in red.flyid2i]
    rates = [red.rate(red.run(mut_r, seed=s), MN9) for s in SEEDS]
    m, sd = float(np.mean(rates)), float(np.std(rates))
    d = m - ref[nom][0]
    bien = abs(d) <= 2 * max(ref[nom][1], 1.0)
    ok &= bien
    print(f'  {nom:8s} completo={ref[nom][0]:6.1f} Hz   reducido={m:6.1f} Hz   '
          f'delta={d:+5.1f} Hz   [{"OK" if bien else "DISCREPA"}]', flush=True)

print(f'\n[veredicto] {"el circuito reducido reproduce el completo" if ok else "NO reproduce: hay que replantear"}')
print(f'[tamano] {len(ids)} neuronas / {len(sub):,} sinapsis -> cabe de sobra en un navegador')
print(f'[tiempo] {time.time()-t0:.0f}s')
json.dump({'ids': ids, 'n_syn': int(len(sub)), 'ref': ref, 'ok': bool(ok)},
          open(BASE + '/results/reducido.json', 'w'))
