# Mundo CIUDAD + descomposición fina del engine — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extraer los 5 módulos de engine que quedaron inline en `scene.js` (refactor puro, bosque idéntico) y luego construir el mundo CIUDAD (`city`) real encima de `stage.js` + `engine/*`.

**Architecture:** `stage.js` (ya en main) da rig+postfx. La Fase A mueve `points/agents3d/trails/weather/haze` de `scene.js` a `src/render/engine/*` sin cambiar lógica. La Fase B añade `src/render/city.js` que compone `createStage` + `engine/*` + terreno urbano de paridad, con edificios transparentes en capas (additive + wireframe matrix + puntos).

**Tech Stack:** Vanilla JS ESM, three@0.169 (sin deps nuevas), Vitest, Vite.

## Global Constraints

- **Sin deps nuevas.** Solo `three` y lo ya presente.
- **Tests:** `npx vitest run --exclude '**/.claude/**'` (24 tests; sin el exclude vitest recorre los worktrees y cuenta 96). El build es `npm run build`.
- **Contrato del builder (invariante):** `create<World>Scene(container, cfg, agentNames)` → `{ update(swarm, dt, eco), resize, flash(v), scare(strength), dispose }`.
- **Fase A = refactor puro:** el bosque (`land`, mundo default) debe quedar **visual y funcionalmente idéntico**. Mover código verbatim; sin cambios de lógica. Verificar con screenshot antes/después.
- **`stage.js` NO se toca. `scene.js` NO se renombra** (evita conflicto con AGUA/CÉLULA).
- **Commits locales** en `feat/world-city`. **NUNCA** `git push` / PR / merge sin OK explícito del usuario (regla del proyecto). Los pasos "Commit" son commits locales.
- **Paridad:** valores exactos del bundle en `docs/superpowers/specs/2026-08-11-mapa-otros-mundos.md` §3 y del spec de diseño `docs/superpowers/specs/2026-08-10-world-city-design.md`. No estimar.
- **Firmas de `engine/*`:** las de este plan son el contrato compartido con AGUA/CÉLULA. Si cambian durante la implementación, avisar a esas sesiones (`mcp__ccd_session_mgmt__send_message`).

---

# FASE A — Descomposición fina del engine (refactor puro)

Referencia de líneas: sobre `src/render/scene.js` **post-rebase** (1630 líneas, ya
consume `createStage`). Antes de cada extracción, `grep -n` para confirmar rangos, porque
extracciones previas de esta misma fase desplazan los números.

### Task 1: [A1] `engine/haze.js` — halo aditivo de color del mundo

**Files:**
- Create: `src/render/engine/haze.js`
- Modify: `src/render/scene.js` (bloque haze ~L1024-1068 del original; buscar con grep)

**Interfaces:**
- Produces: `createHaze(scene, { R, G, count, color, alpha, heightFn }) → { uniforms }`
  donde `color` es `[r,g,b]` (0–1), `heightFn(x,z) → y` da la altura base del terreno,
  `uniforms` expone `{ uProj, uColor, uAlpha }` para el resize hook y el update por hora.

- [ ] **Step 1: Localizar el bloque haze en scene.js**

Run: `grep -n "NEBLINA aditiva\|hazeUniforms\|rc.hazeCount\|rc.hazeColor" src/render/scene.js`
Expected: encuentra el bloque `// ─── NEBLINA aditiva ...` con `hazeUniforms` y el `THREE.Points` aditivo.

- [ ] **Step 2: Crear `src/render/engine/haze.js`**

Estructura (mover el shader/uniforms verbatim; parametrizar lo que hoy lee de `rc`/`R`/`G`):

```js
import * as THREE from 'three'

// Halo aditivo: nube de puntos que tiñe el aire con el color del mundo.
// Parametrizado por extent (R), suelo (G), color, densidad y la altura del terreno.
export function createHaze(scene, { R, G, count, color, alpha, heightFn }) {
  const hazeUniforms = {
    uProj: { value: 1000 },
    uColor: { value: new THREE.Vector3(color[0], color[1], color[2]) },
    uAlpha: { value: alpha },
  }
  const pos = [], siz = []
  for (let i = 0; i < count; i++) {
    const a = Math.random() * 6.2832
    const rr = Math.sqrt(Math.random()) * R * 0.92
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr
    pos.push(x, G + heightFn(x, z) + 0.3 + Math.random() * 9, z)
    siz.push(2.4 + Math.random() * 5.2)
  }
  // ... (mover verbatim la geometría + ShaderMaterial aditivo del bloque de scene.js) ...
  return { uniforms: hazeUniforms }
}
```

Mover el `THREE.BufferGeometry` + `ShaderMaterial` (blending Additive) + `THREE.Points` verbatim desde scene.js; sustituir `rc.hazeCount`→`count`, `rc.hazeColor`→`color`, `rc.hazeAlpha`→`alpha`, `R`→`R`, `G + terrainHeight(...)`→`G + heightFn(...)`.

- [ ] **Step 3: Rewire scene.js**

Reemplazar el bloque inline por:

```js
import { createHaze } from './engine/haze.js'
// ...
const hazeUniforms = createHaze(scene, {
  R, G, count: rc.hazeCount, color: rc.hazeColor, alpha: rc.hazeAlpha,
  heightFn: terrainHeight,
}).uniforms
```

Confirmar que el resto de scene.js sigue usando `hazeUniforms.uProj`, `hazeUniforms.uColor`, `hazeUniforms.uAlpha` (en el resize hook y en `update`). No cambiar esas referencias.

- [ ] **Step 4: Build + tests + parity**

Run: `npm run build && npx vitest run --exclude '**/.claude/**'`
Expected: build OK, 24 tests PASS.
Run (visual): `npm run dev`, abrir el mundo `land`, confirmar el halo idéntico (screenshot). Consola sin errores.

- [ ] **Step 5: Commit (local)**

```bash
git add src/render/engine/haze.js src/render/scene.js
git commit -m "Extract haze into engine/haze.js"
```

---

### Task 2: [A2] `engine/weather.js` — lluvia + nieve + caps

**Files:**
- Create: `src/render/engine/weather.js`
- Modify: `src/render/scene.js` (bloques RAIN ~L1324-1362, SNOW ~L1364-1409, caps ~L1411-1429)

**Interfaces:**
- Produces:
  - `createRain(scene, R, G) → { mesh, update(dt, intensity) }`
  - `createSnow(scene, R, G) → { mesh, update(dt, clockT, intensity) }`
  - `createSnowCaps(scene, capPos, uProjUniform) → { setCover(v) }`
  donde `capPos` es un `number[]` de posiciones (x,y,z) y `uProjUniform` es el `{ value }` de `uProj` que comparte resolución.

- [ ] **Step 1: Localizar bloques**

Run: `grep -n "LLUVIA\|RAIN_N\|updateRain\|NIEVE:\|SNOW_N\|updateSnow\|capUniforms\|Nieve acumulada" src/render/scene.js`

- [ ] **Step 2: Crear `src/render/engine/weather.js`**

Tres factories. Mover verbatim los cuerpos (geometrías, materiales, shaders, funciones `updateRain`/`updateSnow` y el bloque de caps). Parametrizar `R` (extent) y `G` (groundY); hoy están hardcodeados vía `R`/`G` del closure.

```js
import * as THREE from 'three'

export function createRain(scene, R, G) {
  const RAIN_N = 1400, RAIN_H = 46
  // ... mover verbatim rainPos/rainTop/rainGeom/rainMat/rainMesh ...
  function update(dt, intensity) { /* mover verbatim updateRain, usando R y G */ }
  return { mesh: rainMesh, update }
}

export function createSnow(scene, R, G) {
  const SNOW_N = 5000, SNOW_H = 46
  // ... mover verbatim snowPos/snowPhase/snowGeom/snowMat/snowMesh ...
  function update(dt, clockT, intensity) { /* mover verbatim updateSnow */ }
  return { mesh: snowMesh, update }
}

export function createSnowCaps(scene, capPos, uProjUniform) {
  const capUniforms = { uProj: uProjUniform, uCap: { value: 0 } }
  // ... mover verbatim capGeom/capMat/capMesh ...
  return { setCover(v) { capUniforms.uCap.value = v } }
}
```

- [ ] **Step 3: Rewire scene.js**

```js
import { createRain, createSnow, createSnowCaps } from './engine/weather.js'
// ...
const rain = createRain(scene, R, G)
const snow = createSnow(scene, R, G)
const caps = createSnowCaps(scene, capPos, pointUniforms.uProj)
```

En `update`, sustituir `updateRain(step, ...)`→`rain.update(step, ...)`, `updateSnow(step, clock, ...)`→`snow.update(step, clock, ...)`, y `capUniforms.uCap.value = snowCover`→`caps.setCover(snowCover)`. `capPos` se sigue llenando durante la construcción del terreno (rocas/árboles) ANTES de llamar a `createSnowCaps` — verificar el orden.

- [ ] **Step 4: Build + tests + parity**

Run: `npm run build && npx vitest run --exclude '**/.claude/**'`
Expected: build OK, 24 PASS. Visual: forzar lluvia/nieve (o esperar clima) en `land`, confirmar idéntico.

- [ ] **Step 5: Commit**

```bash
git add src/render/engine/weather.js src/render/scene.js
git commit -m "Extract rain/snow/caps into engine/weather.js"
```

---

### Task 3: [A3] `engine/agents3d.js` — constructores de agente + motion

**Files:**
- Create: `src/render/engine/agents3d.js`
- Modify: `src/render/scene.js` (helpers `fatLine/edgesOf/ringLoop/creature/wedge` ~L1070-1145, y el bloque roll/glide/spin del `update` ~L1629-1655)

**Interfaces:**
- Produces:
  - `createAgentKit(rc) → { fatLine(positions, color), edgesOf(geometry, color), ringLoop(radius, segments, color), creature(t), wedge(e), pick(arr), fatMaterials, setResolution(w, h) }`
    - `setResolution(w, h)` itera `fatMaterials` internamente (`m.resolution.set(w, h)`), para que el mundo no toque el array desde su resize hook. `fatMaterials` queda expuesto igual (compat).
  - `updateAgentMotion(agents, roamers, R, step, worldPos, tmp)` donde `tmp = { up, dir, axis, q }` (vectores/quaternion reutilizables) y cada `agent` tiene `{ group, cage, kind, baseScale, effR, rollMul, glide, spinY }`.
    - **GARANTÍA (pedido de CÉLULA):** las ramas de movimiento se leen SOLO de flags del agente (`rollMul`, `glide`, `spinY`, `cage`), **nunca** de `kind==='cyan'` u otros nombres de especie del bosque. Así cualquier mundo compone movimiento seteando flags. El código actual de `scene.js` ya es flag-driven; mantenerlo así al mover. `R` se usa solo para ESCALAR velocidad (`r.vx*R`), nunca para recortar posición (sin contención circular).

- [ ] **Step 1: Localizar helpers y el bloque de motion**

Run: `grep -n "function fatLine\|function edgesOf\|function ringLoop\|function creature\|function wedge\|const pick\|a.glide\|a.rollMul\|premultiply" src/render/scene.js`

- [ ] **Step 2: Crear `src/render/engine/agents3d.js`**

```js
import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { PALETTE } from '../../config.js'

// Kit de geometría de agente: jaulas de aristas gruesas + criatura molecular.
export function createAgentKit(rc) {
  const fatMaterials = []
  function fatLine(positions, color) { /* mover verbatim */ }
  function edgesOf(geometry, color) { /* mover verbatim */ }
  function ringLoop(radius, segments, color) { /* mover verbatim */ }
  function creature(t) { /* mover verbatim (usa PALETTE) */ }
  function wedge(e) { /* mover verbatim */ }
  const pick = (arr) => arr[(Math.random() * arr.length) | 0]
  return { fatLine, edgesOf, ringLoop, creature, wedge, pick, fatMaterials }
}

const _up = new THREE.Vector3(0, 1, 0)
export function updateAgentMotion(agents, roamers, R, step, worldPos, tmp) {
  // mover verbatim el for-loop de roll/glide/spin + pulse del update de scene.js,
  // usando tmp.dir/tmp.axis/tmp.q en vez de los locales _dir/_axis/_q.
}
```

Mover los cuerpos verbatim. `creature`/`wedge` usan `PALETTE` (importado). El pulso de escala (`a.cage.scale.setScalar(pulse)`) que hoy vive en el mismo loop se mueve con él; `updateAgentMotion` recibe `swarm.flash` vía… — **nota:** el pulso usa `swarm.flash[i]`. Pasar `swarm` no encaja en la firma. Decisión: dejar el pulso de escala FUERA de `updateAgentMotion` (queda en el `update` del mundo, es barato y depende de `swarm`), y `updateAgentMotion` solo hace posición+rotación. Ajustar el spec de la firma si hace falta.

- [ ] **Step 3: Rewire scene.js**

```js
import { createAgentKit, updateAgentMotion } from './engine/agents3d.js'
// ...
const kit = createAgentKit(rc)
const { fatLine, edgesOf, ringLoop, creature, wedge, pick } = kit
```

Eliminar las definiciones locales de esos helpers y de `_up`. En `update`, reemplazar el loop de rotación por `updateAgentMotion(agents, roamers, R, step, worldPos, tmp)` (crear `const tmp = { up: _up, dir: _dir, axis: _axis, q: _q }` una vez), y dejar el loop del pulso de escala (`pulse`) donde está. En el resize hook, sustituir `for (const m of fatMaterials) m.resolution.set(w*dpr, h*dpr)` por `kit.setResolution(w * dpr, h * dpr)`.

- [ ] **Step 4: Build + tests + parity**

Run: `npm run build && npx vitest run --exclude '**/.claude/**'`
Expected: build OK, 24 PASS. Visual: agentes del bosque idénticos (jaulas, giro, rodado, planeo). Screenshot.

- [ ] **Step 5: Commit**

```bash
git add src/render/engine/agents3d.js src/render/scene.js
git commit -m "Extract agent geometry + motion into engine/agents3d.js"
```

---

### Task 4: [A4] `engine/points.js` — sistema de puntos tamaño-mundo + DOF

**Files:**
- Create: `src/render/engine/points.js`
- Modify: `src/render/scene.js` (acumuladores `pushLine/pushPoint` ~L108-120, shader de puntos ~L960-1022, subida de líneas de flora ~L950-965)

**Interfaces:**
- Produces (build-time, estático): `createDraw(rc) → { pushPoint(x,y,z,col,size,phase), pushLine(x1,y1,z1,x2,y2,z2,c1,c2), pointMaterial, uniforms, finalizePoints(scene), finalizeLines(scene, material) }` donde `uniforms = { uProj, uT, uFocus, uAperture }`.
- Produces (**dinámico, per-frame** — pedido de CÉLULA, DRYea estelas+bichos ya hechos a mano):
  - `createPointCloud(count, material) → { mesh, pos: Float32Array, col: Float32Array, size: Float32Array, phase: Float32Array, commit() }` — buffers preasignados (`count` puntos, atributos `position`/`hcol`/`hsize`/`hphs`); el consumidor escribe en `pos/col/size/phase` y llama `commit()` para subir (`needsUpdate`). `mesh.frustumCulled = false`.
  - `createLineBuffer(maxSegments, material) → { mesh, begin(), push(x1,y1,z1,x2,y2,z2,c1,c2), commit() }` — buffer de líneas preasignado (`maxSegments*2` vértices, atributos `position`/`color`); `begin()` resetea el cursor, `push` añade un segmento, `commit()` sube el rango usado y ajusta `geometry.setDrawRange(0, usados)`. Para contornos redibujados cada frame (membrana/citoesqueleto de célula).

- [ ] **Step 1: Localizar acumuladores, material y subidas**

Run: `grep -n "const linePos\|const ptPos\|function pushLine\|function pushPoint\|Shader de puntos\|pointUniforms\|floraMat\|Subir buffers" src/render/scene.js`

- [ ] **Step 2: Crear `src/render/engine/points.js`**

```js
import * as THREE from 'three'

// Sistema de dibujo tamaño-mundo: un buffer de líneas (flora) y uno de puntos
// (con shader propio de tamaño-mundo + DOF falso + balanceo de vegetación).
export function createDraw(rc) {
  const linePos = [], lineCol = []
  const ptPos = [], ptCol = [], ptSize = [], ptPhase = []
  function pushLine(x1, y1, z1, x2, y2, z2, c1, c2) { /* verbatim */ }
  function pushPoint(x, y, z, col, size, phase) { /* verbatim */ }

  const uniforms = {
    uProj: { value: 1000 }, uT: { value: 0 },
    uFocus: { value: rc.dofFocus }, uAperture: { value: rc.dofAperture },
  }
  const pointMaterial = new THREE.ShaderMaterial({ /* verbatim: uniforms, shaders */ })

  function finalizeLines(scene, material) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePos), 3))
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(lineCol), 3))
    scene.add(new THREE.LineSegments(geo, material))
    return geo
  }
  function finalizePoints(scene) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ptPos), 3))
    geo.setAttribute('hcol', new THREE.BufferAttribute(new Float32Array(ptCol), 3))
    geo.setAttribute('hsize', new THREE.BufferAttribute(new Float32Array(ptSize), 1))
    geo.setAttribute('hphs', new THREE.BufferAttribute(new Float32Array(ptPhase), 1))
    const pts = new THREE.Points(geo, pointMaterial)
    pts.frustumCulled = false
    scene.add(pts)
  }
  return { pushPoint, pushLine, pointMaterial, uniforms, finalizePoints, finalizeLines }
}

// Nube de puntos DINÁMICA (per-frame): buffers preasignados, el consumidor
// escribe y llama commit(). DRYea las estelas y los bichos del bosque.
export function createPointCloud(count, material) {
  const pos = new Float32Array(count * 3)
  const col = new Float32Array(count * 3)
  const size = new Float32Array(count)
  const phase = new Float32Array(count)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('hcol', new THREE.BufferAttribute(col, 3))
  geo.setAttribute('hsize', new THREE.BufferAttribute(size, 1))
  geo.setAttribute('hphs', new THREE.BufferAttribute(phase, 1))
  const mesh = new THREE.Points(geo, material)
  mesh.frustumCulled = false
  function commit() {
    geo.attributes.position.needsUpdate = true
    geo.attributes.hcol.needsUpdate = true
    geo.attributes.hsize.needsUpdate = true
    geo.attributes.hphs.needsUpdate = true
  }
  return { mesh, pos, col, size, phase, commit }
}

// Buffer de líneas DINÁMICO: contornos redibujados cada frame (membrana/citoesqueleto).
export function createLineBuffer(maxSegments, material) {
  const pos = new Float32Array(maxSegments * 6)
  const col = new Float32Array(maxSegments * 6)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const mesh = new THREE.LineSegments(geo, material)
  mesh.frustumCulled = false
  let cur = 0
  function begin() { cur = 0 }
  function push(x1, y1, z1, x2, y2, z2, c1, c2) {
    if (cur >= maxSegments) return
    const p = cur * 6, c = cur * 6
    pos[p] = x1; pos[p+1] = y1; pos[p+2] = z1; pos[p+3] = x2; pos[p+4] = y2; pos[p+5] = z2
    col[c] = c1[0]; col[c+1] = c1[1]; col[c+2] = c1[2]
    col[c+3] = c2[0]; col[c+4] = c2[1]; col[c+5] = c2[2]
    cur++
  }
  function commit() {
    geo.setDrawRange(0, cur * 2)
    geo.attributes.position.needsUpdate = true
    geo.attributes.color.needsUpdate = true
  }
  return { mesh, begin, push, commit }
}
```

Mover el `ShaderMaterial` de puntos (vertex+fragment) verbatim. `createPointCloud`/`createLineBuffer` son exports independientes (no usan los acumuladores de `createDraw`; reciben el `material` del consumidor).

- [ ] **Step 3: Rewire scene.js**

```js
import { createDraw } from './engine/points.js'
// ...
const draw = createDraw(rc)
const { pushPoint, pushLine, pointMaterial, uniforms: pointUniforms } = draw
```

Sustituir el material local `pointMat`→`pointMaterial` (en trails y donde se use). La flora del bosque: `draw.finalizeLines(scene, floraMat)` (crear `floraMat = new THREE.LineBasicMaterial({ vertexColors:true, fog:true })`, meterlo en `snowMats`). Los puntos: `draw.finalizePoints(scene)`. Verificar que `pointUniforms.uProj`/`uT` se siguen animando y que el resize hook actualiza `pointUniforms.uProj`.

- [ ] **Step 4: Test unitario de los buffers dinámicos**

```js
// test/pointsBuffers.test.js
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { createPointCloud, createLineBuffer } from '../src/render/engine/points.js'

describe('createLineBuffer', () => {
  it('ajusta drawRange al nº de segmentos empujados', () => {
    const buf = createLineBuffer(10, new THREE.LineBasicMaterial())
    buf.begin()
    buf.push(0,0,0, 1,1,1, [1,0,0], [0,1,0])
    buf.push(1,1,1, 2,2,2, [0,0,1], [1,1,0])
    buf.commit()
    expect(buf.mesh.geometry.drawRange.count).toBe(4) // 2 segmentos * 2 vértices
  })
  it('no desborda por encima de maxSegments', () => {
    const buf = createLineBuffer(1, new THREE.LineBasicMaterial())
    buf.begin(); buf.push(0,0,0,1,1,1,[1,1,1],[1,1,1]); buf.push(0,0,0,1,1,1,[1,1,1],[1,1,1])
    buf.commit()
    expect(buf.mesh.geometry.drawRange.count).toBe(2)
  })
})

describe('createPointCloud', () => {
  it('preasigna buffers del tamaño pedido y commit no lanza', () => {
    const pc = createPointCloud(5, new THREE.PointsMaterial())
    expect(pc.pos).toHaveLength(15)
    expect(pc.size).toHaveLength(5)
    pc.pos[0] = 3; pc.commit()
    expect(pc.mesh.geometry.attributes.position.array[0]).toBe(3)
  })
})
```

Run: `npx vitest run test/pointsBuffers.test.js`
Expected: PASS (three corre en node para geometría/buffers; no requiere WebGL).

- [ ] **Step 5: Build + tests + parity**

Run: `npm run build && npx vitest run --exclude '**/.claude/**'`
Expected: build OK, 24 (+3 nuevos = 27) PASS. Visual: pasto/flores/puntos/DOF del bosque idénticos.

- [ ] **Step 6: Commit**

```bash
git add src/render/engine/points.js test/pointsBuffers.test.js src/render/scene.js
git commit -m "Extract world-size point system + dynamic buffers into engine/points.js"
```

---

### Task 5: [A5] `engine/trails.js` — estelas

**Files:**
- Create: `src/render/engine/trails.js`
- Modify: `src/render/scene.js` (setup ~L1219-1240, update ~L1677-1691)

**Interfaces:**
- Produces: `createTrails(scene, n, agentColors, rc, pointMaterial) → { update(worldPos) }`

- [ ] **Step 1: Localizar**

Run: `grep -n "ESTELAS\|const TRAIL\|tPos\|tHead\|trailGeom" src/render/scene.js`

- [ ] **Step 2: Crear `src/render/engine/trails.js`**

```js
import * as THREE from 'three'
import { createPointCloud } from './points.js'

// Estelas: puntos tamaño-mundo que persisten y se desvanecen. Reusa el material
// de puntos del mundo (mismo shader de tamaño-mundo + DOF) y el buffer dinámico
// preasignado de points.js (mismo camino que los bichos).
export function createTrails(scene, n, agentColors, rc, pointMaterial) {
  const TRAIL = rc.trailLen
  const cloud = createPointCloud(n * TRAIL, pointMaterial)
  const { pos: tPos, col: tCol, size: tSize } = cloud
  const tmpC = new THREE.Color()
  for (let i = 0; i < n; i++) { /* verbatim: pintar tCol por individuo con agentColors */ }
  scene.add(cloud.mesh)
  let tHead = 0, tFrame = 0
  function update(worldPos) {
    // verbatim: fade de tSize + siembra cada 7 frames en tPos/tSize, luego:
    cloud.commit()
  }
  return { update }
}
```

Nota: `createPointCloud` reemplaza el `trailGeom`+`THREE.Points` hechos a mano; el fade y la siembra se mueven verbatim, escribiendo en `tPos`/`tSize` (los arrays que expone el cloud) y cerrando con `cloud.commit()`.

- [ ] **Step 3: Rewire scene.js**

```js
import { createTrails } from './engine/trails.js'
// ...
const trails = createTrails(scene, n, AGENT_COLORS, rc, pointMaterial)
```

En `update`, reemplazar el bloque de estelas por `trails.update(worldPos)`.

- [ ] **Step 4: Build + tests + parity**

Run: `npm run build && npx vitest run --exclude '**/.claude/**'`
Expected: build OK, 24 PASS. Visual: estelas idénticas. **Este es el cierre de la Fase A: `scene.js` no debe tener ya ningún sistema genérico inline; comparar screenshot integral del bosque contra `main`.**

- [ ] **Step 5: Commit**

```bash
git add src/render/engine/trails.js src/render/scene.js
git commit -m "Extract trails into engine/trails.js"
```

- [ ] **Step 6: Avisar a las sesiones hermanas**

Enviar por `mcp__ccd_session_mgmt__send_message` a AGUA (`local_ac69e1ea-...`) y CÉLULA (`local_63e58f81-...`): "Fase A en `feat/world-city`, firmas de `engine/*` CONFIRMADAS (sin cambios respecto a las propuestas / con estos cambios: …). Rebasen cuando esté en main."

---

# FASE B — Mundo CIUDAD

### Task 6: [B1] `CITY_CENSUS` (TDD, puro)

**Files:**
- Modify: `src/sim/agents.js` (añadir export `CITY_CENSUS`)
- Test: `test/census.test.js` (create)

**Interfaces:**
- Produces: `CITY_CENSUS: Array<{ name, type, night?, dawn? }>` con `type ∈ {flying_animal, walking_animal, static_object, human}`.

- [ ] **Step 1: Test que falla**

```js
// test/census.test.js
import { describe, it, expect } from 'vitest'
import { CITY_CENSUS, createCensus } from '../src/sim/agents.js'

describe('CITY_CENSUS', () => {
  it('tiene solo tipos válidos y algún nocturno', () => {
    const types = new Set(['flying_animal', 'walking_animal', 'static_object', 'human'])
    expect(CITY_CENSUS.length).toBeGreaterThan(8)
    for (const a of CITY_CENSUS) expect(types.has(a.type)).toBe(true)
    expect(CITY_CENSUS.some((a) => a.night)).toBe(true)
  })
  it('createCensus asigna identidades urbanas a los visibles', () => {
    const { visible } = createCensus(CITY_CENSUS, 18)
    expect(visible).toHaveLength(18)
    const names = new Set(CITY_CENSUS.filter((a) => a.type !== 'static_object').map((a) => a.name))
    for (const v of visible) expect(names.has(v.name)).toBe(true)
  })
})
```

- [ ] **Step 2: Correr, ver fallar**

Run: `npx vitest run test/census.test.js`
Expected: FAIL (`CITY_CENSUS` undefined).

- [ ] **Step 3: Implementar**

Añadir a `src/sim/agents.js`:

```js
/** Censo de ciudad: fauna urbana + actores humanos (según ng.city del bundle). */
export const CITY_CENSUS = [
  { name: 'feral pigeon', type: 'flying_animal' },
  { name: 'carrion crow', type: 'flying_animal' },
  { name: 'magpie', type: 'flying_animal' },
  { name: 'herring gull', type: 'flying_animal' },
  { name: 'starling', type: 'flying_animal' },
  { name: 'peregrine falcon', type: 'flying_animal' },
  { name: 'swift', type: 'flying_animal' },
  { name: 'red fox', type: 'walking_animal', night: true },
  { name: 'brown rat', type: 'walking_animal', night: true },
  { name: 'grey squirrel', type: 'walking_animal' },
  { name: 'urban hedgehog', type: 'walking_animal', night: true },
  { name: 'the fountain', type: 'static_object' },
  { name: 'traffic hum', type: 'static_object' },
  { name: 'neon sign', type: 'static_object' },
  { name: 'skateboarder', type: 'human' },
  { name: 'cyclist', type: 'human' },
  { name: 'busker', type: 'human' },
  { name: 'market trader', type: 'human' },
  { name: 'tram', type: 'human' },
  { name: 'ambulance', type: 'human', night: true },
]
```

- [ ] **Step 4: Correr, ver pasar**

Run: `npx vitest run test/census.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/agents.js test/census.test.js
git commit -m "Add CITY_CENSUS with urban fauna and actors"
```

---

### Task 7: [B2] `cityLayout.js` — retícula de calles → bloques (TDD, puro)

**Files:**
- Create: `src/render/cityLayout.js`
- Test: `test/cityLayout.test.js`

**Interfaces:**
- Produces: `cityLayout({ Wt, Gt, streets }, rnd = Math.random) → { blocks: Array<{cx,cz,hx,hz}>, streetLines: Array<{ axis:'x'|'z', at:number }> }`
  - `blocks`: manzanas con centro `(cx,cz)` y semi-tamaños `(hx,hz)`, todas dentro de `[-Wt, Wt]²`.
  - `streetLines`: líneas de calle (para sembrar `paths` y el polvo `An`).

- [ ] **Step 1: Test que falla**

```js
// test/cityLayout.test.js
import { describe, it, expect } from 'vitest'
import { cityLayout } from '../src/render/cityLayout.js'

describe('cityLayout', () => {
  const Wt = 62, Gt = 13
  it('con streets=2 genera una grilla de bloques dentro del semilado', () => {
    const { blocks } = cityLayout({ Wt, Gt, streets: 2 }, mulberry(1))
    expect(blocks.length).toBeGreaterThanOrEqual(4) // 2x2 mínimo
    for (const b of blocks) {
      expect(b.hx).toBeGreaterThan(0); expect(b.hz).toBeGreaterThan(0)
      expect(Math.abs(b.cx) + b.hx).toBeLessThanOrEqual(Wt + 1e-6)
      expect(Math.abs(b.cz) + b.hz).toBeLessThanOrEqual(Wt + 1e-6)
    }
  })
  it('clampa el nº de calles a [1,4]', () => {
    const many = cityLayout({ Wt, Gt, streets: 99 }, mulberry(2))
    expect(many.blocks.length).toBeLessThanOrEqual(6 * 6)
  })
})
// PRNG determinista para el test
function mulberry(seed) {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
```

- [ ] **Step 2: Correr, ver fallar**

Run: `npx vitest run test/cityLayout.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `src/render/cityLayout.js`**

Lógica de paridad (`tn` del bundle, §3.1/§3.3): `n = clamp(round(streets),1,4)` cortes por eje; el otro eje puede tener `n + (rnd()<0.4?1:0)`; 50% de swap entre ejes. Los cortes dividen `[-Wt,Wt]` en franjas; las calles (ancho `Gt`) se restan; los bloques son los rectángulos entre calles.

```js
export function cityLayout({ Wt, Gt, streets }, rnd = Math.random) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  let nx = clamp(Math.round(streets), 1, 4)
  let nz = clamp(nx + (rnd() < 0.4 ? 1 : 0), 1, 4)
  if (rnd() < 0.5) { const t = nx; nx = nz; nz = t }
  // Posiciones de calle equiespaciadas por eje (excluye los bordes).
  const cuts = (n) => Array.from({ length: n }, (_, i) => -Wt + (2 * Wt) * (i + 1) / (n + 1))
  const xs = cuts(nx), zs = cuts(nz)
  const streetLines = [
    ...xs.map((at) => ({ axis: 'x', at })),
    ...zs.map((at) => ({ axis: 'z', at })),
  ]
  // Bordes de franja por eje: [-Wt, ...calles±Gt/2..., Wt] → intervalos de bloque.
  const spans = (cutsArr) => {
    const edges = [-Wt]
    for (const c of cutsArr) { edges.push(c - Gt / 2, c + Gt / 2) }
    edges.push(Wt)
    const out = []
    for (let i = 0; i < edges.length; i += 2) {
      const lo = edges[i], hi = edges[i + 1]
      if (hi - lo > 1) out.push({ c: (lo + hi) / 2, h: (hi - lo) / 2 })
    }
    return out
  }
  const sx = spans(xs), sz = spans(zs)
  const blocks = []
  for (const bx of sx) for (const bz of sz) {
    blocks.push({ cx: bx.c, cz: bz.c, hx: bx.h, hz: bz.h })
  }
  return { blocks, streetLines }
}
```

- [ ] **Step 4: Correr, ver pasar**

Run: `npx vitest run test/cityLayout.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/cityLayout.js test/cityLayout.test.js
git commit -m "Add pure city street/block layout generator"
```

---

### Task 8: [B3] `city.js` esqueleto + registry `ready:true`

**Files:**
- Create: `src/render/city.js`
- Modify: `src/worlds/registry.js`

**Interfaces:**
- Consumes: `createStage` (stage.js), `createDraw/createAgentKit/createTrails/createRain/createSnow/createSnowCaps/createHaze` (engine/*), `cityLayout`, `CITY_CENSUS`, sim puros (`createRoamers/updateRoamers`, `createBugs/...`, `createPerchers/...`, `createPaths/nearestOnPaths`).
- Produces: `createCityScene(container, cfg, agentNames) → { update, resize, flash, scare, dispose }`.

- [ ] **Step 1: Esqueleto mínimo que renderiza y es conmutable**

`src/render/city.js`: componer `stage`, un `createDraw`, y un suelo plano temporal (un `PlaneGeometry` gris a `we=-4`) para ver algo. `update` = mapear nada aún + `stage.render(step); return []`. `scare` no-op temporal. `resize/flash/dispose` desde `stage`.

```js
import * as THREE from 'three'
import { createStage } from './stage.js'
import { createDraw } from './engine/points.js'

const Wt = 62, Gt = 13, Kt = 2.4, we = -4
const R_CITY = Wt * 1.18

export function createCityScene(container, cfg, agentNames = []) {
  const rc = cfg.render
  const stage = createStage(container, cfg)
  const { scene } = stage
  const draw = createDraw(rc)
  // Suelo temporal (se reemplaza en B4).
  const g = new THREE.PlaneGeometry(Wt * 2.35, Wt * 2.35, 4, 4)
  g.rotateX(-Math.PI / 2)
  const ground = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x20242c, fog: true }))
  ground.position.y = we
  scene.add(ground)
  stage.setResizeHook((m) => { draw.uniforms.uProj.value = m.proj })
  function update() { stage.render(0.016); return [] }
  function scare() {}
  return { update, resize: stage.resize, flash: stage.flash, scare, dispose: stage.dispose }
}
```

- [ ] **Step 2: Wire registry**

En `src/worlds/registry.js`: importar `createCityScene` y `CITY_CENSUS`; cambiar la entrada `city` a:

```js
import { createCityScene } from '../render/city.js'
import { FOREST_CENSUS, CITY_CENSUS } from '../sim/agents.js'
// ...
{
  id: 'city', label: 'Block ecosystem', accent: '#fab75e', ready: true,
  census: CITY_CENSUS,
  build: (container, cfg, names) => createCityScene(container, cfg, names),
},
```

- [ ] **Step 3: Build + verificar conmutación**

Run: `npm run build && npx vitest run --exclude '**/.claude/**'`
Expected: build OK, 24 PASS.
Visual: `npm run dev`; `window.setScene('city')` (o dot naranja) muestra el suelo gris urbano; volver a `land` funciona sin errores de consola ni doble canvas.

- [ ] **Step 4: Commit**

```bash
git add src/render/city.js src/worlds/registry.js
git commit -m "Wire real city world skeleton into registry"
```

---

### Task 9: [B4] suelo `pn` matrix + calles

**Files:** Modify `src/render/city.js`.

**Interfaces:**
- Produces (dentro del módulo): `terrainHeight(x,z)`, `layout` (de `cityLayout`), y el suelo con look matrix.

- [ ] **Step 1: Implementar suelo + calles**

Reemplazar el suelo temporal por: `layout = cityLayout({ Wt, Gt, streets: Math.round(cfg... ) }, rnd)` — nota: `p.streets=2` en el bundle; usar `2` (no está en CONFIG; añadir `city: { streets: 2, towers: 1 }` a config o hardcodear la constante de paridad en city.js con comentario). Grid 150×150 sobre lado `Wt*2.35`. Altura por vértice: `we + (Kt + noise) * mask`, donde `mask(x,z)=1` sobre bloque y `0` sobre calle (usar `layout` para saber si `(x,z)` cae en calle: dentro de `±Gt/2` de alguna `streetLine`). Color del suelo: gris urbano tenue con vertexColors. Añadir wireframe matrix (`WireframeGeometry`, `LineBasicMaterial` opacity ~0.12) + nube de puntos mate vía `draw.pushPoint` (como el suelo del bosque).

Valores/patrón: seguir el bloque SUELO de `scene.js` (SEGS, wireframe, puntos) adaptando la altura y el color a ciudad. Usar `fbm`/`noise2` de `./noise.js` para el ruido del bordillo.

- [ ] **Step 2: Build + visual**

Run: `npm run build`
Visual: ciudad muestra retícula de calles hundidas + bloques elevados con look matrix (wireframe + puntos). Screenshot.

- [ ] **Step 3: Commit**

```bash
git add src/render/city.js
git commit -m "Add city ground grid (matrix) and street layout"
```

---

### Task 10: [B5] edificios `bn`/`yn` — transparentes en capas + glow + matrix (LA ESTRELLA)

**Files:** Modify `src/render/city.js`.

- [ ] **Step 1: Paleta + builder de torre**

Añadir la paleta `$t` (6 RGB exactos, §B.2). `buildTower(block, draw, scene, palette)`:
- Altura `H` y footprint `(w,d)` derivados de `min(hx,hz)` con jitter.
- `floors = clamp(round(H / gap), 3, ~20)`; por piso una `BoxGeometry(w*taper, slabThickness, d*taper)` a `y = we + Kt + i*gap`, con `taper` que decrece con la altura (setbacks).
- Material por losa: `MeshBasicMaterial({ color: tint, transparent:true, opacity: 0.10–0.16, blending: THREE.AdditiveBlending, depthWrite:false, fog:true })`.
- Por losa añadir `WireframeGeometry` (`LineBasicMaterial` opacity ~0.2, color tint atenuado) y un punto por vértice vía `draw.pushPoint` (matrix). Registrar la cima en `capPos` (nieve) y en `poiPerch`.
- Color de la losa: `rnd() < 0.66 ? blockTint : pick($t)`; `blockTint` se elige una vez por bloque de `$t`.

- [ ] **Step 2: `placeBuildings(layout)`** (`bn`)

Por cada `block`: `r = min(hx,hz)*2`; `prob = (r>=20?0.85 : r>=14?0.5 : 0.2) * towers` (towers=1); `if (rnd()<prob) buildTower(...)`; `if (r>=40 && rnd()<0.6*Math.min(towers,1.5)) buildTower(...)` (2ª torre desplazada).

- [ ] **Step 3: Build + tuning visual**

Run: `npm run build`
Visual: torres translúcidas en capas que **acumulan glow** y se funden con el suelo matrix. Afinar `opacity`, `gap`, `slabThickness`, `taper` en el navegador hasta el look deseado (más simple que el codepen, con capas que se mezclan). Screenshot antes/después de tuning.

- [ ] **Step 4: Commit**

```bash
git add src/render/city.js
git commit -m "Add layered translucent glowing buildings (matrix)"
```

---

### Task 11: [B6] `Sn` edificios bajos + `Cn` farolas + `wn` muebles + `Tn` charcos

**Files:** Modify `src/render/city.js`.

- [ ] **Step 1: Implementar los cuatro**

- `Sn`: 3–6 volúmenes-caja bajos, offset aleatorio dentro de un bloque al azar; mismo look de losa/matrix pero 1–2 pisos.
- `Cn`: 3–7 farolas = poste (`draw.pushLine`) + punto de luz (`draw.pushPoint`, tamaño mayor) con la paleta de 5 colores exacta (§B.2).
- `wn`: 1–3 muebles, dims `5.5+rnd()*1.5 × 3.4+rnd()*0.6`, cajas bajas translúcidas.
- `Tn`: charcos = planos horizontales grises `#B8BDC9` (vertexColors) en bordes de bloque, ligeramente sobre `we`, `MeshBasicMaterial` transparente con brillo deslizante opcional (shader simple tipo agua del bosque; o estático para simplicidad).

- [ ] **Step 2: Build + visual + Commit**

Run: `npm run build`; visual: farolas de colores, muebles, charcos grises en las orillas. Screenshot.

```bash
git add src/render/city.js
git commit -m "Add low buildings, streetlights, furniture and puddles"
```

---

### Task 12: [B7] `Dn` pasto (46 700) + `kn` flores + `An` polvo

**Files:** Modify `src/render/city.js`.

- [ ] **Step 1: Implementar los tres**

- `Dn` pasto: `Math.floor(46000*grass)+Math.floor(700*grass)` hojas (grass=1 → 46700), sembradas en las orillas de bloque/calle (no dentro de edificios). Reusar el sistema de pasto por líneas del bosque (adaptar el bloque PASTO de `scene.js`: 4 vértices/hoja, gradiente, `draw.pushLine` NO — el pasto usa su propio `LineSegments` con shader de viento; para simplicidad de paridad puede usarse el mismo `grassMat` shader del bosque, o `draw.pushLine` estático si se prefiere; decidir en implementación y anotar). **Guardar los parches de flores como `poiFlowers` para los bichos.**
- `kn` flores: por bloque `Math.round((8+rnd()*14)*flowers)` flores en el perímetro; reusar un helper `flower()` (portar el del bosque a un helper local o a `engine` si AGUA lo necesita — por ahora local en city.js).
- `An` polvo: 2400 puntos, `y = we + 0.25 + rnd()*2.4`, filtro `rnd() > Math.exp(-distToStreet/3)` (concentra cerca de calles), color naranja tenue, vía `draw.pushPoint`.

- [ ] **Step 2: Finalizar buffers**

Tras generar todo el terreno: `draw.finalizePoints(scene)` y, si se usa flora por líneas estáticas, `draw.finalizeLines(scene, floraMat)`.

- [ ] **Step 3: Build + visual + Commit**

Run: `npm run build`; visual: pasto en orillas, parches de flores, polvo naranja junto a calles. Screenshot.

```bash
git add src/render/city.js
git commit -m "Add city grass, flowers and street dust"
```

---

### Task 13: [B8] agentes (pool ciudad, escala, tráfico, calles) + estelas + bichos

**Files:** Modify `src/render/city.js`.

- [ ] **Step 1: Roster + geometría**

`createAgentKit(rc)`. Pool ciudad ponderado `[[whiteC,3],[cyanC,4],[flag,4],[dbl,3],[eye,2]]` → expandir a `n=cfg.fireflies.count` por muestreo ponderado. Construir cada agente reusando el ensamblado del bosque (portar el switch de especies del bosque a city.js, o a un helper compartido): `cyanC`=jaula cubo `PALETTE.cyan`; `whiteC`=jaula cubo `PALETTE.white`; `flag/dbl/eye` idénticos. Guardar `{ group, cage, kind, baseScale, effR, rollMul, glide, spinY, trafH }`.

- [ ] **Step 2: Escala + tráfico + mapeo**

`baseScale *= 0.67`. `trafH = ({whiteC:3.2,cyanC:3.2,eye:3,flag:2.72,dbl:1.5}[kind]||2.4) * baseScale`. `mapPositions(dt)`: `createRoamers(cfg.wander, n, rnd)` (con `paths` desde `layout.streetLines`, `pathPull` mayor), `worldPos[i].y = we + Kt + trafH + perchOff`. Usar `updateAgentMotion(agents, roamers, R_CITY, step, worldPos, tmp)`.

- [ ] **Step 3: Estelas + bichos**

`createTrails(scene, n, AGENT_COLORS_CITY, rc, draw.pointMaterial)` con color de arista ciudad `en=[1,.23,.35]`. Bichos: `createBugs(cfg.bugs, poiFlowers, rnd)` + su render/update como el bosque (portar el bloque de bichos), cazadores incluidos.

- [ ] **Step 4: `paths` desde calles**

Construir `paths.loops` a partir de `layout.streetLines` (segmentos rectos a lo largo de cada calle) o usar `createPaths` con parámetros urbanos. Encauzar roamers con `pathPull` alto.

- [ ] **Step 5: Build + visual + Commit**

Run: `npm run build && npx vitest run --exclude '**/.claude/**'`; visual: agentes urbanos pequeños volando a altura de tráfico, siguiendo calles; estelas rojas; bichos hacia flores. Screenshot.

```bash
git add src/render/city.js
git commit -m "Add city agents (roster, scale, traffic height, street paths), trails and bugs"
```

---

### Task 14: [B9] clima/eco + haze naranja + scare + label + cierre

**Files:** Modify `src/render/city.js`.

- [ ] **Step 1: eco + FX**

`createHaze(scene, { R:R_CITY, G:we, count:rc.hazeCount, color:[1,0.48,0.12], alpha:rc.hazeAlpha, heightFn:()=>Kt })`. `createRain/createSnow(scene, R_CITY, we)`, `createSnowCaps(scene, capPos, draw.uniforms.uProj)`. En `update(swarm, dt, eco)`: portar del bosque el tinte de hora (aplicado a materiales de suelo/pasto), `scene.fog.density = 0.0009 + eco.fog*0.0028`, `hazeUniforms.uColor/uAlpha`, `rain.update`, `snow.update`, `caps.setCover`, `pointUniforms.uT = clock`, `moveScale`, el loop de pulso de escala de agentes, la etiqueta (usar `stage.metrics` + `stage.labelEl` como el bosque), y `stage.render(step)`. `return predations`.

- [ ] **Step 2: scare**

Portar `scare(strength)` del bosque (empujón radial a roamers + estampida de bichos).

- [ ] **Step 3: Build + tests + verificación de aceptación**

Run: `npm run build && npx vitest run --exclude '**/.claude/**'`
Expected: build OK, 24 (+2 nuevos = 26) PASS.
Visual (criterio de aceptación B): dot naranja / `window.setScene('city')` muestra la ciudad completa (calles + bloques + edificios en capas con glow + pasto/flores + farolas + charcos + polvo naranja + agentes urbanos siguiendo calles). Shake dispersa. Relámpagos con lluvia (via main.js). Volver a `land`/`water` sin leak (1 canvas), consola limpia. Screenshots.

- [ ] **Step 4: Commit**

```bash
git add src/render/city.js
git commit -m "Wire city weather, haze, scare and finalize world"
```

---

## Self-review (cobertura del spec)

- Fase A cubre los 5 módulos inline (points/agents3d/trails/weather/haze) → Tasks A1–A5. ✅
- Fase B: terreno `tn/pn/bn/Sn/Cn/wn/Tn/Dn/kn/An` → B2 (layout), B4 (pn+tn), B5 (bn), B6 (Sn/Cn/wn/Tn), B7 (Dn/kn/An). ✅
- Edificios transparentes en capas → B5. ✅
- Roster ciudad + escala + tráfico + calles → B8. ✅
- CITY_CENSUS → B1. ✅
- Clima/haze/scare/registry → B3 (registry), B9. ✅
- Ambigüedad conocida: en B7, si el pasto usa el shader de viento del bosque conviene extraer también ese sistema a engine (`grass.js`) — se deja como decisión de implementación; si se extrae, avisar a AGUA/CÉLULA. Alternativa simple: pasto estático vía `draw.pushLine`.
