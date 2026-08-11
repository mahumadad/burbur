# Diseño — Mundo AGUA (pond)

**Fecha:** 2026-08-11
**Rama:** `feat/world-pond` (desde `main`; se **rebasa** sobre main tras aterrizar el engine — ver §3)
**Fuente de paridad:** `docs/superpowers/specs/2026-08-11-mapa-otros-mundos.md` §4 (valores y colores
EXACTOS del bundle de murmur). Referencias visuales y roadmap: memoria `murmur-world-references`.

Recreación del mundo AGUA de murmur.living, **calcando** (paridad de valores y colores) y
**mejorando** (agua en movimiento con reflejo, cardúmenes de peces, nieve realista). El resultado
debe verse "bien con los colores de murmur" — la paleta es murmur-exacta; la riqueza extra usa esa
misma paleta.

---

## 1. Objetivo y criterios de éxito

Implementar el builder REAL del mundo `water` (hoy `createStubWorld` en `src/worlds/registry.js`),
cumpliendo la API común `{ update(swarm, dt, eco) → predations, resize, flash(v), scare(strength),
dispose }` para que el host (`main.js`) lo intercambie en caliente igual que el bosque.

**Pond se monta sobre el ENGINE compartido** que extrae la sesión de CIUDAD (ver §3): compone
`render/engine/*` en vez de duplicar la fontanería. `render/pond.js` es simétrico a `render/city.js`
y `render/forest.js`.

Criterios verificables:

1. `window.setScene('water')` (o el dot azul del selector) construye la laguna sin errores de
   consola y a ~60fps en desktop.
2. Paridad de valores del spec §4: radio laguna `mt=64`, nivel de agua `ht=-3.4`, prof. de lóbulos
   `gt=11`, niebla aditiva 4200 puntos (radio `mt*1.28`), polvo de borde 8500, juncos base ~736.
3. Las **6 especies exclusivas** (`lamp, ice, strider, orb, burst, pins`) presentes con sus
   **colores literales** del spec §4.2 y su física de agua (dive/hover/roll).
4. Superficie de agua **en movimiento** (olas por shader) con **reflejo** de la geometría real
   (agentes, juncos, peces).
5. **Cardúmenes de peces** (boids) nadando bajo el agua; se dispersan con el shake.
6. **Nieve realista** en `engine/weather.js` → beneficia a los 3 mundos.
7. `npm run build` y `npm test` verdes. Tests nuevos del módulo puro de peces.
8. El bosque sigue idéntico salvo la nieve (que ahora es realista, cambio intencional y compartido).

**No-objetivos (fuera de scope):** estaciones/bloom, mundo ciudad (otra sesión), mundo célula,
export .avi, retrofit del "look matrix" a árboles del bosque, audio nuevo por mundo (se reusa).

---

## 2. Contrato con el host (ya existente, no se toca)

`main.js buildWorld(id)`:

```js
const swarm  = createSwarm(CONFIG.fireflies)
const pop    = createCensus(def.census, CONFIG.fireflies.count)
const scene  = def.build(app, CONFIG, pop.visible.map(v => v.name))
const events = createEventEngine(pop, CONFIG.events)
```

- `def.build(container, cfg, agentNames)` → objeto con la API común.
- `scene.update(swarm, dt, eco)` cada frame **devuelve** `predations` (`[{ hunterIdx, dir }]`).
- `scene.flash(v)` relámpago; `scene.scare(strength)` shake; `scene.dispose()` al cambiar de mundo.
- `eco` = `{ light:[r,g,b], gain, fog, rain, temperature, activity, phase, weather, ... }`.
- `cfg` = `CONFIG`. Claves: `cfg.world.radius` (85 = el `G` global del spec), `cfg.world.groundY`
  (0), `cfg.fireflies.count` (18), `cfg.render.*`, `cfg.wander`, `cfg.bugs`, `cfg.behaviors`,
  `cfg.paths`, y (nuevo) `cfg.pond.*`.

**Mapeo de alturas:** `groundY=0`; nivel de agua `ht=-3.4`. Lecho en `ht-gt = -14.4`. Plano de agua
en `ht-0.12 = -3.52`. La tierra de orilla sube del borde de la laguna (y≈-3.4) a y≈0 en el disco
exterior `R=85`.

---

## 3. Arquitectura, engine compartido y SECUENCIA (coordinación)

**Decisión (coordinada con la sesión de CIUDAD):** existe un **engine compartido** que ambos mundos
componen. La sesión de ciudad lo **posee** y lo extrae; pond **espera** y se monta encima.

### 3.1 Engine compartido (lo extrae la sesión de CIUDAD — Fase A, refactor puro)

Layout aprobado en esa sesión (bosque idéntico, verificado antes/después, `scene.js` →
`render/forest.js`):

```
src/render/engine/
  points.js    // puntos tamaño-mundo + DOF (pointMat) + pushPoint/pushLine + upload
  agents3d.js  // fatLine/edgesOf/ringLoop/creature/wedge + ensamblado de especies + updateAgentMotion
  trails.js    // estelas
  weather.js   // lluvia + nieve + caps (parametrizado por R, groundY)
  postfx.js    // pase de lente (fisheye + cromática + viñeta)
  rig.js       // cámara orbital + OrbitControls + resize + label flotante + overlay de flash
  haze.js      // halo aditivo (parametrizado: color, count, alpha, alturaFn)
render/forest.js  // (= scene.js renombrado)
render/city.js    // ciudad, compone engine/*
render/pond.js    // pond, compone engine/*  ← ESTE SPEC
```

### 3.2 Secuencia de aterrizaje (evita hacer el refactor dos veces)

1. **Fase A (sesión ciudad):** extrae `engine/*` + rename forest → **merge a main**. *(Bloqueante
   para pond. La sesión de ciudad está interrumpida; hay que retomarla.)*
2. **`feat/world-pond` se rebasa sobre main** una vez el engine está en main.
3. **Fase B-pond (esta sesión):** `render/pond.js` + terreno + agua + 6 especies + peces + censo +
   registry, componiendo `engine/*`.

### 3.3 Trabajo de pond INDEPENDIENTE del engine (se puede hacer ya, sin bloqueo)

- `src/sim/fish.js` (boids puros) + `test/fish.test.js`.
- `POND_CENSUS` en `src/sim/agents.js` (datos puros).
- Este spec y el plan de implementación.

### 3.4 Nieve realista — commit de COMPORTAMIENTO separado (no entra en la Fase A pura)

La nieve realista **cambia** el aspecto del bosque, así que **no** puede ir en la Fase A (refactor
puro). Va como commit aparte sobre `engine/weather.js` (afecta forest/city/pond — deseado). Lo hace
la rama de pond tras el rebase, claramente separado de los commits de terreno/agua de pond, con
verificación visual del bosque. (Regla: nunca mezclar refactor con cambio de comportamiento.)

### 3.5 Requisitos de pond SOBRE el engine (para que la Fase A los cubra)

Que la sesión de ciudad tenga presente al finalizar `engine/*`:

- `agents3d.js` debe permitir **constructores de especie propios del mundo** (pond trae 6 nuevos;
  no solo el pool del bosque) y exponer `updateAgentMotion` con hook para la **física de agua**
  (dive/hover/roll) — o al menos no impedir que pond escriba esa parte en su `update()`.
- `haze.js` parametrizable en color/count/alpha y **función de altura/posición** (la niebla de agua
  se siembra sobre la laguna, radio `mt*1.28`, altura `ht+0.3..`).
- `weather.js` reutilizable con `R`/`groundY` del mundo; su nieve será la realista (§3.4).
- `points.js` y `pushPoint/pushLine` disponibles para el terreno de pond (lecho, juncos, niebla,
  polvo, look matrix).
- `rig.js`/`postfx.js` sin acoplar a geometría del bosque.
- El **agua con Reflector vive en `pond.js`** (no en el engine): es específica de pond.

---

## 4. Terreno de la laguna (en `render/pond.js`, con helpers locales si crece)

Paridad: `mt=64`, `ht=-3.4`, `gt=11`, `R=85`. Look **matrix** (wireframe + puntos por vértice) en
lecho y orilla, como el bosque. Usa `engine/points.js` para los acumuladores.

- **Lóbulos de orilla** (`Lt`): 2–5 elipses `{rx,rz,ry,yaw,cx,cz}` cerca del origen. Su unión define
  la laguna irregular. Campo `lobeField(x,z)` (0 en agua → 1 en tierra) para recortar y sembrar.
- **Lecho/orilla** (`Rt`): `PlaneGeometry` ~110×110 sobre lado `R*2.4`, altura `ht-gt + fbm*1.3` en
  agua, subiendo a `groundY` en tierra según `lobeField`. `MeshBasicMaterial(vertexColors)` (paleta
  de lecho arena/limo azulado, murmur-exacta) + `WireframeGeometry` (op≈0.13) + `Points` por vértice.
- **Juncos/espadañas** (`Vt`): base ~`round(16*grass)*46` (≈736) hojas `LineSegments` de 2 segmentos
  (approach del pasto), sembradas en la ribera (`shoreMask`). Cabeza de espadaña = punto marrón.
  **Riqueza**: densidad extra por config, disperso al centro, denso en orilla.
- **Nenúfares/lirios** (mejora; `Ht` de murmur está vacío): discos planos sobre el agua
  (`CircleGeometry`, verdes `#7DEE32`/`#86E03A`) con flor ocasional; POI para las libélulas (bugs).
- **Niebla aditiva** (`Bt`): **4200 puntos**, radio `mt*1.28`, altura `ht+0.3+rand*2.6`, azul del
  haze — el halo exclusivo del agua. Vía `engine/haze.js` con posición/altura propias.
- **Polvo de borde** (`Ut`): **8500 puntos** al borde exterior (como el bosque).
- **Piedras de ribera** (riqueza): reuso del approach de rocas (icosaedro + wireframe + puntos),
  pocas, tono mojado.

## 5. Superficie de agua — híbrido con reflejo (en `render/pond.js`)

- `PlaneGeometry` 150×150 en `y = ht-0.12`, dentro del radio de laguna.
- **Olas**: shader que desplaza y calcula normales animadas (suma de senos + fbm; refs
  shubniggurath/knoland).
- **Reflejo (`THREE.Reflector`)**: render target a **media resolución** que refleja la geometría
  real; muestreo con UV distorsionadas por las olas; mezcla con tinte azul del haze + glints
  aditivos. Encima, capa sutil wireframe/puntos (matrix).
- **Perf/degradado**: flag `cfg.pond.waterReflection`. Off (o fallback por fps) → reflejo falso
  (tinte de cielo + glints deslizantes, como el charco actual). El export .avi es offline.
- Reacciona a `eco`: color/opacidad viran con la hora; más agitada/oscura con lluvia.

## 6. Las 6 especies exclusivas (constructores propios vía `engine/agents3d.js`)

Look de líneas/jaulas (fatLine + meshes chicos), **colores literales** del spec §4.2:

| Especie | Peso | Estructura | Colores clave |
|---|---|---|---|
| `lamp` | 2 | cage blanca + satélites + esferas azules | white, yellow/yellow/orange, `#4FA0FF` |
| `ice` | 3 | cage celeste + satélites lima/cian/azul | `#AEE6FF`, `#B9D24A`/cyanSat/`#4FA0FF`, `#2B8BFF` |
| `strider` | 3 | 3–5 aristas radiales + disco base + punta | `#1430E8 #2B6BFF #39C8FF #2BD06A`, base `#7DEE32`, punta `#35D06A` |
| `orb` | 2 | 2–3 discos achatados + esfera central + bolitas | yellow/`#D8E84A`, centro `#E08BD8`, satélites blancos |
| `burst` | 3 | 1–2 anillos base + 5–9 rayos + core | base `#8EE04A`, rayos `#DFE8FF #CDD8EE #1430E8 #2B6BFF #9FC0FF`, core `#BFE6FF` |
| `pins` | 2 | disco base + disco opc. + 4–7 "alfileres" | base `#86E03A`, `#A8E84A`, alfileres `#9AA832 #B9C24A #8A9A2A` |

**Física de agua** (en el `update()` de pond, adaptado del extracto `Rn` del spec §4.3): cada
individuo con `dive`/`hover`. Altura objetivo `j = ht - dive + homeY*0.3 + sin(t*1.4+idx*2.1)*0.34`,
tope de lecho `j ≥ ht-gt+0.9`. Cerca de superficie (`y < ht+1.2`) cabecea (`rot.x/z = sin/cos*0.085`),
alto se endereza. Params por especie (`band, hover, dive, rollMul, spinY, speedScale`) del spec §4.2.
Selección ponderada `[[lamp,2],[ice,3],[strider,3],[orb,2],[burst,3],[pins,2]]` sobre
`cfg.fireflies.count`.

## 7. Cardúmenes de peces (`sim/fish.js` puro + `test/fish.test.js`) — SIN bloqueo de engine

Boids clásico, puro (sin three), coords normalizadas:

- `createSchools(cfg, rand)` → 2–3 cardúmenes de ~20–40 peces; cada pez
  `{ x, y, z, vx, vy, vz, school }` dentro del volumen (radio norm. + banda de profundidad).
- `updateSchools(schools, cfg, dt, rand)`: separación + alineación + cohesión (por cardumen) +
  wander + límites (rebote/curva).
- `scatterFish(schools, strength)`: impulso de dispersión (lo llama `scare`).

Render en `pond.js`: cada pez = 2 segmentos (cuerpo + cola con `sin(t)`), orientado a su velocidad,
paleta fría sumergida; se refleja en el agua.

**Tests:** (a) tras muchos `update`, peces dentro del radio y la banda; (b) cohesión reduce la
dispersión media; (c) `scatterFish` sube la velocidad media un frame; (d) separación evita solapes
bajo `sepRadius`.

## 8. Nieve realista en `engine/weather.js` (commit de comportamiento, §3.4)

Copos realistas (ref shubniggurath WgJZJo): tamaño con variación por profundidad, deriva lateral con
turbulencia (no solo seno), leve rotación/parpadeo, caída con jitter individual; densidad activa ∝
`intensity`. Interfaz mínima intacta para no re-cablear a los mundos. Afecta forest/city/pond
(deseado). Verificación visual del bosque tras el cambio.

## 9. Censo, config e integración

- **`POND_CENSUS`** (nuevo en `sim/agents.js`, datos puros — SIN bloqueo de engine): fauna de agua
  coherente con los SFX del shake del spec (`water-heron-strike`, `water-cetti-burst`,
  `water-swan-takeoff`, `water-geese-alarm`, `water-moorhen-alarm`, `water-vole-plop`,
  `water-coot-eruption`). Ejemplos:
  - `flying_animal`: grey heron, mute swan, greylag goose, coot, moorhen, mallard, kingfisher,
    great crested grebe, cetti's warbler, sedge warbler, tufted duck, cormorant.
  - `walking_animal`: water vole, otter, common frog, grass snake.
  - `static_object`: the reedbed, still water, lily pads, midges over water.
  - `human`: angler, kayaker, birdwatcher.
- **`config.js`** — bloque `pond`:
  ```js
  pond: {
    lagoonRadius: 64, waterLevel: -3.4, lobeDepth: 11,
    hazeCount: 4200, dustCount: 8500,
    reedBase: 736, reedRichness: 3.0,
    waterReflection: true,
    fish: { schools: 3, perSchool: 30 /* + pesos boids */ },
  }
  ```
- **`registry.js`**: `water` → `build: (c,cfg,names)=>createPond(c,cfg,names)`, `census: POND_CENSUS`,
  `ready: true`. Acento `#aacdff` (ya presente).

## 10. Verificación

1. `npm test` — verde, incl. tests de `sim/fish.js`.
2. `npm run build` — sin errores.
3. Navegador (dot azul / `window.setScene('water')`): laguna lobulada, agua ondulando y reflejando,
   juncos, niebla azul; 6 especies con sus colores (unas bucean, otras planean); cardúmenes que se
   dispersan con el shake; lluvia/relámpago; nieve realista al enfriar. Cambiar a `land` y volver:
   sin fugas (dispose ok), bosque idéntico salvo la nieve realista.

## 11. Riesgos y mitigaciones

- **Bloqueo por el engine (Fase A)** de la sesión de ciudad, que está interrumpida → retomarla.
  Mientras, pond avanza en lo independiente (fish, censo, spec, plan).
- **Doble refactor del engine** si pond y ciudad lo extraen a la vez → **evitado**: ciudad lo posee,
  pond espera y rebasa.
- **Perf del Reflector** → media resolución + degradado a reflejo falso.
- **Regresión del bosque por la nieve realista** → commit separado + verificación visual del bosque.
- **Deriva del contrato del engine** vs. lo que pond necesita → §3.5 lista los requisitos para que la
  Fase A los cubra.
- **"Riqueza" vs "paridad de colores"** → riqueza = más densidad/elementos con la MISMA paleta
  murmur-exacta; no se inventan colores.
