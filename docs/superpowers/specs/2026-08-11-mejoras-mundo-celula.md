# Mejoras del mundo CÉLULA — spec de ejecución

**Fecha:** 2026-08-11
**Estado:** spec aprobado para implementar. Diseño escrito con Opus 5; la implementación se reparte
en agentes Sonnet por olas (ver §12).
**Base:** `main` @ `e4edacd` (mundo célula ya mergeado, 114 tests verdes).
**Doc padre:** `2026-08-11-diseno-mundo-celula.md` (concepto, decisiones cerradas, §4.2bis recetas
de estructura real). Este doc NO repite el diseño: solo especifica las 10 mejoras pendientes.

> Regla del repo que aplica a todo lo de acá: el comportamiento vive en `src/sim/*` **puro y
> testeado** (sin three/DOM); `src/worlds/cell.js` solo dibuja. Cada mejora que tenga lógica
> propia estrena módulo puro con tests, y el render la consume.

---

## 0. Estado verificado (2026-08-11)

Confirmado leyendo el código, no de memoria:

| Ya resuelto por otras sesiones | Dónde |
|---|---|
| Etiqueta de agente por **hover** (no centro de pantalla) | `cell.js` `setPointer`, commits `b610a41`/`cd1c9a4` |
| **Voces de audio** para tipos celulares (bloops por tipo; invasores agudos, motores graves) | `audio/engine.js:202-206` |

| Pendiente confirmado | Evidencia |
|---|---|
| `scene.update()` devuelve `[]` → ningún evento grande se narra | `cell.js:934` |
| Las entregas de ATP se descartan | `cell.js:802` — `updateAtp(...)` sin capturar el retorno |
| Tráfico sin dirección por tipo | sin coincidencias de `kinesin/dynein/outward` en `cell.js` |
| Motores no existen visualmente | `cell.js` no importa `behaviors.js` |

---

## 1. M1 — Canal de eventos del mundo ⭐ cimiento

**Problema.** `cell.js:934` devuelve `[]`. División, fagocitosis, infección, apoptosis y fusión
mitocondrial **nunca llegan al log**, aunque el léxico ya tiene sus plantillas escritas y sin usar
(`CELL_LEXICON.conflict` narra la fagocitosis desde hace días).

**Además, el host no admite eventos sin agente visible.** `main.js` hace
`const who = pop.visible[p.hunterIdx]; if (!who) continue` → una división celular o una onda de
calcio (que no tienen "individuo") se descartarían en silencio.

**Diseño.**

1. **Contrato ampliado del mundo.** `scene.update()` devuelve `WorldEvent[]`:
   ```js
   { type,            // 'conflict' | 'moment' | 'interaction' | 'shift' | …
     agent?,          // nombre YA resuelto (para eventos sin individuo del censo)
     agentType?,      // para elegir la voz de audio
     agentIdx?,       // índice en pop.visible (compatible con el bosque)
     dir?,            // 'left' | 'right' | … para el paneo
     kind? }          // etiqueta libre del mundo ('division', 'phagocytosis', …)
   ```
2. **`main.js` resuelve en dos pasos**, sin romper el bosque:
   ```js
   const idx = ev.agentIdx ?? ev.hunterIdx          // el bosque manda hunterIdx
   const who = idx != null ? pop.visible[idx] : null
   const agent = ev.agent ?? who?.name
   const agentType = ev.agentType ?? who?.type
   if (!agent && !ev.kind) continue                  // solo se descarta lo vacío de verdad
   ```
   El bosque sigue funcionando igual (manda `hunterIdx` y nada más).
3. **La célula emite**: fagocitosis (M6), infección (ya la detecta `invaders.js`), división (M4),
   fusión mitocondrial (M9), apoptosis, y ráfaga de ATP (M2).

**Criterio de aceptación.**
- El log de la célula muestra al menos infección y ráfaga de ATP sin implementar nada más.
- Los 114 tests actuales siguen verdes; el bosque narra idéntico.
- Test nuevo: un evento con `agent` explícito y sin `agentIdx` se narra igual.

**Tamaño:** S. **Depende de:** nada. **Bloquea a:** M4, M6, M9.

---

## 2. M2 — Cerrar el lazo del ATP ⭐

**Problema.** El concepto rector del mundo es "el ATP es la música". Hoy los cuantos nacen en las
mitocondrias, viajan y se consumen **en silencio y sin destello**: `updateAtp` devuelve las
entregas y `cell.js:802` las tira.

**Diseño.**

1. **Visual (dentro del mundo, sin tocar el host):** cada entrega deja un *pop* — un punto brillante
   que crece y se apaga en ~0.25 s en el punto de consumo. Pool fijo de ~16 pops reusando
   `createPointCloud`; los muertos se aparcan en `y=-9999` (convención del repo).
2. **Sonido (vía M1):** las entregas emiten `{ type: 'pulse', y }` y `main.js` las mapea a
   `audio.triggerFlash(y, intensity)` — la misma voz que ya usa el bosque para los latidos. Son
   2 líneas en el host.
   *Nota:* el mundo no recibe el handle de `audio` (por diseño); el canal de eventos es la vía.
3. **Antiflood:** tope de ~6 pulsos sonoros por segundo; el visual no se limita.

**Criterio de aceptación.** Se ve y se oye el consumo, no solo la emisión. Con hipoxia (menos ATP)
el mundo suena notoriamente más vacío.

**Tamaño:** S. **Depende de:** M1 (para el sonido; el visual es independiente).

---

## 3. M3 — Tráfico direccional por tipo

**Problema.** Todos los organelos deambulan igual. En la realidad **kinesina lleva hacia afuera y
dineína hacia adentro**: lo secretor sale, lo digestivo entra (doc padre §2.1). Es el detalle que
hace legible el tráfico sin leer una etiqueta.

**Diseño.** Módulo puro nuevo **`src/sim/traffic.js`**:

```js
export const ROLE = { OUT: 1, IN: -1, FREE: 0 }
/** Rol por tipo de organelo: qué motor lo lleva. */
export function roleFor(kind)          // vesicle|secretory → OUT; lysosome|endosome → IN; resto FREE
/** Sesgo radial suave sobre la velocidad, proporcional a la cercanía del riel. */
export function applyRoleBias(roamers, roles, cfg, dt)
```

- El sesgo es **suave** (se suma a la velocidad, no la reemplaza): el organelo sigue deambulando,
  solo que su deriva neta tiene sentido.
- Config nueva: `cc.traffic = { bias: 0.06, innerR: 0.12, outerR: 0.66 }` — con topes para que los
  `IN` no se apelotonen en el centro ni los `OUT` se peguen a la membrana.

**Criterio de aceptación.** Test puro: tras N segundos, el radio medio de los `OUT` es mayor que el
de los `IN`, y ambos permanecen dentro de los topes.

**Tamaño:** S. **Depende de:** nada.

---

## 4. M4 — Mitosis con clímax visual

**Problema.** La célula se redondea y se frena, pero la cromatina no se condensa, no hay huso ni
surco. El "día" de este mundo se queda sin su amanecer.

**Diseño.** Módulo puro nuevo **`src/sim/mitosis.js`**:

```js
/** Traduce (fase, phaseT) del ciclo a los 4 gestos visibles de la mitosis. */
export function mitosisState(phase, phaseT)
// → { condensation, alignment, separation, furrow }   // todos 0..1
```

| Fase | condensation | alignment | separation | furrow |
|---|---|---|---|---|
| `prophase` | 0→1 | 0 | 0 | 0 |
| `metaphase` | 1 | 0→1 (se alinean en el ecuador) | 0 | 0 |
| `anaphase` | 1 | 1 | 0→1 (se separan a los polos) | 0 |
| `telophase` | 1→0 | 1 | 1 | 0→0.4 |
| `cytokinesis` | 0 | 0 | 1 | 0.4→1 |

Render en `cell.js`:
- **Cromosomas:** la cromatina (hoy hebras sueltas) interpola hacia **N=8 barras discretas**; con
  `alignment` migran al plano ecuatorial; con `separation` viajan a dos polos.
- **Huso:** líneas desde dos polos (a ±NR sobre el eje del huso) hasta cada cromosoma, visibles
  con `alignment > 0`.
- **Surco:** el contorno se estrangula en el ecuador — un término extra en el radio de la membrana,
  proporcional a `furrow`, en la banda perpendicular al eje del huso.
- Al terminar `cytokinesis`: **evento de división** (vía M1) y reset del estado.

**Criterio de aceptación.** Tests puros de la tabla (monotonía y rangos). Visual: se ve condensar,
alinear, separar y estrangular. El log narra la división una vez por ciclo.

**Tamaño:** L. **Depende de:** M1 (evento).

---

## 5. M5 — Motores caminando por los rieles

**Problema.** El censo tiene `kinesina`/`dineína` y el audio ya les dio voz grave, pero **no hay
nada que se vea caminar**. Los rieles están vacíos.

**Diseño.** Módulo puro nuevo **`src/sim/motors.js`** (mismo espíritu que `behaviors.js`):

```js
export function createMotors(cfg, railCount, rand)
// motor = { rail, t: 0..1, dir: +1|-1, speed, state: 'walk'|'detached', cargo: bool }
export function updateMotors(motors, rails, cfg, dt, rand)
```

- Camina a `t += dir * speed * dt`, acotado por el **largo vivo** del riel (si el microtúbulo se
  derrumba por debajo del motor, este se **suelta** y se reengancha en otro riel).
- `dir` según rol: kinesina `+1` (hacia la periferia), dineína `-1` (hacia el centrosoma).
- Paso discreto opcional: el avance tiene micro-saltos (8 nm reales) → un jitter sutil, no continuo.

Render: `createPointCloud` de ~40 puntos sobre los rieles, 2 tonos (kinesina/dineína).

**Criterio de aceptación.** Tests puros: avanzan monótonamente en su sentido, no se salen del riel,
se reenganchan cuando el riel colapsa. Visual: puntitos recorriendo los microtúbulos en ambos
sentidos.

**Tamaño:** M. **Depende de:** nada (usa `rails.js` que ya existe).

---

## 6. M6 — Fagocitosis real

**Problema.** Las bacterias son presa pero **la célula no las caza**. Es el conflicto que justifica
que el mundo sea un macrófago (decisión §9.1 del doc padre).

**Diseño.** La decisión es del mundo, no del módulo de invasores (así se especificó a propósito):

- Cada frame, para cada bacteria viva: si está **dentro del sector del lamelipodio**
  (|angDiff(ang, frontAngle)| < 0.9) **y** a menos de `catchRadius` del borde de la membrana →
  **engullida**.
- Efectos: la bacteria muere; nace un **fagosoma** (un organelo temporal que viaja hacia adentro
  buscando un lisosoma); se emite evento `{ type:'conflict', agent:'bacteria', agentType:'invader',
  kind:'phagocytosis' }` → el léxico ya lo narra.
- Al encontrarse fagosoma + lisosoma: fusión, evento `kind:'digestion'`, y el fagosoma desaparece.

**Criterio de aceptación.** El log muestra fagocitosis; la bacteria desaparece del sustrato; el
fagosoma se ve viajar hacia adentro.

**Tamaño:** M. **Depende de:** M1.

---

## 7. M7 — Que el medio se vea

**Problema.** El ecosistema ya tiene `oxidative stress`, `serum starved`, `acidic` e `inflamed`,
pero el render **no reacciona**: los 6 medios se ven igual.

**Diseño.** Un efecto propio por medio, todos baratos:

| Medio | Efecto visual |
|---|---|
| `oxidative stress` | **ROS**: puntos rojizos que entran desde el borde en línea recta e impactan; al impactar, un pop corto. Reusa el canal `eco.rain` (que ya sube a 0.55 en este medio) como densidad |
| `serum starved` | **Autofagosomas**: aparecen 1–2 organelos de doble membrana que engullen y buscan lisosoma |
| `acidic` | Más blebbing (ya modelado) + la membrana se tiñe hacia magenta |
| `inflamed` | Más invasores (baja `spawnEvery`) + ondas de Ca²⁺ más frecuentes (ya está) |
| `hypoxic` | Las mitocondrias se **apagan** (menos brillo, menos emisión de ATP) |
| `nutrient rich` | Todo al máximo — es la línea base |

**Criterio de aceptación.** Cambiar de medio se nota en pantalla sin mirar el HUD.

**Tamaño:** M. **Depende de:** M2 (para el apagado de mitocondrias).

---

## 8. M8 — Blebbing verificado (¿código muerto?)

**Problema.** El blebbing está modelado y testeado (`membrane.js`), pero **con ATP alto nunca se
dispara**. Si la hipoxia no baja el presupuesto por debajo de `atpFloor`, es código muerto en
pantalla.

**Diseño.** Es tarea de **verificación y calibración**, no de features:
1. Smoke-run del balance producción/demanda bajo `hypoxic` sostenido (el drain sube con `tension`).
2. Si el presupuesto no cruza `atpFloor`, ajustar `cc.atp.drain` / `gainPerQuantum` / la ligadura
   demanda↔medio hasta que sí.
3. Dejar un test que **fije la garantía**: bajo hipoxia sostenida, `motility.blebbing > 0.5`.

**Criterio de aceptación.** El test existe y pasa. Se ve ampollarse la célula con hipoxia.

**Tamaño:** S. **Depende de:** nada.

---

## 9. M9 — Fusión y fisión mitocondrial

**Problema.** La red mitocondrial real es dinámica (se fusiona y se fisiona en minutos) y el léxico
ya narra *"encuentra a otro y se fusiona"*, pero nada ocurre.

**Diseño.**
- Si dos mitocondrias quedan a menos de `fuseRadius` durante > 0.6 s: **fusión** — una crece
  (escala ×1.35) y absorbe a la otra, que se oculta; evento `kind:'fusion'`.
- Tras `8–20 s`, **fisión**: vuelve a aparecer separándose, evento `kind:'fission'`.
- El agente oculto no se borra (rompería índices del censo/etiqueta): se aparca y se restituye.

**Criterio de aceptación.** Se ve fusionar y separarse; el log lo narra. La etiqueta de hover no
apunta a un agente oculto.

**Tamaño:** M. **Depende de:** M1.

---

## 10. M10 — Contexto de tejido

**Problema.** La célula está sola en un sustrato infinito. Era la **opción C** del doc padre,
agendada como capa barata: contexto de tejido sin pagar el costo de simular vecinas.

**Diseño.** 3–5 **contornos parciales** de células vecinas asomando por el borde del sustrato:
- Solo el contorno (mismo generador de armónicos que la membrana, congelado — no se deforman).
- Viven en el **grupo del sustrato** → se deslizan con él, y por tanto se acercan y se alejan a
  medida que la célula migra. Con el wrap del tile, reaparecen.
- Sin interior, sin organelos, sin eventos: son paisaje.

**Criterio de aceptación.** Se ven vecinas al alejarse; no cuestan FPS medibles.

**Tamaño:** S. **Depende de:** nada.

---

## 11. Qué NO hacer

- **No** meter física real de husos ni de polimerización: cinemática con aspecto correcto.
- **No** borrar agentes del array (M9): rompe `agentNames`, la etiqueta y las estelas. Aparcar.
- **No** duplicar el shader de puntos ni el buffer de líneas: todo sale de `engine/points.js`.
- **No** tocar `weather.js` del bosque (acuerdo con la sesión de ciudad: queda forest-shaped).
- **No** subir `cell.js` indefinidamente: hoy son ~950 líneas. Si una mejora lo empuja por encima
  de ~1200, extraer su bloque de dibujo a `src/worlds/cell/<algo>.js`.

---

## 12. Plan de ejecución — olas

El riesgo real no son las dependencias lógicas: es que **casi todo toca `cell.js`**. Dos agentes
editando ese archivo en paralelo se pisan. Por eso el reparto es **por propiedad de archivo**.

### Ola A — módulos puros, en PARALELO (archivos nuevos disjuntos, cero `cell.js`)

| Agente | Entrega | Tests |
|---|---|---|
| A1 | `src/sim/mitosis.js` (M4, la máquina de estados) | `test/mitosis.test.js` |
| A2 | `src/sim/motors.js` (M5) | `test/motors.test.js` |
| A3 | `src/sim/traffic.js` (M3) | `test/traffic.test.js` |

Ninguno toca archivos existentes salvo para *leer*. Sin conflicto posible.

### Ola B — cimiento, SECUENCIAL (`main.js` + `cell.js`)

- **M1** (canal de eventos, incluido el fallback del host) + **M2** (lazo del ATP).
- Es el único trabajo que toca `main.js`. Debe terminar antes de C y D.

### Ola C — integración de la Ola A, SECUENCIAL (`cell.js`)

- **M3** (consumir `traffic.js`), **M5** (render de `motors.js`), **M4** (render de `mitosis.js`).

### Ola D — el resto, SECUENCIAL (`cell.js`)

- **M6** (fagocitosis), **M9** (fusión), **M7** (medio visible), **M10** (tejido), **M8** (blebbing).

### Reglas para todos los agentes

1. **TDD en lo puro**: test primero, verlo fallar, implementar. Lo de render se verifica con
   `npm run build` + smoke-run en Node (el navegador de este entorno no navega).
2. `npx vitest run --exclude '**/.claude/**'` debe quedar **verde** al terminar. Sin el flag,
   vitest recorre los worktrees y cuenta de más.
3. Comentarios y nombres **en español**, como el resto del repo.
4. **No** commitear ni pushear: eso lo hace la sesión coordinadora.
