# burbur

**Living aerial-view worlds, entirely procedural, in the browser.**
Six little worlds that breathe — a forest, a lagoon, a city, a cell, a fungal
colony and a cortical network — each with its own day, weather, fauna, events
and synthesized soundscape. Nothing is a pre-made model or texture: every blade
of grass, every ripple, every call and every drone is generated from math at
runtime.

▶ **Live:** https://burbur.cl · Tap the breathing seed to enter.

> **A homage, not a copy.** burbur is an independent, open-source tribute to the
> feeling of [murmur.living](https://murmur.living). It is **not affiliated with
> murmur** and contains **none of its code or assets** — everything here was
> written from scratch. The name, the six worlds, the Chilean fauna, the cell /
> fungus / neuron worlds and all the sound are original to this project.

---

## The six worlds

| | World | What lives there |
|---|---|---|
| 🔺 | **Bosque** (forest) | Chilean sclerophyll: zorzal, chincol, zorro, degú, a stream, horseflies |
| 💧 | **Laguna** (lagoon) | Wetland: herons that dive for fish, black-necked swans, coipo, the Chilean frog |
| 🟧 | **Ciudad** (city) | Streets, glowing towers, pigeons, strays, sakura, streetlights that wake at night |
| ⬡ | **Célula** (cell) | A macrophage crawling on a substrate: organelles on rails, mitosis, phagocytosis |
| 🍄 | **Micelio** (mycelium) | A *Pleurotus* colony foraging a decaying log, trapping nematodes, fruiting |
| ⚛️ | **Neurona** (neuron) | A cortical microcircuit: pyramidal cells, interneurons, spikes and slow waves |

Each world runs the **same clock** but reads it differently: in the forest the
clock is the hour of the day; in the cell it is the cell cycle; in the neuron it
is the brain state (attention, sleep spindles…). Weather becomes the growth
medium, the neuromodulator, the season.

## How it works

burbur is a small, dependency-light engine (Three.js + Tone.js + Vite) built
around three ideas: **a shared stage**, **pure simulation modules**, and
**world adapters** that glue them together.

### 1. A shared stage (`src/render/stage.js`)

Every world is drawn on one reusable engine: an aerial ¾ orbit camera that
"breathes", a scene rendered as **points and lines** (the "matrix" look — no
meshes for the living things), and a post-process **lens** written as a GLSL
shader — barrel *fisheye*, chromatic aberration and vignette in one pass. A
world only supplies its own content plus a per-frame `update(swarm, dt, eco)`
that ends in `stage.render()`. Switching worlds disposes the old GL context
explicitly (`forceContextLoss`) so contexts never leak.

### 2. Pure simulation modules (`src/sim/*`) — the real math

All behaviour lives in small, side-effect-free modules (no Three, no DOM, no
Tone) so it can be unit-tested. The interesting ones:

- **Synchronization — Kuramoto oscillators** (`fireflies.js`): the pulsing
  "fireflies" are coupled phase oscillators, `θ̇ᵢ = ωᵢ + (K/N)·Σ sin(θⱼ−θᵢ)`.
  Left alone they fall into sync; the spacebar perturbs the phases and you watch
  them re-synchronize. The same phases drive the light *and* the audio flashes.
- **Wandering & flocking** (`wander.js`, `fish.js`, `behaviors.js`): agents roam
  a disc with a slow coherent **flow field** plus mutual **separation**; fish
  move as **boids** (separation / alignment / cohesion); birds perch and cross
  the sky (`perch.js`).
- **Noise & terrain** (`render/noise.js`, `noise.js`): **fractal Brownian
  motion** (unnormalized value-noise fBm) shapes the ground, scatters grass and
  flowers, and drives wind, foam and rain.
- **The cell**: a deforming **membrane** from summed harmonics + filopodia and
  blebs (`membrane.js`), **crawling motility** with an ATP floor (`motility.js`),
  a **gated cell cycle** and real **mitosis** — metaphase plate, anaphase,
  cytokinesis (`cellCycle.js`, `mitosis.js`), **molecular motors** walking
  microtubules with **directional traffic** (`motors.js`, `rails.js`,
  `traffic.js`), an **ATP economy** (`atp.js`), and invaders doing
  **run-and-tumble chemotaxis** (`invaders.js`).
- **The fungus**: a growing **mycelial network** of tips and cords
  (`mycelium.js`) that **consumes** the substrate as it forages (`decay.js`), so
  exhausted ground is abandoned; nematode traps feed **fruiting** phenology
  (`fruiting.js`); colonies that meet draw **demarcation lines** instead of
  fusing.
- **The neuron**: **spiking** units (`spikes.js`), **synaptic** transmission
  (`synapse.js`), a **brain-state** driver with neuromodulators and slow-wave /
  spindle dynamics (`brainstate.js`), wired by `netwire.js`.
- **Trees**: seasonal **phenology** (`phenology.js`, `treeLife.js`) — buds, leaf
  and blossom growth, autumn colour, and leaf-fall driven by rain and wind.

### 3. World adapters (`src/worlds/registry.js`)

The registry is where a generic engine becomes six specific worlds. Each entry
is an **adapter**: it declares the world's `build()` function, its **census**
(who lives there, `src/sim/agents.js`), its **ecosystem profile** (how the
shared clock and weather are re-interpreted — `src/sim/ecosystem.js`), its audio
traits (which weather sounds play), its HUD labels, and an *aerial* predicate
(which slots may fly). Add an object to the array and a new world appears in the
selector.

Two more adapters sit on top:

- **`ecosystem.js`** maps one clock onto every domain: a forest phase, a cell-
  cycle checkpoint, a brain state — plus a seasonal temperature model tuned for
  central Chile, and behaviour weighting by hour **and** weather (small birds go
  quiet in the rain; animals peak at dawn and dusk).
- **`events.js` + `narrator.js`** turn the state into a stream of narrated
  events, each world with its own Spanish lexicon.

### 4. Sound — all synthesized (`src/audio/*`)

There are no music files. `engine.js` builds the whole soundscape live with
**Tone.js**: a deep, slow **drone** (detuned `FatOscillator`s → resonant LFO
filter → long reverb, with a hypnotic tremolo), procedural **fauna voices**
(frequency-swept chirps, hoots, caws, wet cellular "bloops", neuron spike
clicks), rain, wind and thunder. The mix is split into three faders — **FONDO**
(drone), **MUNDO** (weather) and **ACTIVIDAD** (life) — so each layer is
independent. On top of the synthesis, real **Creative-Commons field recordings**
of Chilean fauna (from iNaturalist) play when an agent has one, falling back to
the synth otherwise (`samples.js`).

## Tech

Three.js · Tone.js · Vite · Vitest. No build-time assets — a `<canvas>`, some
shaders, and math. Runs on phones and iPad (with an iOS audio-unlock and adaptive
UI). Deployed on Vercel with a custom domain and auto-deploy on every push.

## Run it

```bash
npm install
npm run dev      # dev server
npm run build    # production build → dist/
npm test         # vitest (the pure sim modules)
```

Handy dev flags on the URL: `?season=0.6&wind=1` freezes the season and wind to
inspect the four seasons; `?grown` starts the trees adult.

## License

**[PolyForm Noncommercial License 1.0.0](LICENSE).** Use, study, modify and
share it freely for **any noncommercial purpose** — personal projects,
research, teaching, art. **Commercial use is not granted** by this license: if
you want to use burbur (or a derivative) to make money, please ask for a
commercial license (open an issue).

The **fauna recordings** in `public/audio/fauna/` are third-party and keep their
own Creative-Commons licenses — every species, author and license is credited in
**[CREDITS.md](CREDITS.md)**. Thanks to the iNaturalist community for them, and
to murmur.living for the inspiration.
