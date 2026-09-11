# research

The pipeline that produced `data/circuit.json` and validated it. Not needed to run the
extension — it is here so the claims in the main README can be checked.

It needs the connectome data, which is not in this repo (it is gigabytes):

```bash
git clone --depth 1 https://github.com/philshiu/Drosophila_brain_model vendor/
pip install brian2 numpy pandas pyarrow networkx
```

| script | what it does |
|---|---|
| `arena.py` | loads FlyWire v630 into the Shiu et al. LIF model; stimulate and silence |
| `step9_reducido.py` | extracts the 448-neuron feeding circuit and **verifies** it reproduces the full 127,400-neuron model |
| `step10_exportar.py` | writes `data/circuit.json` |
| `dump_muts.py` + `test_lif.mjs` | calibrates the JavaScript simulator against Brian2 (max deviation 4.7%) |
| `arena_male.py` | the male CNS connectome (166,700 neurons): walking, escape and flight circuits. Not used by the extension yet. |
| `gen_visual.py`, `gen_fly_sprite_openai.py` | generate the artwork |

Paths are resolved from `FLY_HOME`, which defaults to `~/fly-arena`. Point it wherever
you keep the connectome data:

```bash
FLY_HOME=/path/to/workdir python research/step9_reducido.py
```
