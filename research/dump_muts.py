"""Vuelca las mutaciones de prueba como indices del circuito reducido,
para que el test de JS use EXACTAMENTE las mismas neuronas que Brian2."""
import os
# Where the working tree lives (connectome data, results). Override with FLY_HOME.
BASE = os.path.expanduser(os.environ.get('FLY_HOME', '~/fly-arena'))
import sys, json
sys.path.insert(0, BASE + '/src')
import pandas as pd
from arena import mutation_from_seed

bl = json.load(open(BASE + '/results/baseline.json'))
comp = pd.read_csv(BASE + '/data/reducido/comp.csv', index_col=0)
pos = {int(b): i for i, b in enumerate(comp.index)}
out = {'salvaje': []}
for s in ('40-0', '40-2', '40-7'):
    out[s] = sorted(pos[b] for b in mutation_from_seed(bl['pool'], s, 40) if b in pos)
    print(f'{s}: {len(out[s])} indices')
json.dump(out, open(BASE + '/results/test_muts.json', 'w'))
print('[ok] results/test_muts.json')
