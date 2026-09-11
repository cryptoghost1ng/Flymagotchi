"""Arena sobre el conectoma MACHO (male-CNS v1.0): carreras, no comida.

Mando: DNa01 (izq+der) es la descendente de caminar hacia delante.
Lectura: 500 motoneuronas de pata del cordon nervioso ventral (T1/T2/T3),
         separadas por lado. Velocidad = disparo total. Giro = asimetria I/D.
"""
import os
# Where the working tree lives (connectome data, results). Override with FLY_HOME.
BASE = os.path.expanduser(os.environ.get('FLY_HOME', '~/fly-arena'))
import sys, os, time, hashlib
VENDOR = BASE + '/vendor/Drosophila_brain_model'
sys.path.insert(0, VENDOR)
import numpy as np, pandas as pd
import brian2
from brian2 import ms, mV, Hz, Network
import model as M

brian2.prefs.logging.console_log_level = 'ERROR'
D = BASE + '/data/male-cns'
PATH_COMP = f'{D}/male_completeness.csv'
PATH_CON  = f'{D}/male_connectivity.parquet'

def load_groups():
    a = pd.read_feather(f'{D}/annotations.feather')
    g = {}
    for t in ('DNa01', 'DNa02', 'DNp09'):
        s = a[a.type == t]
        g[t] = {'L': [int(x) for x in s[s.somaSide == 'L'].bodyId],
                'R': [int(x) for x in s[s.somaSide == 'R'].bodyId]}
    # OJO: filtrar por somaNeuromere T1/T2/T3 mete ala (wm), cuello (nm) y
    # balancin (hm). Las patas de verdad son subclass fl/ml/hl.
    legs = a[(a.superclass == 'vnc_motor') & (a.subclass.isin(['fl', 'ml', 'hl']))]
    g['leg'] = {'L': [int(x) for x in legs[legs.somaSide == 'L'].bodyId],
                'R': [int(x) for x in legs[legs.somaSide == 'R'].bodyId]}
    # SEIS patas: fl=delantera, ml=media, hl=trasera, por lado.
    # Cada pata tiene su propio grupo de motoneuronas reales.
    six = a[(a.superclass == 'vnc_motor') & (a.subclass.isin(['fl', 'ml', 'hl']))]
    g['six'] = {}
    for sub, nom in (('fl', 'delantera'), ('ml', 'media'), ('hl', 'trasera')):
        for side in ('L', 'R'):
            sel = six[(six.subclass == sub) & (six.somaSide == side)]
            g['six'][f'{sub}{side}'] = [int(x) for x in sel.bodyId]
    return g

class MaleArena:
    def __init__(self, t_run=1000, r_poi=150, verbose=True):
        self.t_run_ms = t_run
        self.params = dict(M.default_params)
        self.params['t_run'] = t_run * ms
        self.params['r_poi'] = r_poi * Hz
        comp = pd.read_csv(PATH_COMP, index_col=0)
        self.flyid2i = {int(j): i for i, j in enumerate(comp.index)}
        self.i2flyid = {i: j for j, i in self.flyid2i.items()}
        self.n_neurons = len(comp)
        self.groups = load_groups()
        t0 = time.time()
        self.neu, self.syn, self.spk_mon = M.create_model(PATH_COMP, PATH_CON, self.params)
        self.n_syn = len(self.syn)
        self._exc_ids = self.groups['DNa01']['L'] + self.groups['DNa01']['R']
        exc = [self.flyid2i[b] for b in self._exc_ids]
        pois, self.neu = M.poi(self.neu, exc, [], self.params)
        self.net = Network(self.neu, self.syn, self.spk_mon, *pois)
        self.net.store('pristine')
        pre = np.asarray(self.syn.i[:])
        order = np.argsort(pre, kind='stable')
        self._order = order
        self._bounds = np.searchsorted(pre[order], np.arange(self.n_neurons + 1))
        if verbose:
            print(f'[macho] {self.n_neurons:,} neuronas, {self.n_syn:,} conexiones '
                  f'({time.time()-t0:.1f}s)', flush=True)
            print(f'[macho] mando: DNa01 x{len(exc)} | patas: '
                  f'{len(self.groups["leg"]["L"])} izq / {len(self.groups["leg"]["R"])} der', flush=True)

    def run(self, silenced=(), seed=0):
        self.net.restore('pristine')
        brian2.seed(seed)
        if silenced:
            idx = [self.flyid2i[f] for f in silenced if f in self.flyid2i]
            if idx:
                pos = np.concatenate([self._order[self._bounds[i]:self._bounds[i+1]] for i in idx])
                if len(pos):
                    w = np.asarray(self.syn.w[:] / mV); w[pos] = 0.0
                    self.syn.w[:] = w * mV
        self.net.run(self.params['t_run'])
        return {k: np.asarray(v / ms) for k, v in self.spk_mon.spike_trains().items() if len(v)}

    def six_legs(self, trains):
        """Spikes por cada una de las seis patas (sus motoneuronas reales)."""
        out = {}
        for k, ids in self.groups['six'].items():
            ii = [self.flyid2i[b] for b in ids if b in self.flyid2i]
            out[k] = np.concatenate([trains[i] for i in ii if i in trains]) if any(
                i in trains for i in ii) else np.array([])
        return out

    def leg_spikes(self, trains):
        out = {}
        for side in ('L', 'R'):
            ii = [self.flyid2i[b] for b in self.groups['leg'][side] if b in self.flyid2i]
            out[side] = sum(len(trains.get(i, ())) for i in ii)
        return out
