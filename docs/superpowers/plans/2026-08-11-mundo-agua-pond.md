# Mundo AGUA (pond) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar el mundo AGUA (pond) de murmur-world: laguna con orilla lobulada, agua en
movimiento con reflejo, 6 especies acuáticas exclusivas, cardúmenes de peces (boids) y nieve
realista, montado sobre el engine de render compartido.

**Architecture:** `render/pond.js` compone el engine compartido `render/engine/*` (que extrae la
sesión de CIUDAD como refactor puro; ver spec §3). La lógica pura (boids de peces, censo) es
independiente del engine y se construye primero. La física de agua y el terreno son propios de pond.

**Tech Stack:** Three.js (LineSegments + Points + `THREE.Reflector`), shaders GLSL propios, Vitest
para el núcleo puro. Vite dev/build.

## Global Constraints

- Paridad de valores del spec `2026-08-11-mapa-otros-mundos.md` §4: `mt=64` (radio laguna),
  `ht=-3.4` (nivel agua), `gt=11` (prof. lóbulos), `R=85` (`cfg.world.radius`), niebla 4200 pts
  (radio `mt*1.28`), polvo 8500, juncos base ~736.
- **Colores murmur-exactos** (spec §4.2, literales) para las 6 especies; la "riqueza" añade densidad
  con la MISMA paleta, sin inventar colores.
- Módulos `sim/*` son PUROS: sin `three`, sin `tone`, sin DOM. Tests con `rand` inyectable.
- API del builder: `{ update(swarm,dt,eco)→predations, resize, flash(v), scare(strength), dispose }`.
- Nunca mezclar refactor con cambio de comportamiento en un commit (regla del repo).
- No `git push` / merge a main sin OK explícito del usuario en la sesión.
- Rama `feat/world-pond`. Commits en imperativo, cuerpo explica el porqué.

## Secuencia y bloqueos (LEER PRIMERO)

- **Fase 0 (Tareas 1–2): SIN bloqueo.** Núcleo puro (peces, censo, config). Ejecutable ya en
  `feat/world-pond`.
- **Engine — estado real (rebasado, main @ 93eae1c):**
  - ✅ **`src/render/stage.js` YA está en main** (`createStage(container, cfg)` → `{ scene, camera,
    renderer, controls, composer, labelEl, metrics, flash, resize, setResizeHook, render, dispose }`).
    Capa rig+postfx compartida. `render/pond.js` la usa directamente (Task 3).
  - ⛔ **Aún en `scene.js` (NO extraído):** `points/draw` (pointMat + pushPoint/pushLine), `agents3d`
    (geometrías + updateAgentMotion), `trails`, `weather` (rain/snow/caps), `haze` (+ niebla 4200 de
    agua). La descomposición fina `engine/*` la **lidera CIUDAD** — coordinar firmas con esa sesión.
- **Gate de contenido:** las Tareas 4–8 dependen de esas primitivas. Opciones cuando toque: (a)
  esperar el `engine/*` de CIUDAD (preferido por la coordinación acordada), o (b) copiar las
  primitivas desde `scene.js` a pond (duplicación que CIUDAD reconciliará — solo con OK del usuario).
  **Re-planificar en detalle 4–8** contra la API real cuando el `engine/*` aterrice.
- **Tests:** correr `npx vitest run --exclude '**/.claude/**'` (sin el flag, vitest recorre los
  worktrees hermanos y cuenta de más).

---

## FASE 0 — Núcleo puro (ejecutable ya)

### Task 1: Boids de peces (`sim/fish.js`)

**Files:**
- Create: `src/sim/fish.js`
- Test: `test/fish.test.js`

**Interfaces:**
- Consumes: nada (módulo puro autónomo).
- Produces:
  - `createSchools(cfg, rand = Math.random) → { fish: Fish[] }` donde
    `Fish = { x, z, y, vx, vz, vy, school }`. `x,z ∈ [-1,1]` (disco unidad, se escala en el render);
    `y` en unidades de mundo dentro de `[cfg.yMin, cfg.yMax]`.
  - `updateSchools(state, cfg, dt, rand = Math.random) → void` (muta `state.fish`).
  - `scatterFish(state, strength = 1, rand = Math.random) → void`.
  - `cfg` (bloque `fish`) esperado:
    ```js
    { schools:3, perSchool:30, spread:0.82, yMin:-13.5, yMax:-3.9,
      maxSpeed:0.06, sep:0.9, align:0.5, cohesion:0.4,
      sepRadius:0.05, neighborRadius:0.14, wander:0.5, turn:2.0 }
    ```

- [ ] **Step 1: Escribir el helper de test (rand determinista) y el primer test (createSchools respeta límites)**

`test/fish.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { createSchools, updateSchools, scatterFish } from '../src/sim/fish.js'

// LCG determinista para reproducibilidad.
function seeded(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
const CFG = {
  schools: 2, perSchool: 20, spread: 0.82, yMin: -13.5, yMax: -3.9,
  maxSpeed: 0.06, sep: 0.9, align: 0.5, cohesion: 0.4,
  sepRadius: 0.05, neighborRadius: 0.14, wander: 0.5, turn: 2.0,
}

describe('createSchools', () => {
  it('crea schools*perSchool peces dentro del disco y la banda de profundidad', () => {
    const { fish } = createSchools(CFG, seeded(1))
    expect(fish.length).toBe(CFG.schools * CFG.perSchool)
    for (const f of fish) {
      expect(Math.hypot(f.x, f.z)).toBeLessThanOrEqual(CFG.spread + 1e-9)
      expect(f.y).toBeGreaterThanOrEqual(CFG.yMin - 1e-9)
      expect(f.y).toBeLessThanOrEqual(CFG.yMax + 1e-9)
      expect(f.school).toBeGreaterThanOrEqual(0)
      expect(f.school).toBeLessThan(CFG.schools)
    }
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run test/fish.test.js -t createSchools`
Expected: FAIL — `createSchools is not a function` / módulo inexistente.

- [ ] **Step 3: Implementar `createSchools` en `src/sim/fish.js`**

```js
// Boids de peces para el mundo AGUA. Puro: sin three/DOM. Coords x,z en disco
// unidad [-1,1] (el render las escala al radio de laguna); y en unidades de
// mundo entre el lecho y la superficie. Cada pez pertenece a un `school` y solo
// interactúa (alineación/cohesión) con los de su mismo banco.

function inDisc(rand, spread) {
  const r = spread * Math.sqrt(rand())
  const a = rand() * Math.PI * 2
  return [Math.cos(a) * r, Math.sin(a) * r]
}

export function createSchools(cfg, rand = Math.random) {
  const fish = []
  for (let s = 0; s < cfg.schools; s++) {
    // Centro inicial del banco (disperso dentro del disco).
    const [cx, cz] = inDisc(rand, cfg.spread * 0.6)
    const cy = cfg.yMin + (cfg.yMax - cfg.yMin) * (0.25 + rand() * 0.5)
    for (let i = 0; i < cfg.perSchool; i++) {
      const [ox, oz] = inDisc(rand, 0.12)
      const x = Math.max(-cfg.spread, Math.min(cfg.spread, cx + ox))
      const z = Math.max(-cfg.spread, Math.min(cfg.spread, cz + oz))
      const y = Math.max(cfg.yMin, Math.min(cfg.yMax, cy + (rand() - 0.5) * 2))
      const a = rand() * Math.PI * 2
      const sp = cfg.maxSpeed * (0.3 + rand() * 0.5)
      fish.push({ x, z, y, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: (rand() - 0.5) * sp * 0.4, school: s })
    }
  }
  return { fish }
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run test/fish.test.js -t createSchools`
Expected: PASS.

- [ ] **Step 5: Test de límites tras muchos updates + implementar `updateSchools`**

Añadir a `test/fish.test.js`:
```js
describe('updateSchools', () => {
  it('mantiene a los peces dentro del disco y la banda tras 300 frames', () => {
    const rand = seeded(7)
    const state = createSchools(CFG, rand)
    for (let i = 0; i < 300; i++) updateSchools(state, CFG, 0.05, rand)
    for (const f of state.fish) {
      expect(Math.hypot(f.x, f.z)).toBeLessThanOrEqual(CFG.spread + 0.02)
      expect(f.y).toBeGreaterThanOrEqual(CFG.yMin - 0.05)
      expect(f.y).toBeLessThanOrEqual(CFG.yMax + 0.05)
    }
  })
})
```

Implementar en `src/sim/fish.js`:
```js
export function updateSchools(state, cfg, dt, rand = Math.random) {
  const F = state.fish
  const nr2 = cfg.neighborRadius * cfg.neighborRadius
  const sr2 = cfg.sepRadius * cfg.sepRadius
  for (let i = 0; i < F.length; i++) {
    const a = F[i]
    let sx = 0, sz = 0, sy = 0            // separación
    let ax = 0, az = 0, ay = 0, an = 0    // alineación
    let cx = 0, cz = 0, cy = 0, cn = 0    // cohesión
    for (let j = 0; j < F.length; j++) {
      if (j === i) continue
      const b = F[j]
      const dx = a.x - b.x, dz = a.z - b.z, dy = (a.y - b.y) * 0.1
      const d2 = dx * dx + dz * dz + dy * dy
      if (d2 < sr2 && d2 > 1e-9) { const inv = 1 / Math.sqrt(d2); sx += dx * inv; sz += dz * inv; sy += dy * inv }
      if (b.school !== a.school) continue
      if (d2 < nr2) {
        ax += b.vx; az += b.vz; ay += b.vy; an++
        cx += b.x; cz += b.z; cy += b.y; cn++
      }
    }
    // Fuerzas combinadas.
    let fx = sx * cfg.sep, fz = sz * cfg.sep, fy = sy * cfg.sep
    if (an) { fx += (ax / an) * cfg.align; fz += (az / an) * cfg.align; fy += (ay / an) * cfg.align }
    if (cn) { fx += (cx / cn - a.x) * cfg.cohesion; fz += (cz / cn - a.z) * cfg.cohesion; fy += (cy / cn - a.y) * cfg.cohesion * 0.1 }
    // Wander suave.
    fx += (rand() - 0.5) * cfg.wander; fz += (rand() - 0.5) * cfg.wander; fy += (rand() - 0.5) * cfg.wander * 0.3
    // Integración con giro limitado.
    a.vx += fx * cfg.turn * dt; a.vz += fz * cfg.turn * dt; a.vy += fy * cfg.turn * dt
    // Clamp de velocidad.
    const sp = Math.hypot(a.vx, a.vz, a.vy)
    if (sp > cfg.maxSpeed) { const k = cfg.maxSpeed / sp; a.vx *= k; a.vz *= k; a.vy *= k }
    a.x += a.vx * dt * 60 * 0.016; a.z += a.vz * dt * 60 * 0.016; a.y += a.vy * dt * 60 * 0.016
    // Límites: curva de vuelta al entrar en la orilla / tocar techo o lecho.
    const rr = Math.hypot(a.x, a.z)
    if (rr > cfg.spread) { const k = cfg.spread / rr; a.x *= k; a.z *= k; a.vx = -a.vx * 0.5; a.vz = -a.vz * 0.5 }
    if (a.y > cfg.yMax) { a.y = cfg.yMax; a.vy = -Math.abs(a.vy) }
    if (a.y < cfg.yMin) { a.y = cfg.yMin; a.vy = Math.abs(a.vy) }
  }
}
```

- [ ] **Step 6: Correr el test de límites — debe pasar**

Run: `npx vitest run test/fish.test.js -t updateSchools`
Expected: PASS.

- [ ] **Step 7: Test de cohesión + test de scatter, e implementar `scatterFish`**

Añadir a `test/fish.test.js`:
```js
function meanSpread(fish, school) {
  const g = fish.filter((f) => f.school === school)
  const cx = g.reduce((a, f) => a + f.x, 0) / g.length
  const cz = g.reduce((a, f) => a + f.z, 0) / g.length
  return g.reduce((a, f) => a + Math.hypot(f.x - cx, f.z - cz), 0) / g.length
}
function meanSpeed(fish) {
  return fish.reduce((a, f) => a + Math.hypot(f.vx, f.vz, f.vy), 0) / fish.length
}

describe('cohesión y scatter', () => {
  it('la cohesión reduce la dispersión media de un banco', () => {
    const rand = seeded(3)
    const cfg = { ...CFG, sep: 0, wander: 0, cohesion: 1.2, align: 0.2 }
    const state = createSchools(cfg, rand)
    const before = meanSpread(state.fish, 0)
    for (let i = 0; i < 120; i++) updateSchools(state, cfg, 0.05, rand)
    const after = meanSpread(state.fish, 0)
    expect(after).toBeLessThan(before)
  })
  it('scatterFish sube la velocidad media', () => {
    const rand = seeded(5)
    const state = createSchools(CFG, rand)
    const before = meanSpeed(state.fish)
    scatterFish(state, 1, rand)
    expect(meanSpeed(state.fish)).toBeGreaterThan(before)
  })
})
```

Implementar en `src/sim/fish.js`:
```js
export function scatterFish(state, strength = 1, rand = Math.random) {
  for (const f of state.fish) {
    const m = Math.hypot(f.x, f.z) || 1e-3
    const k = (0.5 + rand() * 0.8) * strength * 0.06
    f.vx += (f.x / m) * k + (rand() - 0.5) * k
    f.vz += (f.z / m) * k + (rand() - 0.5) * k
    f.vy += (rand() - 0.5) * k * 0.5
  }
}
```

- [ ] **Step 8: Correr toda la suite de peces — verde**

Run: `npx vitest run test/fish.test.js`
Expected: PASS (todos).

- [ ] **Step 9: Correr toda la suite del repo — sin regresiones**

Run: `npm test`
Expected: PASS (los ~27 previos + los nuevos).

- [ ] **Step 10: Commit**

```bash
git add src/sim/fish.js test/fish.test.js
git commit -m "Add fish boids for the pond world"
```

### Task 2: Censo de agua + bloque de config `pond`

**Files:**
- Modify: `src/sim/agents.js` (añadir `POND_CENSUS`)
- Modify: `src/config.js` (añadir bloque `pond`)
- Test: `test/agents.test.js` (o el archivo de census existente; si no hay, crear `test/pond-census.test.js`)

**Interfaces:**
- Consumes: `createCensus(source, visibleCount, rand)` (ya existe en `agents.js`).
- Produces: `POND_CENSUS` (array `{ name, type, night?, dawn? }`); `CONFIG.pond` (bloque de valores).

- [ ] **Step 1: Test de smoke del censo de agua**

Crear `test/pond-census.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { POND_CENSUS, createCensus } from '../src/sim/agents.js'

describe('POND_CENSUS', () => {
  it('tiene fauna de agua y produce agentes visibles', () => {
    const types = new Set(POND_CENSUS.map((a) => a.type))
    expect(types.has('flying_animal')).toBe(true)
    expect(types.has('walking_animal')).toBe(true)
    expect(POND_CENSUS.some((a) => a.name === 'grey heron')).toBe(true)
    const { visible } = createCensus(POND_CENSUS, 18)
    expect(visible.length).toBe(18)
    expect(visible.every((v) => v.name && v.type)).toBe(true)
  })
})
```

- [ ] **Step 2: Correr — falla (POND_CENSUS undefined)**

Run: `npx vitest run test/pond-census.test.js`
Expected: FAIL.

- [ ] **Step 3: Añadir `POND_CENSUS` en `src/sim/agents.js`** (tras `FOREST_CENSUS`)

```js
/** Censo del estanque, por tipo. Coherente con los SFX del shake de agua del bundle. */
export const POND_CENSUS = [
  // flying_animal (mayoría en un humedal)
  { name: 'grey heron', type: 'flying_animal' },
  { name: 'mute swan', type: 'flying_animal' },
  { name: 'greylag goose', type: 'flying_animal' },
  { name: 'coot', type: 'flying_animal' },
  { name: 'moorhen', type: 'flying_animal' },
  { name: 'mallard', type: 'flying_animal' },
  { name: 'kingfisher', type: 'flying_animal' },
  { name: 'great crested grebe', type: 'flying_animal' },
  { name: "cetti's warbler", type: 'flying_animal', dawn: true },
  { name: 'sedge warbler', type: 'flying_animal', dawn: true },
  { name: 'tufted duck', type: 'flying_animal' },
  { name: 'cormorant', type: 'flying_animal' },
  { name: 'reed bunting', type: 'flying_animal' },
  // walking_animal
  { name: 'water vole', type: 'walking_animal', night: true },
  { name: 'otter', type: 'walking_animal', night: true },
  { name: 'common frog', type: 'walking_animal' },
  { name: 'grass snake', type: 'walking_animal' },
  // static_object
  { name: 'the reedbed', type: 'static_object' },
  { name: 'still water', type: 'static_object' },
  { name: 'lily pads', type: 'static_object' },
  { name: 'midges over water', type: 'static_object' },
  // human
  { name: 'angler', type: 'human' },
  { name: 'kayaker', type: 'human' },
  { name: 'birdwatcher', type: 'human' },
]
```

- [ ] **Step 4: Añadir el bloque `pond` en `src/config.js`** (dentro de `CONFIG`)

```js
  pond: {
    lagoonRadius: 64,      // mt
    waterLevel: -3.4,      // ht (relativo a groundY)
    lobeDepth: 11,         // gt
    hazeCount: 4200,       // Bt (niebla exclusiva de agua)
    dustCount: 8500,       // Ut
    reedBase: 736,         // Vt base
    reedRichness: 3.0,     // factor de densidad extra
    waterReflection: true, // híbrido on; false = reflejo falso
    fish: {
      schools: 3, perSchool: 30, spread: 0.82, yMin: -13.5, yMax: -3.9,
      maxSpeed: 0.06, sep: 0.9, align: 0.5, cohesion: 0.4,
      sepRadius: 0.05, neighborRadius: 0.14, wander: 0.5, turn: 2.0,
    },
  },
```

- [ ] **Step 5: Correr el test — pasa**

Run: `npx vitest run test/pond-census.test.js`
Expected: PASS.

- [ ] **Step 6: Suite completa + build**

Run: `npm test && npm run build`
Expected: PASS / build sin errores.

- [ ] **Step 7: Commit**

```bash
git add src/sim/agents.js src/config.js test/pond-census.test.js
git commit -m "Add pond census and pond config block"
```

---

## FASE 1 — Render de pond (GATE: engine compartido en main)

> **Antes de empezar:** confirmar que `render/engine/*` está en main, `git rebase main`, y
> **re-planificar en detalle** cada tarea contra la API real del engine (firmas de fábrica). Abajo,
> el roadmap con el contenido conocido del spec; NO es código final (evita especular sobre la API).

### Task 3: Esqueleto `render/pond.js` + wire-up del registry — DESBLOQUEADO por `stage.js`
- Create `src/render/pond.js`: `createPond(container, cfg, agentNames)` que usa **`createStage`** para
  rig+postfx (escena/cámara/controls/composer/lente/label/flash/resize/dispose) y devuelve la API
  común, delegando `stage.render(step)`/`stage.flash`/`stage.resize`/`stage.dispose`. Uniforms
  dependientes de resolución vía `stage.setResizeHook(m => ...)`. Primer hito: una laguna vacía
  (plano de agua plano + niebla de escena) que renderiza sin errores. Las primitivas de contenido
  (points/agents/haze/weather) llegan en Tasks 4–8 (gate de contenido).
- Modify `src/worlds/registry.js`: `water` → `build: createPond`, `census: POND_CENSUS`,
  `ready: true`. Verificar `window.setScene('water')` en el navegador.
- Deliverable testeable: cambiar a `water` no crashea; `dispose` al volver a `land` no fuga.

### Task 4: Terreno (spec §4)
- Lóbulos de orilla (`lobeField`), lecho/orilla 110×110 con look matrix (wireframe + puntos),
  juncos/espadañas (~736 base × `reedRichness`), nenúfares/lirios (POI de libélulas), niebla 4200
  (radio `mt*1.28`) vía `engine/haze`, polvo 8500, piedras de ribera. Alturas del §2 del spec.

### Task 5: Superficie de agua híbrida (spec §5)
- Shader de olas (senos + fbm, normales animadas) + `THREE.Reflector` a media res con UV distorsionadas
  + mezcla con haze azul + glints; capa matrix sutil. Flag `cfg.pond.waterReflection` con degradado a
  reflejo falso. Reacción a `eco` (hora/lluvia).

### Task 6: Las 6 especies + física de agua (spec §4.2/§4.3)
- Constructores `lamp/ice/strider/orb/burst/pins` con colores literales, vía `engine/agents3d` (que
  debe permitir especies propias). Física dive/hover/roll en el `update()` de pond (altura objetivo,
  tope de lecho, cabeceo cerca de superficie). Selección ponderada `[[lamp,2],[ice,3],[strider,3],
  [orb,2],[burst,3],[pins,2]]`.

### Task 7: Render de peces + scatter
- Consumir `sim/fish.js` (Task 1): construir buffers de líneas (cuerpo + cola con `sin(t)`), orientar
  a la velocidad, escalar x,z a `lagoonRadius`, y en unidades de mundo. `scare()` de pond llama a
  `scatterFish`. Peces se reflejan en el agua.

### Task 8: Nieve realista en `engine/weather.js` (COMMIT DE COMPORTAMIENTO SEPARADO)
- Reescribir el sistema de copos (forma/deriva turbulenta/profundidad/jitter; ref shubniggurath
  WgJZJo) en `engine/weather.js`. Afecta forest/city/pond (deseado). **Commit aparte** de las tareas
  de pond. Verificación visual del bosque (antes/después) para confirmar que solo cambió la nieve.

### Task 9: Verificación integral y cierre
- `npm test` + `npm run build` verdes. Navegador: laguna lobulada, agua ondulando/reflejando, juncos,
  niebla azul, 6 especies (buceo/planeo/cabeceo), cardúmenes que se dispersan con shake, clima con
  nieve realista. `land`↔`water` sin fugas ni cambios en el bosque salvo la nieve. Screenshots.
- Actualizar memoria `murmur-world-personal` (pond hecho) tras OK del usuario.

---

## Self-Review (Fase 0)

- **Cobertura del spec (Fase 0):** peces (§7) → Task 1; censo (§9) → Task 2; config `pond` (§9) →
  Task 2. Render (§4–6,8) → Fase 1 (gated, roadmap). ✔ sin huecos en lo ejecutable ahora.
- **Placeholders:** Fase 0 sin placeholders (código completo). Fase 1 es roadmap explícito por el
  gate del engine, no placeholders ocultos.
- **Consistencia de tipos:** `createSchools/updateSchools/scatterFish` y la forma `Fish` y el bloque
  `cfg.fish` coinciden entre `sim/fish.js`, los tests y `config.pond.fish`. ✔
```

