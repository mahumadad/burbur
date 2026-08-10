# Análisis de paridad con murmur.living + plan

**Fecha:** 2026-08-10
**Método:** inspección en vivo de https://murmur.living (DOM, red, WebGL, JSON de datos).
**Objetivo:** llegar a paridad funcional y visual, añadir el mundo ciudad, más eventos y complejidad.

---

## 1. Cómo funciona murmur.living (evidencia, no suposición)

### Arquitectura confirmada

| Capa | Qué es | Evidencia |
|---|---|---|
| **3D** | Three.js **r184** en vivo, canvas `radio-fs-canvas`, **orbitable** | `window.__THREE__ = 184`; arrastrar rota la cámara (verificado) |
| **Audio** | **2 stems pre-renderizados** de 3600 s (1 h) | `<audio>` con `murmur-city-part03-mus.mp3` (MÚSICA) y `-atm.mp3` (ATMÓSFERA), `duration=3600`, sincronizados por `#t=902` |
| **Eventos** | **Timeline JSON pre-horneado** | `/radio/city/murmur-city-part03-simple.json` (548 KB): `agents_list` + `events` |
| **Video** | Solo decorativo (hero, lentes, loops de la landing) | `Murmur_city.mp4` etc. quedan detrás del canvas (z-index 1) |

**Conclusión clave:** el "radio" de la web **no simula en vivo**. Reproduce una hora ya generada:
audio en 2 pistas + una lista de eventos con timestamps. Lo único vivo es el render 3D.

> Esto invierte el diagnóstico intuitivo: en **audio somos más "vivos" que ellos** (generamos
> procedural en el navegador con Tone.js; ellos reproducen mp3). El déficit real está en
> **riqueza visual, mundo, agentes y eventos**.

### Modelo de datos (esquema real)

```jsonc
{
  "agents_list": [ { "name": "urban fox", "type": "walking_animal" } ],
  "events": [{
    "timestamp": 10.49,                 // segundos desde el inicio
    "event_type": "interaction",        // ver tipos abajo
    "sound_source": "cache",            // ghost | cache | live | null
    "event_log_label": "The taxi brakes hard and cuts left, its",  // texto del log
    "short_event_label": "taxi brakes sharply",                    // texto corto (píldora)
    "agent_name": "taxi",
    "agent_speed": 0,
    "direction": "left",                // left|right|ahead|behind|above|below|all around
    "ecosystem_setting": {
      "weather": "heavy rain", "time": "night",
      "activity": 0.6, "tension": 0.426
    }
  }]
}
```

**Tipos de evento y su función narrativa** (frecuencia en ciudad / bosque):

| Tipo | Ciudad | Bosque | Qué hace |
|---|---|---|---|
| `sound` | 913 | 1649 | Sonido atómico ambiental. El grueso. |
| `overview` | 93 | 181 | Frase-resumen del estado del mundo ("A taxi cuts hard through rain-lashed midnight streets.") |
| `residue` | 69 | 240 | Cola/consecuencia de una acción previa |
| `interaction` | 60 | 73 | Un agente actúa sobre otro/el entorno |
| `shift` | 17 | 23 | Cambio de fase (clima/hora) |
| `moment` | 15 | 33 | Hito destacado (campana, etc.) |
| `conflict` | 13 | 12 | Choque entre agentes |
| `setup` / `distant` / `peak` / `passing` / `resolution` | pocos | pocos | Arco narrativo |

**Densidad:** ciudad ≈ **20 eventos/min**; bosque ≈ **37 eventos/min**. (Nosotros hoy: 0.)

### Estado del ecosistema (HUD "BLOCK ECOSYSTEM")

`TIME` · `WEATHER` · `TEMPERATURE` · `ACTIVITY` (barra %) · `TENSION` (barra) + sliders
`MUSIC` y `WORLD` (volumen de cada stem).

- **12 fases horarias.** Ciudad: night, late night, pre-dawn, early morning, rush hour,
  mid-morning, late morning, midday, early afternoon, afternoon, evening rush, evening.
  Bosque: night, pre-dawn, dawn chorus, first light, early morning, mid-morning, morning,
  midday, early afternoon, afternoon, golden hour, dusk.
- **Clima por mundo.** Ciudad: overcast, fog, windy, clear, light rain, heavy rain.
  Bosque: after rain, frost, heavy rain, light rain, dry still.
- `activity` y `tension` ∈ [0,1] derivan del clima/hora y modulan densidad y carácter.

### Poblaciones

- **Ciudad (BLOCK): 40 agentes** — 18 `human`, 10 `moving_object`, 5 `static_object`,
  4 `flying_animal`, 3 `walking_animal`. (peatones, ciclista, tranvía, palomas, busker, café,
  obra, zorro urbano, reloj de iglesia, ambulancia, camión de basura, robot de reparto…)
- **Bosque (PLOT): 38 agentes** — 23 `flying_animal`, 7 `walking_animal`, 5 `human`,
  3 `static_object`. (pito real, cárabo, corzo, corneja, tejón, zorro, arroyo, insectos, leñador…)
- **Agua (POND):** tercer mundo, mismo patrón.

### UI de la web

Píldora "ahora sonando" (etiqueta corta del evento) · botones de mundo (ciudad/bosque/agua) ·
botón **Shake** · **EVENTS LOG** con timestamps · panel ECOSYSTEM · panel HOW IT WORKS ·
botón **RECORD** con waveform · etiquetas flotantes sobre agentes ("GREEN WOODPECKER").

---

## 2. Qué se rescata de nuestro código

**Se conserva (base sólida):**

| Nuestro | Uso en la nueva arquitectura |
|---|---|
| `render/scene.js` — pasto instanciado, dither Bayer, flora, árboles secos, bloom | Base del bioma **PLOT**; el dither ya replica su estampado |
| Estelas punteadas por individuo | Paridad directa: sus trails son punteados iguales |
| `sim/fireflies.js` — Kuramoto | **Se reinterpreta**: deja de ser "destello" y pasa a ser el *reloj interno* de cada agente (cuándo actúa). La sincronía sigue dando ritmo emergente |
| `audio/engine.js` + `scale.js` | Pasa a ser la capa **MUSIC** (procedural) — ventaja sobre su mp3 |
| `audio/ambient` (viento/grillos/búho) | Semilla de la capa **WORLD/atmósfera** |
| `render/framing.js` | Se reserva para el **modo device** (lente circular 466×466), no para la vista web |
| `ui/panel.js` | Evoluciona al panel ECOSYSTEM |

**Se reemplaza:** el suelo infinito (→ isla/diorama), los "individuos" genéricos sin identidad
(→ agentes con nombre/tipo/comportamiento), cámara fija (→ órbita).

---

## 3. Brecha de paridad (13 ítems)

| # | Brecha | Impacto | Esfuerzo |
|---|---|---|---|
| G1 | **Isla/diorama** flotando en negro (no plano infinito) | Alto | Medio |
| G2 | **Órbita de cámara** (drag rota, scroll zoom) | Alto | Bajo |
| G3 | **Agentes con identidad**: nombre + tipo + comportamiento por tipo | Alto | Medio |
| G4 | **Motor de eventos**: 10 tipos, con generador de texto | Alto | Medio |
| G5 | **Events log UI** con timestamps | Alto | Bajo |
| G6 | **Estado del ecosistema**: 12 fases horarias, clima, temp, activity, tension | Alto | Medio |
| G7 | **Ciclo día/noche** que ilumina la escena | Alto | Medio |
| G8 | **Clima visual**: lluvia, niebla, viento | Medio | Medio |
| G9 | **Mundo CIUDAD (BLOCK)**: edificios, calles, farolas, vehículos | Alto | Alto |
| G10 | **2 capas de audio** (MUSIC / WORLD) con volumen independiente | Medio | Bajo |
| G11 | **Dirección espacial** del sonido (left/right/above…) → paneo estéreo | Medio | Bajo |
| G12 | **Etiquetas flotantes** sobre agentes al pasar el mouse | Bajo | Bajo |
| G13 | **Selector de mundos** (ciudad/bosque/agua) | Medio | Bajo |

---

## 4. Decisión de diseño importante: el generador de texto

Ellos generan las etiquetas con un LLM (Qwen) en servidor y las hornean en el JSON. Para
nosotros, **no hace falta LLM**: un **generador gramatical** (plantillas + vocabulario por
especie/acción/adverbio) produce frases del mismo tipo, en tiempo real y sin costo:

```
[interaction]  "El {agente} {verbo} {adverbio} contra {objeto}"
[overview]     "{Sujeto} {verbo} entre {clima} de {hora}."
[residue]      "El {objeto} sigue {gerundio} {adverbio}"
```

Cada agente aporta su léxico. Esto además nos deja **eventos infinitos y siempre nuevos**,
mientras que su web repite la misma hora horneada.

> **Nota:** usamos su **esquema** (estructura de datos), no su contenido. El vocabulario y las
> frases son nuestros; no copiamos sus etiquetas ni sus audios.

---

## 5. Plan por fases

Cada fase deja algo funcional y demostrable.

### Fase A — Cámara e isla (base espacial) · G1, G2
- Terreno como **isla redondeada** (disco con borde irregular y caída), flotando en negro.
- **OrbitControls** con límites (no bajar del horizonte, zoom acotado), auto-rotación lenta al estar inactivo.
- Reubicar pasto/flora/rocas dentro de la isla.

### Fase B — Ecosistema + tiempo/clima · G6, G7, G8
- `sim/ecosystem.js` (puro): reloj de 12 fases, clima con transiciones, temperatura, `activity`, `tension`.
- Iluminación y paleta que responden a la hora (amanecer cálido, noche fría) y al clima.
- Lluvia (streaks tipo su render), niebla por densidad, viento que mece pasto.
- Panel **ECOSYSTEM** en la UI.

### Fase C — Agentes con identidad + eventos · G3, G4, G5, G11, G12
- `sim/agents.js`: censo con `name` + `type`; comportamiento por tipo
  (`flying_animal` vuela y se posa, `walking_animal` sigue senderos, `moving_object` recorre rutas,
  `static_object` no se mueve pero suena, `human` deambula).
- `sim/events.js`: motor de eventos con los 10 tipos, densidad modulada por `activity`,
  detección de proximidad → `interaction`/`conflict`, colas → `residue`, resúmenes → `overview`.
- `sim/narrator.js`: generador gramatical de `event_log_label` y `short_event_label`.
- UI: **EVENTS LOG** + píldora "ahora sonando" + etiquetas flotantes.
- Audio: paneo estéreo según `direction`.

### Fase D — Mundo CIUDAD (BLOCK) · G9, G13
- `worlds/city.js`: manzanas de pasto separadas por calles, edificios (losas apiladas, paleta
  naranja/crema/violeta), farolas, plaza, charcos.
- Censo urbano propio (peatones, tranvía, palomas, robot de reparto, zorro urbano…).
- `worlds/forest.js`: extraer el glade actual a este módulo.
- Selector de mundos con transición.

### Fase E — Audio en 2 capas · G10
- Separar **MUSIC** (nuestro motor pentatónico, modulado por `tension`) y **WORLD** (atmósfera:
  clima, ambiente, sonidos de agentes), con sliders independientes.

### Fase F (opcional) — Mundo AGUA (POND) + export al device
- Tercer mundo; y el pipeline de captura a `.avi` 466×466 para el hardware.

---

## 6. Recomendación de orden

**A → B → C → D → E.**

Razón: la **órbita y la isla (A)** cambian de inmediato la sensación de "diorama" y son baratas;
el **ecosistema (B)** es el motor del que cuelga todo lo demás (los eventos necesitan hora/clima
para tener sentido); **C** es el corazón (lo que hace que el mundo *cuente algo*); **D** es la
ciudad pedida, que se apoya en todo lo anterior; **E** pule el audio.

Saltar directo a la ciudad (D) daría edificios bonitos pero vacíos, sin eventos ni vida.
