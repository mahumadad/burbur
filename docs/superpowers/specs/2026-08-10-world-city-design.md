# Diseño — Descomposición fina del engine + Mundo CIUDAD (block)

**Fecha:** 2026-08-10
**Branch:** `feat/world-city` (rebasada sobre `main` @ 93eae1c)
**Estado:** aprobado en brainstorming; realineado tras la extracción de `stage.js`.

## Objetivo

Implementar el mundo **CIUDAD (`city`)** real (hoy `createStubWorld`), consumiendo el
engine de render compartido. Paridad de valores del bundle real
(`docs/superpowers/specs/2026-08-11-mapa-otros-mundos.md`, §3 CIUDAD).

## Estado del engine compartido (coordinación entre sesiones)

Hay un fleet de sesiones trabajando murmur-world en paralelo: **engine** ("Componentes
Murmur DIY"), **CIUDAD** (esta), **AGUA** (pond) y **CÉLULA**.

- La sesión engine ya extrajo **`src/render/stage.js`** (en `main` @ 93eae1c): la capa
  world-agnostic de rig+postfx. `createStage(container, cfg)` →
  `{ scene, camera, renderer, controls, composer, labelEl, metrics, flash, resize,
  setResizeHook, render(step), dispose }`. Subsume lo que iba a ser `rig.js`+`postfx.js`.
- **NO** extrajo el resto: siguen inline en `scene.js` los sistemas de puntos,
  agentes, estelas, clima y haze. `scene.js` **no** fue renombrado.
- La sesión engine **delega en CIUDAD** liderar la descomposición fina de esos cinco
  módulos, como refactor puro sobre main; AGUA/CÉLULA consumirán esas firmas.

Se entrega en **dos fases / commits separados** (regla: nunca mezclar refactor con
cambio de comportamiento):

- **Fase A — Refactor puro:** extraer `render/engine/{points,agents3d,trails,weather,
  haze}.js` desde `scene.js`; dejar el bosque idéntico.
- **Fase B — Feature ciudad:** `render/city.js` sobre `stage.js` + `engine/*`.

Nota de tests: usar `npx vitest run --exclude '**/.claude/**'` (24 tests; sin el
exclude vitest recorre los worktrees y cuenta 96).

---

## Fase A — Descomposición fina del engine (`src/render/engine/`)

Fábricas puras de infra (no saben de "bosque"/"ciudad"/"agua"). Origen: el código hoy
inline en `scene.js`. Se mueve verbatim (sin cambiar lógica) y `scene.js` pasa a
importarlo. `stage.js` queda como está.

| Módulo | Responsabilidad | Interfaz |
|---|---|---|
| `points.js` | Sistema de puntos tamaño-mundo + DOF (`pointMat`), acumuladores, subida de buffers | `createDraw(rc)` → `{ pushPoint(x,y,z,col,size,phase), pushLine(x1,y1,z1,x2,y2,z2,c1,c2), pointMaterial, uniforms, finalizePoints(scene), finalizeLines(scene, material) }` |
| `agents3d.js` | Constructores de agente + motion | `createAgentKit(rc)` → `{ fatLine(pos,color), edgesOf(geo,color), ringLoop(r,segs,color), creature(t), wedge(e), pick(arr), fatMaterials }`; `updateAgentMotion(agents, roamers, R, step, worldPos, tmp)` |
| `trails.js` | Estelas | `createTrails(scene, n, agentColors, rc, pointMaterial)` → `{ update(worldPos) }` |
| `weather.js` | Lluvia + nieve + caps | `createRain(scene, R, G)`→`{mesh, update(dt,intensity)}`, `createSnow(scene, R, G)`→`{mesh, update(dt,clockT,intensity)}`, `createSnowCaps(scene, capPos, uProjUniform)`→`{ setCover(v) }` |
| `haze.js` | Halo aditivo de color del mundo | `createHaze(scene, { R, G, count, color, alpha, heightFn })` → `{ uniforms }` |

**Detalle de firmas** (tomadas del código real de `scene.js`):

- `createDraw` centraliza `pointUniforms` (`uProj,uT,uFocus,uAperture`) y el
  `ShaderMaterial` de puntos. `pushPoint/pushLine` acumulan en buffers internos;
  `finalizePoints(scene)` sube el buffer de puntos y añade el `THREE.Points`;
  `finalizeLines(scene, material)` sube el buffer de líneas (flora) con el material que
  pase el mundo (el bosque usa `LineBasicMaterial vertexColors`, y lo guarda en
  `snowMats`). El mundo mantiene la referencia a `pointMaterial`/`uniforms` para el
  `setResizeHook` y para animar `uT`.
- `updateAgentMotion` encapsula el bloque roll/glide/spin del update (usa `tmp` con
  vectores/quaternion reutilizables que pasa el mundo, para no allocar por frame).
- `createTrails` usa el `pointMaterial` del `createDraw` (mismas estelas tamaño-mundo).
- weather: extents por parámetro (`R`, `G=groundY`) — cada mundo pasa los suyos.
- `createSnowCaps` recibe el `uProj` uniform (comparte resolución) y expone `setCover`.

**Qué NO se mueve** (queda en `scene.js`/cada mundo): terreno, `terrainHeight`/máscaras,
pool de especies + params, `mapPositions` (mapeo roamer→mundo), y la respuesta a `eco`
(nieve/charcos/pasto). El `update()` del mundo llama a los helpers.

**Rename:** se mantiene `scene.js` (no se renombra a `forest.js`) para minimizar la
superficie de conflicto con AGUA/CÉLULA que ya trabajan sobre main; el nombre importa
poco ahora que `stage.js` es la capa compartida. (Revertir esta decisión es trivial si
se prefiere simetría.)

### Criterio de aceptación Fase A

- `npm run build` + `npx vitest run --exclude '**/.claude/**'` verdes (24 tests).
- Bosque (`land`, default) **idéntico** antes/después: screenshot de comparación.
- Diff de `scene.js`: solo mueve código a `engine/*` e importa; sin cambios de lógica.
- Firmas finales de `engine/*` comunicadas a las sesiones AGUA/CÉLULA/engine.

---

## Fase B — Mundo CIUDAD

Nuevo `src/render/city.js` → `createCityScene(container, cfg, agentNames)`, misma API
`{ update(swarm,dt,eco), resize, flash, scare, dispose }`. Compone `createStage` +
`engine/*`. Cero duplicación de andamiaje.

### B.1 Terreno (valores exactos, mapa §3)

Constantes: `Wt=62` (semi-lado retícula), `Gt=13` (ancho de calle), `Kt=2.4` (altura
bordillo), `we=-4` (nivel base de calle), `qt=Wt*.85=52.7`. Extent de mundo
`R_CITY ≈ Wt*1.18 ≈ 73` (local; para cámara/haze/clima/roamers).

Orden y rol (paridad máxima — todos):

| fn | Construcción |
|---|---|
| `tn` calles | `round(streets)`∈[1,4] cortes/eje (+1 posible al otro eje, 50% swap). `streets=2` → 2×2 o 2×3. Bloques `Xt = {cx, cz, hx, hz}`. |
| `pn` suelo | Grid 150×150, lado `Wt*2.35`=145.7. Altura `we+(Kt+ruido)*mask`: bloques elevados (≈`we+Kt`), calles hundidas (≈`we`). Look matrix: mesh vertexColors + WireframeGeometry (opacity baja) + puntos mate. |
| `bn`/`yn` torres | Por bloque, prob `= (r≥20?.85 : r≥14?.5 : .2)*towers`, `r=min(hx,hz)*2`; si `r≥40`, 60% de 2ª torre. `yn` = edificio transparente en capas (§B.3). Color: `rnd<.66` tinte del bloque, si no random de `$t`. |
| `Sn` | 3–6 edificios bajos (cajas), offset dentro del bloque. Mismo look de losas/matrix. |
| `Cn` | 3–7 farolas con paleta de 5 colores (§B.2). Poste (línea) + punto de luz (glow). |
| `wn` | 1–3 muebles urbanos, dims `5.5+q*1.5 × 3.4+q*.6`. Cajas bajas. |
| `Tn` | Charcos: planos grises `#B8BDC9` vertexColors en bordes de bloque; brillo deslizante leve. |
| `Dn` pasto | `floor(46000*grass)+floor(700*grass)` = 46 700 hojas (sistema de pasto por líneas), sembrado en orillas de bloque/calle. |
| `kn` flores | Por bloque: `round((8+q*14)*flowers)` en el perímetro (reusa `flower()`); alimenta POIs de bichos. |
| `An` polvo | 2 400 puntos, `y=we+.25+q*2.4`, concentrados junto a calles (`q()>exp(-dist/3)`). Tinte naranja. |

### B.2 Paletas (exactas)

Edificios `$t` (6 RGB): `[.99,.86,.66] #FCDBA8` · `[1,.58,.14] #FF9424` ·
`[.985,.71,.52] #FBB585` · `[.72,.55,.96] #B88CF5` · `[1,.84,.79] #FFD6C9` ·
`[.99,.45,.12] #FC731F`.

Farolas `Cn` (5): `[.16,.3,.98] #294CFA` · `[1,.83,.2] #FFD433` · `[1,.35,.55] #FF598C`
· `[.35,.9,.85] #59E6D9` · `[1,.48,.09] #FF7A17`.

Charcos `Tn`: `[.72,.74,.79] #B8BDC9`. Haze ciudad: naranja `[1,0.48,0.12]`; acento
`#fab75e`.

### B.3 Edificios transparentes en capas + glow + matrix (la estrella)

Cada torre `yn()` = **pila de losas finas** (pisos), no un bloque sólido:

- **Losa** = `BoxGeometry(w, slabThickness, d)` a `y` creciente. `MeshBasicMaterial`,
  `AdditiveBlending`, `transparent`, `opacity ≈ 0.10–0.16`, `depthWrite:false`, color =
  tinte. Superpuestas entre sí y con otros edificios, el brillo **se acumula** y **se
  funde con el suelo** → capas de vidrio incandescente.
- **+ WireframeGeometry** (aristas matrix, `opacity ≈ 0.2`) **+ un punto por vértice**
  (matrix, vía `pushPoint`) → el edificio se disuelve en la retícula del suelo.
- Footprint se afina levemente hacia arriba (setbacks). Cimas → posaderos y cap de nieve.
- `slabThickness`/`gap`/nº pisos derivan de la altura; tuning fino en el navegador.

### B.4 Agentes (mapa §3.4)

Pool ciudad (pesos): `whiteC:3, cyanC:4, flag:4, dbl:3, eye:2`.

- Cero geometría nueva: reusa constructores del bosque vía `agents3d`. `cyanC` = jaula
  cubo cian; `whiteC` = misma jaula pero blanca (`PALETTE.white`, único parámetro de
  color nuevo); `flag/dbl/eye` idénticos.
- Escala ~33% menor (`scale *= 0.67`). Altura de tráfico por especie:
  `trafH = { whiteC:3.2, cyanC:3.2, eye:3, flag:2.72, dbl:1.5 } * scale`.
- Estela: color de arista de ciudad `en = [1,.23,.35] #FF3B59`.
- Encauzados por calles: `paths` desde las líneas de calle, con `pathPull` mayor.
- Bichos: reutiliza el sistema; POIs = parches de flores `kn`.

### B.5 Clima / FX

`update(swarm,dt,eco)` compuesto: tinte de hora, niebla de escena (`scene.fog.density`),
haze naranja, lluvia, nieve (+cap en cimas), `flash()` (relámpagos disparados por
`main.js`). `scare()` dispersa agentes + bichos. Charcos `Tn` son estáticos (no el
sistema de deshielo del bosque).

### B.6 Census urbano

Nuevo `CITY_CENSUS` en `src/sim/agents.js` (fauna/actores urbanos según `ng.city` del
bundle): `feral pigeon`, `carrion crow`, `magpie`, `herring gull`, `red fox` (night),
`brown rat` (night), `peregrine falcon`, + humanos `skateboarder`, `cyclist`, `busker`,
`tram`, `ambulance`, `market trader`. Tipos: `flying_animal`/`walking_animal`/
`static_object`/`human`.

### B.7 Integración

`src/worlds/registry.js`: `city` → `ready:true`, `build: createCityScene`, `census:
CITY_CENSUS`.

### Criterio de aceptación Fase B

- `npm run build` + tests verdes.
- En el navegador (dot naranja o `window.setScene('city')`): calles + bloques +
  edificios transparentes en capas con glow que se funden con el suelo matrix,
  pasto/flores en orillas, farolas, charcos, polvo naranja, agentes urbanos pequeños a
  altura de tráfico siguiendo calles. Sin errores de consola. Volver a `land`/`water`
  funciona (dispose limpio, 1 canvas).

---

## Follow-ups (fuera de alcance)

- Física "offroad" fina de ciudad del bundle (rama `if(world==='city')`) — aproximada
  con `pathPull`.
- Renombre `scene.js`→`forest.js` si se quiere simetría (trivial, cuando el fleet
  converja).
