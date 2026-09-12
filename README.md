# Flymagotchi

**A living fruit fly in your browser.** Feed it, and its real feeding circuit fires —
448 neurons and 20,901 synapses traced from an actual *Drosophila melanogaster* brain
by electron microscopy.

When you see the proboscis come out, that is not an animation playing. It is **MN9**, the
motor neuron that extends the proboscis, firing at that instant. If you silence the wrong
neuron, the proboscis stops coming out, because you broke the pathway that drives it.

---

## Quick start

Not on the Chrome Web Store yet. To run it:

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick this folder.
3. Click the fly icon in the toolbar.

It installs asking for **zero browsing permissions**. The fly lives in the side panel.
If you want it walking over the pages you read, the *Let it out on the web* button asks
for that permission at the moment you press it, and *Bring it back* revokes it.

---

## How to use it

### Feed it
Press **Give it sugar**. A sugar drop falls, and 21 sugar-sensing neurons get stimulated
at 100 Hz. Watch the cascade cross the circuit and reach MN9. Hunger drops by roughly a
quarter of the bar per meal.

### Let it get hungry
Hunger rises with the wall clock, even with the browser closed: **full to starving in
4 hours**. The panel shows the exact percentage and how long ago it last ate, so you can
tell the clock is running. This part is a game variable, not biology.

### Let it out
Press **Let it out on the web** and it walks across whatever page you are reading. Move
your pointer at it slowly and nothing happens. Move it **fast, straight at the fly**, and
it bolts. That is a looming stimulus — the thing a real fly's escape circuit exists for.

### Break its brain (the interesting part)
The bottom panel is its circuit, one dot per neuron. Hover to highlight, **click to
silence**. You get the neuron's FlyWire ID, whether it is excitatory or inhibitory, and
how many outgoing connections it has. The MN9 trace below shows what your edit did over
the last 20 seconds. *Give it its neurons back* undoes everything.

This is the same manipulation the original paper performs. You are running the experiment.

---

## What is actually real, and what is not

This matters more than anything else here, so it goes before the fun parts.

**Real — computed live, from the connectome:**

- The **448 neurons** and **20,901 synapses**, extracted from FlyWire v630
  (127,400 neurons, 14,687,178 synapses).
- The **leaky integrate-and-fire model** of Shiu et al. 2024, equations and constants
  unchanged.
- **MN9 in Hz** — the urge to eat.
- The **proboscis** extending: it unfolds when MN9 fires.
- The **excitatory / inhibitory** split among firing neurons.
- **Your mutation**: 40 neurons silenced, derived from a seed unique to your install.
  Your fly eats differently from mine, and the difference is measurable.

**Not real — game or decoration:**

- The **hunger clock**. A number that grows with time.
- The **tripod gait, the wingbeat and the startle flight**. Good animation, but animation.
  The feeding circuit contains no leg or wing motor neurons — those live in the ventral
  nerve cord, a different dataset. Walking speed *is* modulated by real network activity,
  but the walking itself is drawn, not simulated.
- The **images** (body, wing, sugar drop, icon) are generated with an image model. They
  are illustration, not micrographs.

---

## The brain you are looking at

### What a connectome is

A connectome is a wiring diagram: every neuron, and every synapse between them. For the
adult fruit fly this took a decade — the brain was sliced into 7,050 sections, imaged by
electron microscope, and every neuron traced through the stack by a mix of machine
learning and human proofreading. The result, FlyWire, is the first complete wiring diagram
of an adult animal brain. **127,400 neurons. 14,687,178 synapses.** All of it public.

A wiring diagram is not a working brain, though. It tells you who talks to whom, not what
they say. To get behaviour out of it you need a model of what each neuron does.

### The model

Each neuron here is a **leaky integrate-and-fire** unit — about the simplest useful neuron
model there is. It holds a voltage. Input pushes the voltage up. Left alone, the voltage
leaks back down toward rest. Cross a threshold and it fires, dumps its charge, and goes
briefly deaf (the refractory period). That is the whole thing:

```
dv/dt = (v_rest - v + g) / 20 ms      membrane voltage, leaking back to -52 mV
dg/dt = -g / 5 ms                     synaptic input, decaying
fire when v > -45 mV                  then reset to -52 mV, deaf for 2.2 ms
```

Every synapse carries a weight set by how many contacts the two neurons actually make in
the electron microscopy, and a sign: **acetylcholine excites, GABA and glutamate inhibit**.
That sign is a prediction from the synapse's appearance, not a measurement, and it is one
of the model's softer assumptions.

Nothing here is trained or tuned to produce behaviour. The wiring is what it is.

### Why 448 neurons and not 127,400

Because when you put sugar on the fly's mouthparts, **only 448 neurons ever fire**. The
other 127,000 sit at rest, and a neuron at rest sends no current to anyone. So you can
throw them away without changing the answer.

That is a claim, so it was tested. Full model versus reduced model, four conditions,
three random seeds each:

| | Full | Reduced |
|---|---|---|
| unmutated | 68.0 Hz | 67.3 Hz |
| mutant A | 34.7 Hz | 31.7 Hz |
| mutant B | 94.0 Hz | 88.7 Hz |
| mutant C | 115.3 Hz | 111.7 Hz |

All within 2σ of the model's own noise, and the ranking between mutants is preserved.
There is a consistent bias: the reduced circuit runs about 4% quieter.

**0.35% of the neurons and 0.14% of the synapses** are enough — and that fits in a
browser: **20 ms of CPU per 1000 ms simulated**, roughly 50× faster than real time,
about 3% of one core. The JavaScript simulator was calibrated against the original
Brian2 model and agrees to within 4.7% across four conditions and ten seeds.

### The circuit itself

**Input — 21 sugar-sensing neurons.** Gustatory receptor neurons in the labellum, the
fly's mouthpart. They are the green dots. Sugar lands, they fire, and that is the only
thing entering this circuit.

**Output — MN9.** One motor neuron, the gold dot. It drives the muscle that extends the
proboscis. Firing MN9 is the fly deciding to eat. Neuroscientists have used this reflex
for a century as a readout of whether a fly finds something tasty; it has a name, the
**proboscis extension response**.

**In between — about 400 interneurons.** This is where it gets interesting. Roughly a
third of them are **inhibitory**: they exist to stop the fly eating. A brain that only
knew how to say yes would eat until it died, so most of the machinery between "this is
sugar" and "extend the proboscis" is machinery for saying no, or not yet, or not this
much.

That single fact is why this is a game and not a demo.

### Why your fly is different from mine

On install you get a random seed. The seed picks **40 neurons to silence** — their
outgoing synapses are set to zero, the computational equivalent of the optogenetic
silencing the paper uses. Same seed, same fly, forever.

Now: those 40 are drawn from a circuit that is roughly a third inhibitory. So sometimes
you knock out neurons that were pushing MN9, and your fly is a poor eater. And sometimes
you knock out neurons that were **holding MN9 back**, and your fly eats *better than a
normal one*.

Over eight consecutive unselected seeds, measured:

- **2 flies ate more than wild type** (up to +37.6 Hz over the 70 Hz baseline)
- **3 ate less** (down to −34.8 Hz)
- **3 were indistinguishable**

Nobody designed that distribution. A rarity curve of about 25% buffs falls out of the
fact that real brains are full of brakes. That is the part worth staring at.

---

## Experiments worth trying

1. **Find a brake.** Click neurons one at a time while feeding it. Most do nothing. A few
   drop MN9 hard — those were carrying the signal. And a few make MN9 *go up* — you just
   removed an inhibitory neuron. Those are the interesting ones.
2. **Kill the input.** Silence the green dots one by one. How many sugar sensors can you
   remove before it stops eating? The answer is more than you would guess; the circuit is
   redundant.
3. **Find the bottleneck.** Is there a single neuron that stops feeding entirely? Look at
   neurons with a high outgoing count in the middle of the graph.
4. **Compare the two flavours of damage.** Silence an excitatory neuron, note the MN9
   trace, hit reset, then silence an inhibitory one. They fail in opposite directions.
5. **Let it starve.** Leave it four hours and come back. Then feed it and watch the trace.

A note on the layout: the dots are placed by a force-directed graph layout over the real
synapses. **It is not anatomy.** Neurons sit near the ones they talk to, not where they
live in the head.

---

## How it is built

```
data/circuit.json     the exported circuit (448 neurons, 20,901 synapses)
js/lif.js             the simulator: exact solution of the linear system
js/sim-worker.js      runs the simulation off the UI thread
js/mutacion.js        seed -> deterministic mutation
js/fly-draw.js        body, legs, wings, proboscis
js/panel.js           the side panel and the neuron lab
js/overlay-core.js    the fly loose on the page (closed shadow DOM)
js/overlay.bundle.js  generated: one classic script, no import() and no Worker,
                      because a page's CSP blocks both in a content script
```

The bundle is built by `tools/build_overlay.py`, which also verifies that no module syntax
survived and that every import in the project resolves.

`research/` holds the Python pipeline that extracted the circuit and validated it against
the full model — see `research/README.md`.

---

## The token

**Live.** `$PECK` on Robinhood Chain, quoted in tokenised GOOGL.
Contract `0xDd2Ac97f76F0882Eea826cC7009CfB8A9B4e27F6`.

The fly picks the ticker, and she picks it by getting hungry. Sugar goes on her
mouthparts and the clock starts. When MN9 — the motor neuron that extends the proboscis —
has fired 40 times, that is a fly deciding to eat. The exact timing of those 40 spikes,
to a tenth of a millisecond, is hashed, and the first characters of the hash become the
ticker.

Nobody picks it, and nobody can quietly re-roll it, because **the seed is committed in
public before the run**. Check it yourself:

```bash
git clone https://github.com/cryptoghost1ng/Flymagotchi
node research/she_decides.mjs <seed>
```

Same fly, same sugar, same seed, same four letters. Forever. The website runs the same
simulator, so you can also do it without cloning anything.

| | |
|---|---|
| Chain | Robinhood Chain, quoted in tokenised GOOGL |
| Contract | `0xDd2Ac97f76F0882Eea826cC7009CfB8A9B4e27F6` |
| Committed seed | `3579080452` — the first 8 hex of commit `d5546f0`, the commit that published the candidate list |
| Decided at | 531.1 ms, after 40 MN9 spikes |
| Ticker | `$PECK` — index 38 of the 98 candidates |

The pairing is not arbitrary either: the connectome this runs on was reconstructed by
Google Research together with HHMI Janelia. The brain inside the token was mapped by
Google, so it is quoted in Google.

**The honest split.** She decides *when*, and the exact timing that becomes the ticker.
Everything else is a rig: the name, the supply, the liquidity and the transaction are ours.
She has no idea any of this exists — she is 448 neurons that know how to want sugar.

## Credits and licences

This would not exist without other people's work, and that work is open. Cite it:

- **FlyWire connectome** — Dorkenwald et al., *Neuronal wiring diagram of an adult brain*,
  Nature 2024. CC-BY 4.0.
- **The LIF model** — Shiu et al., *A leaky integrate-and-fire computational model based on
  the connectome of the entire adult Drosophila brain*, Nature 2024.
  Original code: https://github.com/philshiu/Drosophila_brain_model

Extension code is MIT. The connectome data keeps its CC-BY 4.0 licence.

---

## Honest limitations

The LIF model is a coarse approximation. **No neuromodulators** — no dopamine, no
octopamine, none of the chemistry that sets an animal's state. **No gap junctions.**
**No plasticity**: this fly cannot learn, and never will. Synapse signs are predicted,
not measured. And the connectome is one individual fly, dead, at one moment.

It reproduces sensorimotor responses. **It is not a fly**, and it is not alive in any
sense a biologist would accept. It is a real circuit, simulated with a simple model of
neurons, and that is already quite a lot.
