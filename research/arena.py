"""
fly-arena — duelo determinista entre dos conectomas de Drosophila mutados.

Sustrato: conectoma FlyWire v630 (127.400 neuronas, 14.687.178 conexiones)
Motor:    modelo leaky integrate-and-fire de Shiu et al. 2024 (Nature)
Mecánica: se suelta azúcar (se estimulan 21 GRNs de azúcar). La mosca cuya
          neurona motora MN9 (extensión de la probóscide = comer) dispare
          más, gana. Cada mosca lleva una mutación: un conjunto de neuronas
          silenciadas derivado de forma determinista de su semilla.
"""
import os
# Where the working tree lives (connectome data, results). Override with FLY_HOME.
BASE = os.path.expanduser(os.environ.get('FLY_HOME', '~/fly-arena'))
import sys, os, json, hashlib, time
from pathlib import Path

VENDOR = BASE + '/vendor/Drosophila_brain_model'
sys.path.insert(0, VENDOR)

import numpy as np
import pandas as pd
import brian2
from brian2 import ms, mV, Hz, Network
import model as M

brian2.prefs.logging.console_log_level = 'ERROR'

PATH_COMP = os.path.join(VENDOR, '2023_03_23_completeness_630_final.csv')
PATH_CON  = os.path.join(VENDOR, '2023_03_23_connectivity_630_final.parquet')

# 21 neuronas sensoras de azúcar (GRNs), hemisferio derecho — del paper
SUGAR = [720575940624963786, 720575940630233916, 720575940637568838,
         720575940638202345, 720575940617000768, 720575940630797113,
         720575940632889389, 720575940621754367, 720575940621502051,
         720575940640649691, 720575940639332736, 720575940616885538,
         720575940639198653, 720575940620900446, 720575940617937543,
         720575940632425919, 720575940633143833, 720575940612670570,
         720575940628853239, 720575940629176663, 720575940611875570]

# MN9: motoneurona de extensión de la probóscide. Es el "marcador" del duelo.
MN9 = 720575940660219265


class Arena:
    """Construye la red UNA vez y la reutiliza vía store/restore."""

    def __init__(self, t_run=1000, r_poi=100, verbose=True):
        self.t_run_ms = t_run
        self.params = dict(M.default_params)
        self.params['t_run'] = t_run * ms
        self.params['r_poi'] = r_poi * Hz

        comp = pd.read_csv(PATH_COMP, index_col=0)
        self.flyid2i = {j: i for i, j in enumerate(comp.index)}
        self.i2flyid = {i: j for j, i in self.flyid2i.items()}
        self.n_neurons = len(comp)

        t0 = time.time()
        self.neu, self.syn, self.spk_mon = M.create_model(PATH_COMP, PATH_CON, self.params)
        self.n_syn = len(self.syn)
        exc = [self.flyid2i[s] for s in SUGAR]
        pois, self.neu = M.poi(self.neu, exc, [], self.params)
        self.net = Network(self.neu, self.syn, self.spk_mon, *pois)
        self.net.store('pristine')          # estado limpio: pesos intactos
        # indice pre-sinaptico -> posiciones en el array de sinapsis.
        # (el silence() del repo escanea las 14,7M de sinapsis por cada neurona;
        #  esto lo convierte en una indexacion directa)
        self._syn_pre = np.asarray(self.syn.i[:])
        order = np.argsort(self._syn_pre, kind='stable')
        pre_sorted = self._syn_pre[order]
        bounds = np.searchsorted(pre_sorted, np.arange(self.n_neurons + 1))
        self._order, self._bounds = order, bounds
        if verbose:
            print(f'[arena] conectoma cargado: {self.n_neurons:,} neuronas, '
                  f'{self.n_syn:,} sinapsis ({time.time()-t0:.1f}s)')

    def run(self, silenced_flyids=(), seed=0):
        """Una corrida. `silenced_flyids` = mutación. `seed` = azar del Poisson."""
        self.net.restore('pristine')        # recupera pesos y estado
        brian2.seed(seed)                   # determinismo
        if silenced_flyids:
            idx = [self.flyid2i[f] for f in silenced_flyids]
            pos = np.concatenate([self._order[self._bounds[i]:self._bounds[i + 1]]
                                  for i in idx]) if idx else np.array([], dtype=int)
            if len(pos):
                w = np.asarray(self.syn.w[:] / mV)
                w[pos] = 0.0
                self.syn.w[:] = w * mV
        self.net.run(self.params['t_run'])
        trains = {k: np.asarray(v / ms) for k, v in self.spk_mon.spike_trains().items() if len(v)}
        return trains

    # --- helpers de lectura -------------------------------------------------
    def rate(self, trains, flyid):
        i = self.flyid2i[flyid]
        return len(trains.get(i, ())) / (self.t_run_ms / 1000.0)

    def to_flyids(self, trains):
        return {self.i2flyid[i]: t for i, t in trains.items()}


def mutation_from_seed(pool, seed, k):
    """Mutación determinista: de una semilla (p.ej. hash de un token) salen
    k neuronas del pool. Misma semilla -> misma mosca, siempre."""
    h = hashlib.sha256(str(seed).encode()).digest()
    rng = np.random.default_rng(int.from_bytes(h[:8], 'big'))
    return sorted(rng.choice(np.asarray(pool), size=k, replace=False).tolist())
