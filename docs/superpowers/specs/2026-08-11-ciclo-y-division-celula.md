# Ciclo celular y división real — spec

**Fecha:** 2026-08-11
**Estado:** aprobado para implementar.
**Motivo:** el usuario preguntó si un macrófago hace mitosis o meiosis y si "se podría reproducir a
veces". La pregunta destapó un error de diseño propio.
**Doc padre:** `2026-08-11-diseno-mundo-celula.md` (concepto y decisiones cerradas).

---

## 1. El error que corregimos

**Meiosis: nunca.** Un macrófago es una célula somática; la meiosis es exclusiva de la línea
germinal. Fuera de discusión.

**Mitosis: sí, pero no como está.** El dogma clásico decía que los macrófagos eran terminalmente
diferenciados y que la población se repone reclutando monocitos. Desde ~2011–2013 se sabe que los
**macrófagos residentes de tejido se auto-renuevan localmente**, y que esa proliferación se
**induce por señal** (IL-4, M-CSF), típicamente en inflamación. Es **lenta y ocasional**.

Lo que el mundo hace hoy, verificado en el código:

| Problema | Evidencia |
|---|---|
| La división es un **reloj**, no una decisión | `ecosystem.js:158` — `Math.floor(t / phaseLen)`, avance por puro tiempo |
| Mitosis **garantizada cada 9 min**, perfectamente periódica | `config.js:102` — `dayLengthSec: 540` |
| **No existe G0**, que es el estado real de un macrófago casi siempre | `CELL_PHASES` no lo incluye |
| **Se divide en nada**: sigue habiendo una sola célula | la citocinesis emite evento y nada cambia |

El último es el peor: es un evento narrado que miente.

---

## 2. El cambio de fondo

**El ciclo celular deja de ser el reloj del mundo y pasa a ser un acontecimiento ocasional.**

Lo que ocupa su lugar como "hora del día" es el **ritmo funcional del macrófago** — que además es
real: la actividad fagocítica y la secreción de citoquinas están bajo control circadiano.

```
ANTES:  hora del día = ciclo celular (12 fases, siempre girando, mitosis garantizada)
AHORA:  hora del día = estado funcional (12 fases, ritmo del macrófago)
        ciclo celular = máquina aparte, en G0 por defecto, que arranca SOLO si hay señal
```

Ventaja de diseño: **no toca la lógica de `ecosystem.js`** (que es compartida con bosque, agua y
ciudad). Solo cambia la TABLA de datos del perfil de la célula. El ciclo vive en su propio módulo
puro.

---

## 3. Las 12 fases funcionales (reemplazan a las del ciclo)

Reescribir `CELL_PHASES` y `CELL_PHASE` en `src/sim/ecosystem.js`. Se mantienen **12** a propósito:
`clockLabel()` en `main.js` divide por 12 para el timestamp del log.

| # | Fase (clave interna) | Español (i18n) | act | Carácter |
|---|---|---|---|---|
| 0 | `resting` | reposo | 0.30 | Quieto, poca demanda |
| 1 | `surveillance` | vigilancia | 0.45 | Empieza a moverse |
| 2 | `patrolling` | patrulla | 0.62 | Migración de base |
| 3 | `chemotaxis` | quimiotaxis | 0.78 | Persigue el gradiente |
| 4 | `alert` | alerta | 0.72 | Tensión alta |
| 5 | `hunting` | caza | 0.90 | Pico de actividad |
| 6 | `engulfing` | fagocitosis | 0.85 | Engulle |
| 7 | `digesting` | digestión | 0.60 | Lisosomas activos |
| 8 | `antigen presentation` | presentación de antígeno | 0.55 | Función inmune real |
| 9 | `cytokine secretion` | secreción de citoquinas | 0.68 | Señaliza al tejido |
| 10 | `efferocytosis` | barrido de restos | 0.58 | Limpia células muertas (real) |
| 11 | `recovery` | recuperación | 0.40 | Baja a reposo |

`temp` queda en 37 en todas (la homeostasis no cambia). `light`/`gain` con una curva suave: más
brillo en el pico (caza) y más frío/apagado en reposo. Los 6 medios (`CELL_MEDIA`) **no cambian**.

---

## 4. `src/sim/cellCycle.js` — módulo puro nuevo

La máquina del ciclo, **gateada por condiciones**.

```js
export const STAGE = { G0:'G0', G1:'G1', S:'S', G2:'G2', M:'M', CYTO:'cytokinesis' }

export function createCycle(cfg)
// → { stage:'G0', t:0, readiness:0, refractory:0, divisions:0 }

export function updateCycle(cycle, cfg, dt, ctx)
// ctx = { atp: 0..1, medium: string }
// → Array<{ kind:'commit'|'abort'|'enter'|'divide', stage }>   eventos del frame

/** Traduce la etapa M a la sub-fase que ya entiende `mitosis.js`. NO duplicar esa lógica. */
export function mitoticSubPhase(cycle)
// → { phase: 'prophase'|'metaphase'|'anaphase'|'telophase'|'cytokinesis', phaseT: 0..1 }
// fuera de M/CYTO → { phase: 'G1', phaseT: 0 }  (mitosisState devuelve todo en 0)
```

### Comportamiento

1. **G0 (por defecto).** Es donde vive casi siempre.
   - Si `atp >= cfg.atpMin` **y** `medium ∈ cfg.mitogenicMedia` → `readiness += cfg.readinessRate * dt`.
   - Si no → `readiness -= cfg.readinessDecay * dt` (mínimo 0). Esto modela **integración de señal
     sostenida**: un pico corto de nutrientes no alcanza, hace falta que se mantenga.
   - `refractory` baja con el tiempo; mientras sea > 0, la readiness no sube (no puede dividirse dos
     veces seguidas).
   - `readiness >= 1` → pasa a **G1**, evento `enter`.

2. **G1.** Dura `cfg.g1`. Al terminar, **punto de restricción** — el nombre real de esta decisión:
   - Condiciones todavía buenas → **compromiso**: pasa a S, evento `commit`.
   - Condiciones perdidas → **aborta** a G0 con readiness en 0, evento `abort`.

3. **S → G2 → M → CYTO.** Duraciones de config. **Después del punto de restricción NO se aborta**:
   comprometida, la célula termina el ciclo pase lo que pase. Es la biología real y es lo que hace
   que la compuerta signifique algo.

4. **Fin de CYTO** → evento `divide`, vuelve a `G0`, `refractory = cfg.refractory`,
   `readiness = 0`, `divisions++`.

### Config (`cc.cycle` en `config.js`)

```js
cycle: {
  atpMin: 0.55,
  mitogenicMedia: ['nutrient rich', 'inflamed'],  // IL-4/M-CSF: prolifera con nutrientes o inflamación
  readinessRate: 0.05,     // ~20 s sostenidos para decidirse
  readinessDecay: 0.12,    // se desarma más rápido de lo que se arma
  g1: 18, s: 22, g2: 12, m: 16, cyto: 8,   // segundos
  refractory: 90,          // no se divide en cadena
}
```

### Tests obligatorios (`test/cellCycle.test.js`)

- Arranca en G0 y **se queda ahí** indefinidamente si el ATP es bajo o el medio no es mitogénico.
- Con condiciones buenas sostenidas entra a G1 (evento `enter`), y **no antes** de `1/readinessRate` s.
- Un pico corto de condiciones buenas **no** alcanza (la readiness decae).
- **Aborta** en el punto de restricción si las condiciones se pierden durante G1 → vuelve a G0.
- **No aborta** si las condiciones se pierden en S/G2/M (ya está comprometida) → llega a dividir.
- Un ciclo completo emite exactamente **un** `divide`.
- Tras dividir no puede volver a entrar antes de `refractory`.
- `mitoticSubPhase` recorre las 5 sub-fases en orden durante M+CYTO y devuelve `phaseT` en [0,1].
- Sin NaN tras miles de pasos con condiciones aleatorias.

---

## 5. Narración por `kind` — mejora del narrador

Hoy el narrador solo permite reemplazar plantillas **por tipo de evento**. Los acontecimientos
grandes del ciclo necesitan frase propia. Agregar a `src/sim/narrator.js`:

```js
// En narrate(), ANTES del override por tipo:
if (ev.kind && lex.byKind && lex.byKind[ev.kind]) return lex.byKind[ev.kind](ctx, ev, rand)
```

Retro-compatible (si no hay `byKind`, todo sigue igual) y le da a **cualquier** mundo una vía limpia
para narrar sus momentos propios. En `CELL_LEXICON`:

```js
byKind: {
  enter:  → 'El núcleo se prepara: la célula entra en ciclo.'            short: 'entra en ciclo'
  commit: → 'Cruza el punto de restricción. Ya no hay vuelta atrás.'     short: 'punto de restricción'
  abort:  → 'La señal se apaga; la célula vuelve a la quiescencia.'      short: 'vuelve a G0'
  divide: → 'El anillo contráctil aprieta. La célula se parte en dos.'   short: 'división'
  phagocytosis / infection / digestion / fusion / fission: mantener lo que ya narran hoy
}
```

---

## 6. La división produce una HIJA (lo que hoy falta)

Al evento `divide`:

1. **Nace una hija.** Módulo nuevo `src/worlds/cell/daughter.js`, pool fijo de 3.
   - Contorno congelado (armónicos fijos, como las vecinas de `tissue.js`), radio ~0.7 del de la madre.
   - Nace **pegada a la madre, en un polo**: desplazada **a lo largo del eje del huso**.
     *(Corrección: este spec decía originalmente "perpendicular al eje del huso" y estaba mal —
     el surco estrangula el ECUADOR, que es lo perpendicular, y por eso las dos mitades se separan
     SOBRE el eje del huso, cada una con el juego de cromosomas que viajó a su polo. Lo detectó el
     agente implementador, que además implementó lo escrito y marcó la discrepancia en vez de
     taparla.)*
   - Va en el **grupo `substrate`**, con la misma matemática que las adhesiones: guarda su posición
     de nacimiento y el offset del sustrato de ese instante. Así, **cuando la madre siga reptando,
     la hija se queda atrás y se aleja sola** — sin animarla.
   - Además, un empujón propio durante los primeros ~10 s (la separación física real).
   - Se desvanece al llegar al borde y libera su slot.

2. **La madre se encoge.** Cada hija se lleva la mitad: al dividir, `membrane.baseR` cae a ~0.72 del
   valor nominal y **se recupera durante los siguientes ~40 s**. Hace la división consecuente en vez
   de decorativa. Guardar el `baseR` nominal aparte para poder restaurarlo.

---

## 7. Cableado en `cell.js`

- Crear el ciclo junto al resto de la simulación.
- Cada frame: `updateCycle(cycle, cc.cycle, step, { atp: atp.budget, medium: eco?.weather })`.
- **La mitosis ya no se lee de `eco.phase`.** Hoy `cell.js` hace `mitosisState(eco.phase, eco.phaseT)`;
  pasa a `mitosisState(...mitoticSubPhase(cycle))`. `src/sim/mitosis.js` **no se toca**.
- El **redondeo mitótico** (que hoy usa `MITOTIC_PHASES.has(eco.phase)`) pasa a
  `cycle.stage === 'M' || cycle.stage === 'CYTO'`.
- Los eventos de `updateCycle` se empujan al array `events` que `update()` ya devuelve, con
  `{ type:'moment', agent:'el núcleo', agentType:'structure', kind }`.
- `MITOTIC_PHASES` queda sin uso en `cell.js` → quitar el import si no lo usa nadie más.

---

## 8. Criterios de aceptación

1. En medio `hypoxic` o `serum starved` sostenido, la célula **nunca** entra en ciclo.
2. En `nutrient rich` sostenido entra, y tarda ≥ 20 s en decidirse.
3. Si el medio se corta durante G1 → aborta y lo narra.
4. Si se corta después del punto de restricción → **igual se divide**.
5. Al dividirse: se ve el estrangulamiento, **aparece una hija** que se aleja, la madre se encoge y
   se recupera, y el log lo narra.
6. Entre división y división pasa al menos `refractory`.
7. Suite verde (141 actuales + los nuevos). `npm run build` limpio.

---

## 9. Qué NO hacer

- **No** tocar la lógica de `ecosystem.js` (solo su tabla de datos para la célula): es compartida.
- **No** tocar `src/sim/mitosis.js`: ya está testeado y se reutiliza vía `mitoticSubPhase`.
- **No** borrar ni reordenar `agents`/`roamers` al dividir (rompe nombres, hover y estelas).
- **No** meter meiosis en ninguna forma: sería un error biológico.

---

## 10. Olas

- **Ola 1 (archivo nuevo, aislado):** `src/sim/cellCycle.js` + `test/cellCycle.test.js`. TDD.
- **Ola 2 (el resto, secuencial):** tabla de fases en `ecosystem.js` + `i18n.js`, `byKind` en
  `narrator.js`, `daughter.js`, y el cableado en `cell.js`.
