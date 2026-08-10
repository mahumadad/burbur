# murmur-world · Bosque de luciérnagas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prototipo en navegador de un bosque nocturno con luciérnagas que se sincronizan solas (modelo Kuramoto), con visual 2.5D (Three.js + bloom) y sonido híbrido procedural (Tone.js), como recreación open-source del concepto mur mur.

**Architecture:** Un loop en `main.js` avanza dos módulos de simulación puros (`sim/fireflies`, `sim/ambient`) y pasa su estado a un renderer Three.js y a un motor de audio Tone.js. La simulación no conoce three ni tone; render y audio solo consumen estado. Un panel de dev tunea parámetros en vivo.

**Tech Stack:** Vite, JavaScript vanilla (ESM), three (con `examples/jsm` postprocessing), tone, vitest (test del núcleo determinista).

## Global Constraints

- Runtime: navegador moderno con módulos ESM; sin frameworks (JS vanilla).
- El audio arranca solo tras gesto del usuario (`Tone.start()` en un overlay "click para entrar").
- Módulos de simulación (`sim/*`, `audio/scale.js`) son **puros**: sin imports de three/tone/DOM.
- Mezcla de audio pensada para colapsar bien a **mono**; master con limiter a **−3 dB**.
- Marco de render circular (emula display redondo); base lista para exportar 466×466 después.
- Commits frecuentes y locales. **No hacer `git push`** en ninguna tarea.
- Escala de notas: **pentatónica** (no disonancia).

---

## Estado y pivote (2026-08-10)

El tema visual pivotó de "bosque nocturno de luciérnagas" a **mapa/glade con individuos que se
mueven** (estilo murmur real). El motor se conserva; cambió la capa de render.

**Completado:**
- Tasks 1–4: scaffold, núcleo Kuramoto, estado del enjambre, mapeo pentatónico (tests verdes).
- Tasks 5–6: render base + marco circular — **render re-tematizado** a glade aéreo (pasto
  instanciado, relieve, individuos con estela punteada, bloom). `createScene` mantiene su interfaz.

**Orden de trabajo restante (acordado con el usuario):**
1. Task 12 — Textura *dithered* + flora.
2. Task 13 — Individuos distintos (formas por especie).
3. Tasks 7–10 — Sonido: motor de audio, capa de mundo, interacción, panel (siguen válidas; el
   sonido va **al final**).
4. Task 11 — README + verificación final.

Las Tasks 7–11 originales siguen vigentes tal cual; solo cambia que se ejecutan después de las
tareas visuales nuevas.

## File Structure

```
murmur-world/
  index.html              # canvas + overlay "click para entrar" + monta main
  package.json            # deps + scripts (dev/build/test)
  vite.config.js          # config mínima
  src/
    main.js               # bootstrap, loop rAF, cablea sim→render→audio+panel
    config.js             # constantes tuneables por defecto (counts, K, volúmenes)
    sim/
      fireflies.js        # modelo de agentes + stepPhases puro
      ambient.js          # viento, grillos, búho (scheduler puro)
    render/
      scene.js            # escena three: cámara, niebla, árboles, sprites, bloom
      framing.js          # máscara circular + viñeta
    audio/
      scale.js            # mapeo profundidad/posición → nota pentatónica (puro)
      engine.js           # grafo Tone.js: cama, drone, voces destello, limiter
    ui/
      panel.js            # controles dev en vivo
  test/
    fireflies.test.js     # convergencia de fase (Kuramoto)
    scale.test.js         # mapeo determinista a pentatónica
```

---

### Task 1: Scaffold del proyecto (Vite + deps + test runner)

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Create: `index.html`
- Create: `src/main.js`
- Create: `src/config.js`

**Interfaces:**
- Consumes: nada.
- Produces: `src/config.js` exporta `export const CONFIG` con los defaults usados por todos los módulos; `index.html` monta `#app`, `#overlay` y arranca `src/main.js`.

- [ ] **Step 1: Crear `package.json`**

```json
{
  "name": "murmur-world",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "three": "^0.169.0",
    "tone": "^15.0.4"
  },
  "devDependencies": {
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Instalar dependencias**

Run: `cd ~/Dev/personal/murmur-world && npm install`
Expected: crea `node_modules/` y `package-lock.json` sin errores.

- [ ] **Step 3: Crear `vite.config.js`**

```js
import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  server: { open: true },
})
```

- [ ] **Step 4: Crear `src/config.js`**

```js
export const CONFIG = {
  fireflies: {
    count: 220,
    couplingK: 2.2,        // fuerza de sincronización
    neighborRadius: 3.5,   // radio de acoplamiento (unidades de mundo)
    omegaMean: 1.1,        // rad/s frecuencia natural media
    omegaSpread: 0.18,     // dispersión relativa de omega
    bounds: { x: 12, y: 7, z: 10 }, // semiejes del volumen
    driftSpeed: 0.35,
  },
  ambient: {
    windPeriodSec: 23,     // periodo del oscilador lento de viento
    cricketBaseRate: 6,    // eventos/seg base
    owlChancePerSec: 0.03, // prob. de hootear por segundo
  },
  audio: {
    masterLimitDb: -3,
    flashPolyphony: 8,
    droneRootHz: 55,       // A1
    volumes: { drone: -14, bed: -18, flash: -10 }, // dB
  },
  render: {
    fogDensity: 0.055,
    bloomStrength: 0.9,
    bloomRadius: 0.6,
    bloomThreshold: 0.15,
  },
}
```

- [ ] **Step 5: Crear `index.html`**

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>murmur · bosque</title>
    <style>
      html, body { margin: 0; height: 100%; background: #05070a; overflow: hidden; }
      #app { position: fixed; inset: 0; }
      #overlay {
        position: fixed; inset: 0; display: grid; place-items: center;
        background: #05070a; color: #cfe8d8; font: 500 18px/1.4 system-ui, sans-serif;
        cursor: pointer; z-index: 10; letter-spacing: .02em;
      }
      #overlay.hidden { display: none; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <div id="overlay">click para entrar</div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 6: Crear `src/main.js` (stub que arranca el loop y quita el overlay)**

```js
import { CONFIG } from './config.js'

const overlay = document.getElementById('overlay')
let running = false

function start() {
  if (running) return
  running = true
  overlay.classList.add('hidden')
  let last = performance.now()
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    // sim/render/audio se cablean en tareas siguientes
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

overlay.addEventListener('click', start)
console.log('murmur-world boot', CONFIG.fireflies.count, 'luciérnagas')
```

- [ ] **Step 7: Verificar que arranca**

Run: `cd ~/Dev/personal/murmur-world && npm run dev`
Expected: abre el navegador, se ve el overlay "click para entrar"; al hacer click desaparece y la consola imprime `murmur-world boot 220 luciérnagas`. Sin errores en consola. Cortar con Ctrl+C.

- [ ] **Step 8: Commit**

```bash
cd ~/Dev/personal/murmur-world
git add package.json package-lock.json vite.config.js index.html src/config.js src/main.js
git commit -m "Scaffold Vite project with boot loop and overlay"
```

---

### Task 2: Modelo de sincronización de fases (núcleo puro, TDD)

**Files:**
- Create: `src/sim/fireflies.js`
- Test: `test/fireflies.test.js`

**Interfaces:**
- Consumes: `CONFIG.fireflies` de `src/config.js`.
- Produces:
  - `export function stepPhases(phases, omegas, adjacency, K, dt)` → **muta** `phases` in place (nuevo valor `θ += (ω + (K/deg)·Σ sin(θ_j−θ_i))·dt`, sin wrap) y **retorna** un array `crossed` de índices cuya fase cruzó/alcanzó 2π en este paso (antes de wrapear). `adjacency` es `number[][]` (lista de vecinos por índice).
  - `export function phaseVariance(phases)` → número: varianza circular (1 − R), con R = módulo del promedio de vectores unitarios. 0 = sincronizado total.

- [ ] **Step 1: Escribir el test que falla**

```js
// test/fireflies.test.js
import { describe, it, expect } from 'vitest'
import { stepPhases, phaseVariance } from '../src/sim/fireflies.js'

describe('stepPhases (Kuramoto)', () => {
  it('dos osciladores acoplados convergen en fase', () => {
    const phases = [0.2, 2.9]      // muy desfasados
    const omegas = [1.0, 1.0]      // misma frecuencia natural
    const adjacency = [[1], [0]]   // mutuamente vecinos
    const K = 3.0
    const dt = 0.02
    const before = phaseVariance(phases)
    for (let i = 0; i < 2000; i++) stepPhases(phases, omegas, adjacency, K, dt)
    const after = phaseVariance(phases)
    expect(after).toBeLessThan(before)
    expect(after).toBeLessThan(0.02) // prácticamente sincronizados
  })

  it('marca cruce de 2π como destello', () => {
    const phases = [6.2]           // cerca de 2π (~6.283)
    const omegas = [2.0]
    const adjacency = [[]]
    const crossed = stepPhases(phases, omegas, adjacency, 0, 0.1)
    expect(crossed).toEqual([0])
    expect(phases[0]).toBeLessThan(1) // wrapeó
  })

  it('phaseVariance es 0 con fases idénticas', () => {
    expect(phaseVariance([1.3, 1.3, 1.3])).toBeCloseTo(0, 6)
  })
})
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `cd ~/Dev/personal/murmur-world && npm test`
Expected: FAIL — `stepPhases is not a function` (módulo aún no existe).

- [ ] **Step 3: Implementar `src/sim/fireflies.js` (solo el núcleo de fase)**

```js
const TWO_PI = Math.PI * 2

export function stepPhases(phases, omegas, adjacency, K, dt) {
  const n = phases.length
  const deltas = new Array(n)
  for (let i = 0; i < n; i++) {
    const nb = adjacency[i]
    let coupling = 0
    if (nb.length > 0) {
      let s = 0
      for (let k = 0; k < nb.length; k++) s += Math.sin(phases[nb[k]] - phases[i])
      coupling = (K / nb.length) * s
    }
    deltas[i] = (omegas[i] + coupling) * dt
  }
  const crossed = []
  for (let i = 0; i < n; i++) {
    let p = phases[i] + deltas[i]
    if (p >= TWO_PI) {
      crossed.push(i)
      p -= TWO_PI
      if (p >= TWO_PI) p = p % TWO_PI
    } else if (p < 0) {
      p = ((p % TWO_PI) + TWO_PI) % TWO_PI
    }
    phases[i] = p
  }
  return crossed
}

export function phaseVariance(phases) {
  let sx = 0, sy = 0
  for (let i = 0; i < phases.length; i++) { sx += Math.cos(phases[i]); sy += Math.sin(phases[i]) }
  const n = phases.length || 1
  const R = Math.sqrt(sx * sx + sy * sy) / n
  return 1 - R
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `cd ~/Dev/personal/murmur-world && npm test`
Expected: PASS — los 3 tests verdes.

- [ ] **Step 5: Commit**

```bash
cd ~/Dev/personal/murmur-world
git add src/sim/fireflies.js test/fireflies.test.js
git commit -m "Add Kuramoto phase-sync core with tests"
```

---

### Task 3: Estado espacial del enjambre (posiciones, deriva, vecindad, destellos)

**Files:**
- Modify: `src/sim/fireflies.js`

**Interfaces:**
- Consumes: `stepPhases`, `CONFIG.fireflies`.
- Produces:
  - `export function createSwarm(cfg, rand = Math.random)` → objeto `swarm` con: `count`, `pos` (Float32Array de 3·count), `phases` (Array), `omegas` (Array), `flash` (Float32Array de count: envolvente de brillo 0..1).
  - `export function updateSwarm(swarm, cfg, dt)` → avanza deriva + recomputa vecindad (radio `cfg.neighborRadius`) + llama `stepPhases` + setea `flash[i]=1` en los índices cruzados y decae el resto; **retorna** `flashes` = array de `{ i, x, y, z, intensity }` de los que destellaron este frame.

- [ ] **Step 1: Escribir el test que falla**

```js
// añadir a test/fireflies.test.js
import { createSwarm, updateSwarm } from '../src/sim/fireflies.js'
import { CONFIG } from '../src/config.js'

describe('swarm', () => {
  it('createSwarm respeta el count y llena arrays', () => {
    const s = createSwarm(CONFIG.fireflies, () => 0.5)
    expect(s.count).toBe(CONFIG.fireflies.count)
    expect(s.pos.length).toBe(CONFIG.fireflies.count * 3)
    expect(s.phases.length).toBe(CONFIG.fireflies.count)
  })

  it('updateSwarm retorna destellos con coordenadas', () => {
    const cfg = { ...CONFIG.fireflies, count: 40 }
    const s = createSwarm(cfg, () => 0.9) // fases altas → cruzan pronto
    let seen = 0
    for (let f = 0; f < 200; f++) {
      const flashes = updateSwarm(s, cfg, 0.05)
      for (const fl of flashes) {
        expect(typeof fl.x).toBe('number')
        expect(fl.intensity).toBeGreaterThan(0)
        seen++
      }
    }
    expect(seen).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `cd ~/Dev/personal/murmur-world && npm test`
Expected: FAIL — `createSwarm is not a function`.

- [ ] **Step 3: Implementar en `src/sim/fireflies.js` (añadir al final)**

```js
function rangeRand(rand, half) { return (rand() * 2 - 1) * half }

export function createSwarm(cfg, rand = Math.random) {
  const n = cfg.count
  const pos = new Float32Array(n * 3)
  const vel = new Float32Array(n * 3)
  const phases = new Array(n)
  const omegas = new Array(n)
  const flash = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    pos[i * 3 + 0] = rangeRand(rand, cfg.bounds.x)
    pos[i * 3 + 1] = rangeRand(rand, cfg.bounds.y)
    pos[i * 3 + 2] = rangeRand(rand, cfg.bounds.z)
    vel[i * 3 + 0] = rangeRand(rand, cfg.driftSpeed)
    vel[i * 3 + 1] = rangeRand(rand, cfg.driftSpeed * 0.5)
    vel[i * 3 + 2] = rangeRand(rand, cfg.driftSpeed)
    phases[i] = rand() * TWO_PI
    omegas[i] = cfg.omegaMean * (1 + (rand() * 2 - 1) * cfg.omegaSpread)
  }
  return { count: n, pos, vel, phases, omegas, flash, _rand: rand }
}

function buildAdjacency(pos, n, radius) {
  const r2 = radius * radius
  const adj = new Array(n)
  for (let i = 0; i < n; i++) adj[i] = []
  for (let i = 0; i < n; i++) {
    const ix = pos[i * 3], iy = pos[i * 3 + 1], iz = pos[i * 3 + 2]
    for (let j = i + 1; j < n; j++) {
      const dx = ix - pos[j * 3], dy = iy - pos[j * 3 + 1], dz = iz - pos[j * 3 + 2]
      if (dx * dx + dy * dy + dz * dz <= r2) { adj[i].push(j); adj[j].push(i) }
    }
  }
  return adj
}

export function updateSwarm(swarm, cfg, dt) {
  const { pos, vel, phases, omegas, flash, count: n } = swarm
  // deriva con rebote suave dentro del volumen
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      const k = i * 3 + a
      pos[k] += vel[k] * dt
      const half = a === 0 ? cfg.bounds.x : a === 1 ? cfg.bounds.y : cfg.bounds.z
      if (pos[k] > half) { pos[k] = half; vel[k] = -Math.abs(vel[k]) }
      else if (pos[k] < -half) { pos[k] = -half; vel[k] = Math.abs(vel[k]) }
    }
  }
  const adjacency = buildAdjacency(pos, n, cfg.neighborRadius)
  const crossed = stepPhases(phases, omegas, adjacency, cfg.couplingK, dt)
  // decae brillo
  const decay = Math.exp(-dt / 0.18)
  for (let i = 0; i < n; i++) flash[i] *= decay
  const flashes = []
  for (const i of crossed) {
    flash[i] = 1
    flashes.push({ i, x: pos[i * 3], y: pos[i * 3 + 1], z: pos[i * 3 + 2], intensity: 1 })
  }
  return flashes
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `cd ~/Dev/personal/murmur-world && npm test`
Expected: PASS — todos los tests (Task 2 + Task 3) verdes.

- [ ] **Step 5: Commit**

```bash
cd ~/Dev/personal/murmur-world
git add src/sim/fireflies.js test/fireflies.test.js
git commit -m "Add spatial swarm state with drift, neighborhood and flashes"
```

---

### Task 4: Mapeo de sonido a escala pentatónica (puro, TDD)

**Files:**
- Create: `src/audio/scale.js`
- Test: `test/scale.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export const PENTATONIC = [0, 2, 4, 7, 9]` (semitonos, A minor pentatónica relativa a la raíz).
  - `export function flashToFreq(y, boundsY, rootHz = 220, octaves = 3)` → Hz: mapea altura `y ∈ [−boundsY, boundsY]` a un grado de la pentatónica extendida `octaves` octavas; más alto = más agudo. Determinista.

- [ ] **Step 1: Escribir el test que falla**

```js
// test/scale.test.js
import { describe, it, expect } from 'vitest'
import { PENTATONIC, flashToFreq } from '../src/audio/scale.js'

describe('flashToFreq', () => {
  it('la raíz cae en el fondo del rango', () => {
    expect(flashToFreq(-7, 7, 220, 3)).toBeCloseTo(220, 3)
  })
  it('más arriba = más agudo (monótono no decreciente)', () => {
    let prev = 0
    for (let y = -7; y <= 7; y += 0.5) {
      const f = flashToFreq(y, 7, 220, 3)
      expect(f).toBeGreaterThanOrEqual(prev)
      prev = f
    }
  })
  it('todas las notas pertenecen a la pentatónica', () => {
    const root = 220
    for (let y = -7; y <= 7; y += 0.3) {
      const f = flashToFreq(y, 7, root, 3)
      const semis = Math.round(12 * Math.log2(f / root))
      expect(PENTATONIC.includes(((semis % 12) + 12) % 12)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `cd ~/Dev/personal/murmur-world && npm test`
Expected: FAIL — `flashToFreq is not a function`.

- [ ] **Step 3: Implementar `src/audio/scale.js`**

```js
export const PENTATONIC = [0, 2, 4, 7, 9]

export function flashToFreq(y, boundsY, rootHz = 220, octaves = 3) {
  const scale = []
  for (let o = 0; o < octaves; o++) for (const s of PENTATONIC) scale.push(o * 12 + s)
  const t = Math.max(0, Math.min(1, (y + boundsY) / (2 * boundsY)))
  const idx = Math.min(scale.length - 1, Math.floor(t * (scale.length - 1) + 1e-9))
  return rootHz * Math.pow(2, scale[idx] / 12)
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `cd ~/Dev/personal/murmur-world && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/Dev/personal/murmur-world
git add src/audio/scale.js test/scale.test.js
git commit -m "Add pentatonic flash-to-frequency mapping with tests"
```

---

### Task 5: Escena Three.js con luciérnagas y bloom

**Files:**
- Create: `src/render/scene.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `three`, `three/examples/jsm/postprocessing/*`, `CONFIG.render`, el `swarm` de `createSwarm`, `updateSwarm`.
- Produces:
  - `export function createScene(container, cfg)` → `{ update(swarm), resize(), renderer, camera }`.
    - `update(swarm)` copia `swarm.pos` a la geometría de puntos y usa `swarm.flash[i]` como brillo por-punto (atributo `aBrightness`), luego renderiza con bloom.
    - `resize()` ajusta a `container` (cuadrado centrado, lado = min(ancho, alto)).

- [ ] **Step 1: Implementar `src/render/scene.js`**

```js
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

export function createScene(container, cfg) {
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x05121a, cfg.render.fogDensity)

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100)
  camera.position.set(0, 0, 22)

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setClearColor(0x05121a, 1)
  container.appendChild(renderer.domElement)

  // fondo: siluetas de árboles (planos casi negros)
  const trees = new THREE.Group()
  for (let t = 0; t < 9; t++) {
    const w = 2 + Math.random() * 3
    const h = 10 + Math.random() * 8
    const geo = new THREE.PlaneGeometry(w, h)
    const mat = new THREE.MeshBasicMaterial({ color: 0x02080b })
    const m = new THREE.Mesh(geo, mat)
    m.position.set((Math.random() * 2 - 1) * 16, -3, -14 - Math.random() * 6)
    trees.add(m)
  }
  scene.add(trees)

  // luciérnagas como puntos con brillo por-vértice
  const n = cfg.fireflies.count
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  geom.setAttribute('aBrightness', new THREE.BufferAttribute(new Float32Array(n), 1))
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uSize: { value: 26 * renderer.getPixelRatio() } },
    vertexShader: `
      attribute float aBrightness;
      varying float vB;
      uniform float uSize;
      void main() {
        vB = aBrightness;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * (0.25 + aBrightness) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vB;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        vec3 warm = vec3(0.75, 0.95, 0.55);
        gl_FragColor = vec4(warm, a * (0.12 + vB));
      }`,
  })
  const points = new THREE.Points(geom, mat)
  scene.add(points)

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(1, 1),
    cfg.render.bloomStrength, cfg.render.bloomRadius, cfg.render.bloomThreshold,
  )
  composer.addPass(bloom)

  function resize() {
    const side = Math.min(container.clientWidth, container.clientHeight)
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.setSize(side, side, false)
    composer.setSize(side, side)
    const el = renderer.domElement
    el.style.position = 'absolute'
    el.style.left = (container.clientWidth - side) / 2 + 'px'
    el.style.top = (container.clientHeight - side) / 2 + 'px'
  }
  resize()
  window.addEventListener('resize', resize)

  function update(swarm) {
    const posAttr = geom.getAttribute('position')
    const brAttr = geom.getAttribute('aBrightness')
    posAttr.array.set(swarm.pos)
    brAttr.array.set(swarm.flash)
    posAttr.needsUpdate = true
    brAttr.needsUpdate = true
    composer.render()
  }

  return { update, resize, renderer, camera }
}
```

- [ ] **Step 2: Cablear en `src/main.js`**

```js
import { CONFIG } from './config.js'
import { createSwarm, updateSwarm } from './sim/fireflies.js'
import { createScene } from './render/scene.js'

const overlay = document.getElementById('overlay')
const app = document.getElementById('app')
let running = false

function start() {
  if (running) return
  running = true
  overlay.classList.add('hidden')

  const swarm = createSwarm(CONFIG.fireflies)
  const scene = createScene(app, CONFIG)

  let last = performance.now()
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    updateSwarm(swarm, CONFIG.fireflies, dt)
    scene.update(swarm)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

overlay.addEventListener('click', start)
```

- [ ] **Step 3: Verificar a ojo con el navegador**

Run: `cd ~/Dev/personal/murmur-world && npm run dev`

Verificar en un cuadrado centrado:
1. Click → aparecen ~220 puntos verdosos flotando con glow (bloom).
2. Tras ~10–20 s, los destellos empiezan a **coincidir en pulsos** (sincronización visible), no aleatorios.
3. Sin errores en consola (revisar DevTools).

Si los puntos no se ven: revisar que `aBrightness` arranca >0 (el término `0.12 + vB` garantiza visibilidad basal). Cortar con Ctrl+C.

- [ ] **Step 4: Commit**

```bash
cd ~/Dev/personal/murmur-world
git add src/render/scene.js src/main.js
git commit -m "Render firefly swarm in Three.js with additive bloom"
```

---

### Task 6: Marco circular (lente/display redondo)

**Files:**
- Create: `src/render/framing.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: el `container` (`#app`).
- Produces: `export function applyFraming(container)` → inserta un overlay DOM con máscara circular + viñeta radial sobre el canvas (no toca el render WebGL). Idempotente.

- [ ] **Step 1: Implementar `src/render/framing.js`**

```js
export function applyFraming(container) {
  if (container.querySelector('.framing')) return
  const el = document.createElement('div')
  el.className = 'framing'
  el.style.cssText = `
    position:absolute; inset:0; pointer-events:none; z-index:5;
    background:
      radial-gradient(circle at center,
        rgba(0,0,0,0) 60%, rgba(0,0,0,0.55) 78%, rgba(3,6,10,1) 92%);
  `
  container.appendChild(el)
}
```

- [ ] **Step 2: Cablear en `src/main.js` (dentro de `start`, tras crear la escena)**

Añadir el import arriba:
```js
import { applyFraming } from './render/framing.js'
```
Y tras `const scene = createScene(app, CONFIG)`:
```js
  applyFraming(app)
```

- [ ] **Step 3: Verificar a ojo**

Run: `cd ~/Dev/personal/murmur-world && npm run dev`
Expected: el mundo queda enmarcado en un círculo con bordes que se funden a negro (efecto lente). Los bordes cuadrados del canvas ya no se notan. Cortar con Ctrl+C.

- [ ] **Step 4: Commit**

```bash
cd ~/Dev/personal/murmur-world
git add src/render/framing.js src/main.js
git commit -m "Add circular lens framing overlay"
```

---

### Task 7: Motor de audio Tone.js — cama, drone y voces de destello

**Files:**
- Create: `src/audio/engine.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `tone`, `CONFIG.audio`, `CONFIG.fireflies.bounds`, `flashToFreq` de `audio/scale.js`.
- Produces:
  - `export async function createAudio(cfg)` → `{ triggerFlash(y, intensity), setWind(w) }`. Debe llamarse tras `Tone.start()`. Construye: ruido rosado→filtro (cama), dos osciladores desafinados+reverb (drone), PolySynth con reverb compartido (voces), y un `Tone.Limiter(cfg.audio.masterLimitDb)` en el master.
    - `triggerFlash(y, intensity)` toca una nota `flashToFreq(y, boundsY, ...)` con velocity ~intensity, respetando `flashPolyphony`.
    - `setWind(w)` con `w ∈ [0,1]` mueve la frecuencia del filtro de la cama y su ganancia.

- [ ] **Step 1: Implementar `src/audio/engine.js`**

```js
import * as Tone from 'tone'
import { flashToFreq } from './scale.js'

export async function createAudio(cfg) {
  const limiter = new Tone.Limiter(cfg.audio.masterLimitDb).toDestination()

  // Drone grave: dos osciladores desafinados + reverb
  const droneReverb = new Tone.Reverb({ decay: 8, wet: 0.6 }).connect(limiter)
  const droneGain = new Tone.Gain(Tone.dbToGain(cfg.audio.volumes.drone)).connect(droneReverb)
  const oscA = new Tone.Oscillator(cfg.audio.droneRootHz, 'sine').start()
  const oscB = new Tone.Oscillator(cfg.audio.droneRootHz * 1.005, 'triangle').start()
  oscA.connect(droneGain); oscB.connect(droneGain)

  // Cama: ruido rosado → filtro (modulado por viento)
  const bedGain = new Tone.Gain(Tone.dbToGain(cfg.audio.volumes.bed)).connect(limiter)
  const bedFilter = new Tone.Filter(500, 'lowpass').connect(bedGain)
  const noise = new Tone.Noise('pink').start()
  noise.connect(bedFilter)

  // Voces de destello: PolySynth suave + reverb compartido
  const flashReverb = new Tone.Reverb({ decay: 5, wet: 0.5 }).connect(limiter)
  const flashGain = new Tone.Gain(Tone.dbToGain(cfg.audio.volumes.flash)).connect(flashReverb)
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.0, release: 1.2 },
  })
  synth.maxPolyphony = cfg.audio.flashPolyphony
  synth.connect(flashGain)

  const boundsY = cfg.fireflies.bounds.y

  function triggerFlash(y, intensity) {
    const f = flashToFreq(y, boundsY, 220, 3)
    try { synth.triggerAttackRelease(f, 0.5, undefined, 0.2 + 0.6 * intensity) } catch (_) {}
  }

  function setWind(w) {
    const clamped = Math.max(0, Math.min(1, w))
    bedFilter.frequency.rampTo(300 + clamped * 1800, 0.3)
    bedGain.gain.rampTo(Tone.dbToGain(cfg.audio.volumes.bed) * (0.5 + clamped), 0.3)
  }

  return { triggerFlash, setWind }
}
```

- [ ] **Step 2: Cablear en `src/main.js`**

Añadir imports:
```js
import * as Tone from 'tone'
import { createAudio } from './audio/engine.js'
```
Hacer `start` async y, tras crear escena/framing, iniciar audio y disparar por destello:
```js
async function start() {
  if (running) return
  running = true
  overlay.classList.add('hidden')

  await Tone.start()
  const swarm = createSwarm(CONFIG.fireflies)
  const scene = createScene(app, CONFIG)
  applyFraming(app)
  const audio = await createAudio(CONFIG)

  let last = performance.now()
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const flashes = updateSwarm(swarm, CONFIG.fireflies, dt)
    for (const fl of flashes) audio.triggerFlash(fl.y, fl.intensity)
    scene.update(swarm)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
```

- [ ] **Step 3: Verificar a oído**

Run: `cd ~/Dev/personal/murmur-world && npm run dev`

Verificar:
1. Click → se oye un drone grave + una cama de ruido suave.
2. Cada destello dispara una nota; cuando las luciérnagas sincronizan, las notas se agrupan en "acordes" pentatónicos (nunca disonantes).
3. No hay saturación/clipping (el limiter protege). Si suena a barro, bajar `flashPolyphony` o `volumes.flash` en `config.js`. Cortar con Ctrl+C.

- [ ] **Step 4: Commit**

```bash
cd ~/Dev/personal/murmur-world
git add src/audio/engine.js src/main.js
git commit -m "Add Tone.js audio engine: bed, drone and pentatonic flash voices"
```

---

### Task 8: Capa de mundo — viento, grillos y búho

**Files:**
- Create: `src/sim/ambient.js`
- Modify: `src/audio/engine.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `CONFIG.ambient`.
- Produces:
  - `src/sim/ambient.js`: `export function createAmbient(cfg)` → `{ update(dt) }` donde `update` retorna `{ wind, cricket, owl }` — `wind ∈ [0,1]` (oscilador lento), `cricket` boolean (si toca ráfaga este frame según `cricketBaseRate` modulado por viento), `owl` boolean (evento raro por `owlChancePerSec`).
  - En `engine.js`: extender el retorno de `createAudio` con `cricket()` y `owl()` que disparan síntesis dedicada (ráfaga de ruido filtrado paneada al azar; hoot = dos tonos descendentes).

- [ ] **Step 1: Implementar `src/sim/ambient.js`**

```js
export function createAmbient(cfg) {
  let t = 0
  const omega = (2 * Math.PI) / cfg.windPeriodSec
  function update(dt) {
    t += dt
    const wind = 0.5 + 0.5 * Math.sin(omega * t)
    const rate = cfg.cricketBaseRate * (0.6 + 0.8 * wind)
    const cricket = Math.random() < rate * dt
    const owl = Math.random() < cfg.owlChancePerSec * dt
    return { wind, cricket, owl }
  }
  return { update }
}
```

- [ ] **Step 2: Extender `src/audio/engine.js`**

Antes del `return`, añadir la síntesis de grillos y búho:
```js
  // Grillos: ráfaga corta de ruido pasa-banda, paneada al azar
  const cricketPan = new Tone.Panner(0).connect(bedGain)
  const cricketFilter = new Tone.Filter(4200, 'bandpass').connect(cricketPan)
  cricketFilter.Q.value = 8
  const cricketEnv = new Tone.AmplitudeEnvelope({ attack: 0.005, decay: 0.05, sustain: 0, release: 0.03 }).connect(cricketFilter)
  const cricketNoise = new Tone.Noise('white').start()
  cricketNoise.connect(cricketEnv)

  function cricket() {
    cricketPan.pan.value = Math.random() * 2 - 1
    cricketEnv.triggerAttackRelease(0.03)
  }

  // Búho: dos tonos descendentes suaves
  const owlSynth = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.08, decay: 0.2, sustain: 0.3, release: 0.5 },
  }).connect(droneReverb)
  owlSynth.volume.value = -16

  function owl() {
    const now = Tone.now()
    owlSynth.triggerAttackRelease(320, 0.25, now)
    owlSynth.triggerAttackRelease(260, 0.5, now + 0.28)
  }
```
Y cambiar el `return` a:
```js
  return { triggerFlash, setWind, cricket, owl }
```

- [ ] **Step 3: Cablear en `src/main.js`**

Añadir import y crear ambient dentro de `start`:
```js
import { createAmbient } from './sim/ambient.js'
```
Tras crear `audio`:
```js
  const ambient = createAmbient(CONFIG.ambient)
```
Dentro de `frame`, tras procesar flashes:
```js
    const env = ambient.update(dt)
    audio.setWind(env.wind)
    if (env.cricket) audio.cricket()
    if (env.owl) audio.owl()
```

- [ ] **Step 4: Verificar a oído**

Run: `cd ~/Dev/personal/murmur-world && npm run dev`
Expected: además de drone + destellos, se oyen grillos que suben/bajan de densidad (respiración del viento) y, de vez en cuando (~cada 30 s), un búho. Cortar con Ctrl+C.

- [ ] **Step 5: Commit**

```bash
cd ~/Dev/personal/murmur-world
git add src/sim/ambient.js src/audio/engine.js src/main.js
git commit -m "Add world layer: wind-modulated crickets and occasional owl"
```

---

### Task 9: Interacción — mouse atrae y tecla desincroniza

**Files:**
- Modify: `src/sim/fireflies.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `swarm`.
- Produces:
  - `export function attract(swarm, cfg, wx, wy, strength)` → empuja `vel` de luciérnagas cercanas al punto de mundo `(wx, wy)` (z=0), radio `cfg.neighborRadius * 2`.
  - `export function perturbPhases(swarm, amount, rand = Math.random)` → suma ruido `±amount` a cada fase (desincroniza).

- [ ] **Step 1: Implementar en `src/sim/fireflies.js` (añadir al final)**

```js
export function attract(swarm, cfg, wx, wy, strength) {
  const { pos, vel, count: n } = swarm
  const r = cfg.neighborRadius * 2
  const r2 = r * r
  for (let i = 0; i < n; i++) {
    const dx = wx - pos[i * 3], dy = wy - pos[i * 3 + 1]
    const d2 = dx * dx + dy * dy
    if (d2 < r2) {
      const f = strength * (1 - Math.sqrt(d2) / r)
      vel[i * 3] += dx * f
      vel[i * 3 + 1] += dy * f
    }
  }
}

export function perturbPhases(swarm, amount, rand = Math.random) {
  const p = swarm.phases
  for (let i = 0; i < p.length; i++) {
    p[i] = (p[i] + (rand() * 2 - 1) * amount + TWO_PI) % TWO_PI
  }
}
```

- [ ] **Step 2: Cablear en `src/main.js`**

Añadir a los imports de fireflies: `attract, perturbPhases`.
Dentro de `start`, tras crear `swarm` y `scene`, registrar eventos (mapeo pantalla→mundo aproximado por los bounds):
```js
  let mouse = null
  app.addEventListener('pointermove', (e) => {
    const rect = app.getBoundingClientRect()
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1)
    mouse = { x: nx * CONFIG.fireflies.bounds.x, y: ny * CONFIG.fireflies.bounds.y }
  })
  app.addEventListener('pointerleave', () => { mouse = null })
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); perturbPhases(swarm, Math.PI) }
  })
```
Dentro de `frame`, antes de `updateSwarm`:
```js
    if (mouse) attract(swarm, CONFIG.fireflies, mouse.x, mouse.y, 0.6 * dt)
```

- [ ] **Step 3: Verificar a ojo**

Run: `cd ~/Dev/personal/murmur-world && npm run dev`
Verificar:
1. Mover el mouse sobre el mundo → las luciérnagas cercanas se acercan al cursor.
2. Presionar barra espaciadora → los pulsos se **desincronizan** y, en ~10–20 s, vuelven a sincronizarse. Cortar con Ctrl+C.

- [ ] **Step 4: Commit**

```bash
cd ~/Dev/personal/murmur-world
git add src/sim/fireflies.js src/main.js
git commit -m "Add interaction: mouse attraction and spacebar desync"
```

---

### Task 10: Panel de dev para tunear en vivo

**Files:**
- Create: `src/ui/panel.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `CONFIG` (muta sus campos en vivo), callbacks para volúmenes.
- Produces:
  - `export function createPanel(cfg, hooks)` → inserta un panel HTML fijo con sliders. `hooks = { onFlashVol(db), onDroneVol(db), onBedVol(db) }`. Sliders: `couplingK`, `neighborRadius`, y los 3 volúmenes. Mutar `couplingK`/`neighborRadius` directamente en `cfg.fireflies` afecta el próximo frame (se leen cada frame).

- [ ] **Step 1: Implementar `src/ui/panel.js`**

```js
export function createPanel(cfg, hooks) {
  const el = document.createElement('div')
  el.style.cssText = `
    position:fixed; top:10px; left:10px; z-index:20; padding:10px 12px;
    background:rgba(5,8,12,.7); color:#bfe; font:12px/1.5 system-ui,sans-serif;
    border-radius:8px; backdrop-filter:blur(4px); user-select:none;`
  function row(label, min, max, step, value, on) {
    const wrap = document.createElement('label')
    wrap.style.cssText = 'display:flex; gap:8px; align-items:center; justify-content:space-between;'
    const span = document.createElement('span'); span.textContent = label
    const input = document.createElement('input')
    input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value
    input.addEventListener('input', () => on(parseFloat(input.value)))
    wrap.append(span, input); el.append(wrap)
  }
  row('acoplamiento K', 0, 6, 0.1, cfg.fireflies.couplingK, (v) => cfg.fireflies.couplingK = v)
  row('radio vecindad', 1, 8, 0.1, cfg.fireflies.neighborRadius, (v) => cfg.fireflies.neighborRadius = v)
  row('vol destellos', -40, 0, 1, cfg.audio.volumes.flash, (v) => hooks.onFlashVol(v))
  row('vol drone', -40, 0, 1, cfg.audio.volumes.drone, (v) => hooks.onDroneVol(v))
  row('vol cama', -40, 0, 1, cfg.audio.volumes.bed, (v) => hooks.onBedVol(v))
  document.body.appendChild(el)
}
```

- [ ] **Step 2: Exponer setters de volumen en `src/audio/engine.js`**

Antes del `return`, añadir:
```js
  function setFlashVol(db) { flashGain.gain.rampTo(Tone.dbToGain(db), 0.1) }
  function setDroneVol(db) { droneGain.gain.rampTo(Tone.dbToGain(db), 0.1) }
  function setBedVol(db) { bedGain.gain.rampTo(Tone.dbToGain(db), 0.1) }
```
Y ampliar el `return`:
```js
  return { triggerFlash, setWind, cricket, owl, setFlashVol, setDroneVol, setBedVol }
```

- [ ] **Step 3: Cablear en `src/main.js`**

Añadir import:
```js
import { createPanel } from './ui/panel.js'
```
Tras crear `audio`:
```js
  createPanel(CONFIG, {
    onFlashVol: audio.setFlashVol,
    onDroneVol: audio.setDroneVol,
    onBedVol: audio.setBedVol,
  })
```

- [ ] **Step 4: Verificar a ojo/oído**

Run: `cd ~/Dev/personal/murmur-world && npm run dev`
Verificar:
1. Aparece el panel arriba a la izquierda.
2. Bajar `acoplamiento K` a ~0 → las luciérnagas se **desincronizan** (pulsos aleatorios). Subir a ~4 → sincronizan rápido.
3. Los sliders de volumen cambian la mezcla en vivo. Cortar con Ctrl+C.

- [ ] **Step 5: Commit**

```bash
cd ~/Dev/personal/murmur-world
git add src/ui/panel.js src/audio/engine.js src/main.js
git commit -m "Add live dev panel for coupling, neighborhood and volumes"
```

---

### Task 11: README y verificación final

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: nada.
- Produces: documentación de arranque, controles y relación con el device.

- [ ] **Step 1: Correr toda la batería de tests**

Run: `cd ~/Dev/personal/murmur-world && npm test`
Expected: PASS — tests de `fireflies` y `scale` verdes.

- [ ] **Step 2: Crear `README.md`**

````markdown
# murmur-world · bosque de luciérnagas

Recreación open-source del concepto [mur mur](https://www.murmur.living/): un mundo nocturno
donde cientos de luciérnagas se **sincronizan solas** (modelo Kuramoto) y su pulso genera sonido.
Visual 2.5D (Three.js + bloom), sonido híbrido procedural (Tone.js). Corre en el navegador.

## Correr

```bash
npm install
npm run dev   # abre localhost; click en "click para entrar" para iniciar el audio
npm test      # tests del núcleo de simulación y del mapeo de sonido
```

## Controles

- **Mouse:** atrae a las luciérnagas cercanas.
- **Barra espaciadora:** desincroniza (mira cómo vuelven a sincronizarse).
- **Panel (arriba izq.):** acoplamiento, radio de vecindad y volúmenes en vivo.

## Estructura

- `src/sim/` — simulación pura (agentes + mundo), sin dependencias de render/audio.
- `src/render/` — escena Three.js + marco circular tipo lente.
- `src/audio/` — grafo Tone.js (cama, drone, voces de destello) + mapeo pentatónico.

## Relación con el device DIY

Este prototipo apunta al hardware de [oio/murmur-diy](https://github.com/oio/murmur-diy), que
reproduce un `.avi` 466×466 desde una SD. La exportación a video loopable es una fase posterior:
renderizar cuadrado 466×466, capturar frames+audio y pasarlo por `scripts/convert_for_sd.sh`
(MJPEG @15fps + PCM s16le 22050 Hz mono).
````

- [ ] **Step 3: Verificación final integral**

Run: `cd ~/Dev/personal/murmur-world && npm run dev`
Checklist:
1. Click inicia visual + audio sin errores en consola.
2. Sincronización emergente visible y audible (acordes pentatónicos).
3. Grillos con respiración de viento + búho ocasional.
4. Mouse y barra espaciadora funcionan.
5. Marco circular presente. Cortar con Ctrl+C.

- [ ] **Step 4: Commit**

```bash
cd ~/Dev/personal/murmur-world
git add README.md
git commit -m "Add README with run instructions and device pipeline notes"
```

---

### Task 12: Textura dithered + flora (glade)

**Files:**
- Modify: `src/render/scene.js`

**Objetivo:** acercar el look a murmur con su firma *dithered* (estampado punteado) en rocas/
árboles y poblar el pasto con florecillas/brotes. Es trabajo de dirección de arte: se itera con
verificación visual en el navegador (screenshots), no con tests unitarios.

- [ ] **Dithered en relieve:** aplicar a rocas/colinas un patrón punteado (Bayer/ordered dither
  en el fragment shader del material, o textura de puntos). Debe leerse como estampado, no liso.
- [ ] **Árboles muertos punteados:** añadir 1–3 árboles secos blancos con textura punteada.
- [ ] **Flora:** instanciar florecillas (tallo fino + cabeza de color: naranja, amarillo, magenta)
  y brotes teal, esparcidos por el pasto con densidad variable.
- [ ] **Verificación visual:** `npm run dev`, entrar, comparar contra la referencia de murmur;
  ajustar densidad/escala/contraste hasta que el estampado y la flora lean bien.
- [ ] **Guardas:** `npm run build` limpio y `npm test` (8/8) siguen pasando; commit local.

### Task 13: Individuos distintos (formas por especie)

**Files:**
- Modify: `src/render/scene.js` (y opcionalmente `src/config.js` para paleta/especies)

**Objetivo:** que los individuos se lean como **especies distintas** en vez de anillos iguales:
p.ej. cubos wireframe cyan con un "ojo", estrellas amarillas, ráfagas blancas, formas magenta.
Cada individuo conserva su color y su estela.

- [ ] Asignar a cada agente una "especie" (por índice) con su forma y color.
- [ ] Render por especie: sprites con distinta figura (anillo, estrella, ráfaga) o pequeñas
  geometrías (cubo wireframe) orientadas hacia la cámara; el latido escala/brilla la figura.
- [ ] Mantener la estela punteada por individuo.
- [ ] Verificación visual + `npm run build`/`npm test` verdes; commit local.

## Self-Review (cobertura del spec)

- Simulación luciérnagas / Kuramoto → Tasks 2, 3, 9. ✓
- Capa de mundo (viento/grillos/búho) → Task 8. ✓
- Visual 2.5D + bloom + niebla + árboles → Task 5. ✓
- Marco circular (lente) → Task 6. ✓
- Sonido híbrido (cama + drone + pentatónica) + limiter −3 dB → Tasks 4, 7, 8. ✓
- Mapeo profundidad/posición → pentatónica → Task 4 (`flashToFreq` por `y`). ✓
- Interacción (mouse + shake) → Task 9. ✓
- Panel de dev → Task 10. ✓
- Estructura Vite + cómo correr → Tasks 1, 11. ✓
- Testing del núcleo determinista → Tasks 2, 4. ✓
- Módulos `sim/*` y `audio/scale.js` puros (sin three/tone/DOM) → respetado en Tasks 2–4, 8, 9. ✓
- No push en ninguna tarea → todos los commits son locales. ✓

Fuera de alcance (declarado en spec): export a `.avi`/loop, agentes LLM/TTS, multi-tema. No se planifican aquí.
```
