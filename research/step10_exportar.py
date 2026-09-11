
import os
# Where the working tree lives (connectome data, results). Override with FLY_HOME.
BASE = os.path.expanduser(os.environ.get('FLY_HOME', '~/fly-arena'))
"""Exporta el circuito reducido a un formato que pueda leer el navegador."""
import sys, json
sys.path.insert(0, BASE + '/src')
import numpy as np, pandas as pd

OUT = BASE + '/data/reducido'
WEB = BASE + '/extension/data'
import os; os.makedirs(WEB, exist_ok=True)
sys.path.insert(0, BASE + '/src')
from arena import SUGAR, MN9

comp = pd.read_csv(f'{OUT}/comp.csv', index_col=0)
con = pd.read_parquet(f'{OUT}/con.parquet')
ids = [int(x) for x in comp.index]
pos = {b: i for i, b in enumerate(ids)}

# parametros del modelo LIF (Shiu et al. 2024) - los mismos, sin tocar
params = {'v_0': -52.0, 'v_rst': -52.0, 'v_th': -45.0, 't_mbr': 20.0,
          'tau': 5.0, 't_rfc': 2.2, 't_dly': 1.8, 'w_syn': 0.275,
          'r_poi': 100.0, 'f_poi': 250}

layout = np.load(BASE + '/results/layout.npz')
lut = {int(n): (float(x), float(y)) for n, (x, y) in zip(layout['nodes'], layout['xy'])}
rng = np.random.default_rng(11)
xy = [lut.get(b, (float(rng.uniform(-1, 1)), float(rng.uniform(-1, 1)))) for b in ids]

datos = {
    'meta': {
        'fuente': 'FlyWire v630 + modelo LIF de Shiu et al. 2024 (Nature)',
        'completo': {'neuronas': 127400, 'sinapsis': 14687178},
        'reducido': {'neuronas': len(ids), 'sinapsis': int(len(con))},
        'nota': ('Circuito de alimentacion extraido del conectoma completo: toda '
                 'neurona que dispara bajo estimulo de azucar. El resto del cerebro '
                 'permanece en reposo y no aporta corriente.'),
    },
    'params': params,
    'ids': ids,
    'xy': [[round(a, 4), round(b, 4)] for a, b in xy],
    'sugar': [pos[b] for b in SUGAR if b in pos],
    # neuronas mutables: las del pool activo, sin el estimulo ni el marcador
    'pool': [pos[b] for b in json.load(open(
        BASE + '/results/baseline.json'))['pool'] if b in pos],
    'mn9': pos[MN9],
    'pre': [int(x) for x in con.Presynaptic_Index.values],
    'post': [int(x) for x in con.Postsynaptic_Index.values],
    'w': [float(x) for x in (con['Excitatory x Connectivity'].values * params['w_syn'])],
}
p = f'{WEB}/circuito.json'
json.dump(datos, open(p, 'w'), separators=(',', ':'))
print(f'[ok] {p}  {os.path.getsize(p)/1024:.0f} KB')
print(f'     {len(ids)} neuronas, {len(con):,} sinapsis, '
      f'{len(datos["sugar"])} GRNs de azucar, MN9 en indice {datos["mn9"]}')
