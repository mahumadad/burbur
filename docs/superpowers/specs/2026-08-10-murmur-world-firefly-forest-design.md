# murmur-world · Bosque nocturno de luciérnagas — Diseño

**Fecha:** 2026-08-10
**Estado:** aprobado (brainstorming), pendiente de plan de implementación

## Contexto

Recreación open-source, con tema propio, del concepto de [mur mur](https://www.murmur.living/)
(oio + Mattering): "un mundo vivo dentro de un parlante". El mundo real de murmur es una
simulación con agentes + LLM (Qwen) + TTS (ElevenLabs) renderizada en Three.js; ese motor no
es público. Este proyecto reconstruye el **concepto** — no el pipeline comercial — con
herramientas open source, y apunta a alimentar el device DIY
([oio/murmur-diy](https://github.com/oio/murmur-diy)), que solo reproduce un `.avi` desde una SD.

**Meta de este build:** prototipo en navegador que corre y se ve/oye. La exportación a `.avi`
466×466 para la SD es una fase posterior, no parte de este spec.

## Decisiones (tomadas en brainstorming)

- **Ruta A:** simulación offline en el navegador (Three.js + Tone.js), capturable a video después.
- **Tema:** bosque nocturno de luciérnagas.
- **Look:** 2.5D con profundidad y glow (bloom, niebla, siluetas).
- **Sonido:** híbrido — cama naturalista (viento + grillos) + notas pentatónicas en cada destello.
- **Ubicación:** `~/Dev/personal/murmur-world/` (proyecto personal).

## Concepto

Un bosque nocturno autónomo. Cientos de luciérnagas vuelan a la deriva y **se sincronizan solas**:
cada una tiene una fase interna que se acopla a la de sus vecinas (modelo tipo Kuramoto), de modo que
un enjambre inicialmente caótico termina pulsando junto. Cada destello es a la vez un pico de luz y un
evento de sonido. Encima, una atmósfera de viento y grillos da el sentido de "lugar". Corre aunque
nadie mire.

## Arquitectura

Módulos con una sola responsabilidad, comunicados por interfaces claras:

| Módulo | Responsabilidad | Depende de |
|---|---|---|
| `main.js` | Bootstrap, loop de animación (rAF), cablea sim→render→audio | todos |
| `sim/fireflies.js` | Modelo de agentes: fase, posición 3D, acoplamiento, deriva. Emite destellos. | — (puro) |
| `sim/ambient.js` | Viento (parámetro global lento), grillos, búho ocasional (scheduler) | — (puro) |
| `render/scene.js` | Escena Three.js: cámara, niebla, árboles, sprites de luciérnagas, bloom | three |
| `render/framing.js` | Máscara circular + viñeta (emula lente/display redondo) | — |
| `audio/engine.js` | Grafo Tone.js: cama, drone, voces de destello, master limiter | tone, audio/scale |
| `audio/scale.js` | Mapea profundidad/posición → nota de escala pentatónica | — (puro) |
| `ui/panel.js` | Panel de dev: nº agentes, acoplamiento, volúmenes, toggles | — |

**Flujo de datos por frame:** `main` avanza `sim/fireflies` y `sim/ambient` con `dt` → obtiene la
lista de destellos de este frame y el estado (posiciones, brillos, parámetro de viento) → los pasa a
`render/scene` (actualiza sprites/bloom/árboles) y a `audio/engine` (dispara voces por destello,
modula la cama por viento). `render/framing` compone el marco circular al final.

## Modelo de simulación

### Luciérnagas (`sim/fireflies.js`)

Cada agente:
- `pos` (Vec3), `vel` (Vec3): deriva suave = wander de baja frecuencia + separación mínima para
  repartirse en profundidad y dar parallax. Confinadas a un volumen (caja/elipsoide).
- `phase` θ ∈ [0, 2π), `omega` ω: frecuencia natural con leve dispersión entre agentes.
- **Acoplamiento (Kuramoto discretizado):** por paso, `θ += ω·dt + (K/n_vecinas)·Σ sin(θ_j − θ_i)·dt`
  sobre vecinas dentro de un radio. `K` = fuerza de acoplamiento (parámetro).
- **Destello:** cuando θ cruza 2π, se marca destello (envolvente de brillo corta), se resetea la fase
  y se agrega un evento `{id, pos, intensity}` a la lista del frame.

Emergencia esperada: con `K` sobre un umbral, el enjambre pasa de caótico a sincronizado solo.

**Función pura testeable:** `stepPhases(phases, omegas, neighbors, K, dt)` es determinista →
test: dos osciladores acoplados convergen en fase en N pasos (varianza de fase decreciente).

### Mundo (`sim/ambient.js`)

Agentes ligeros, no renderizados como objetos; modulan atmósfera y sonido:
- **Viento:** un valor global que varía lento (ruido/seno de baja frecuencia). Mece árboles, mueve la
  niebla y controla la capa de ruido de la cama sonora.
- **Grillos:** densidad variable; disparan ráfagas cortas paneadas al azar.
- **Búho:** evento raro programado (scheduler con probabilidad baja por unidad de tiempo).

## Visual (`render/scene.js` + `render/framing.js`)

- `PerspectiveCamera` + `FogExp2`: velo de profundidad; las luciérnagas lejanas se atenúan.
- Luciérnagas = sprites con blending aditivo (glow) + pase **UnrealBloom** (postproceso) para el
  florecimiento al destellar. El brillo de cada sprite sigue la envolvente de su destello.
- Fondo: gradiente azul-verde muy oscuro; siluetas de árboles = planos casi negros al fondo, con
  mecido sutil según el viento.
- Bruma/polen: partículas sutiles a la deriva para dar volumen al aire.
- `framing.js`: máscara circular con viñeta encima de la escena → emula el display redondo y el lente.
  Deja el camino listo para exportar un cuadro 466×466 más adelante.

## Sonido (`audio/engine.js` + `audio/scale.js`)

Grafo Tone.js, mezcla pensada para colapsar bien a **mono** (el parlante del device es mono):

- **Cama naturalista:** ruido rosado → pasabajos modulado por el parámetro de viento (ráfagas).
  Capa de grillos: ráfagas cortas filtradas, paneadas al azar, densidad variable. Búho: evento raro.
- **Drone grave:** dos osciladores desafinados en la nota raíz + reverb larga (colchón).
- **Voces de destello:** cada destello → nota de **escala pentatónica** (`audio/scale.js` mapea
  profundidad/posición → grado de la escala; nunca disuena). Sinte suave; intensidad de la nota = brillo
  del destello. Reverb compartido. **Tope de polifonía** para que la sincronización suene a acorde, no
  a barro.
- **Master:** limiter a **−3 dB** (igual que `convert_for_sd.sh` del device).

Restricción de arranque: el audio requiere un gesto del usuario (política de autoplay) → overlay
"click para entrar" que hace `Tone.start()`.

## Interacción (mínima)

- Autónomo por defecto.
- Mouse: atrae suavemente a las luciérnagas cercanas (el "asomarse").
- Tecla (p. ej. barra espaciadora): perturba todas las fases (desincroniza) → demo de la
  re-sincronización; emula el "shake" del device.

## Estructura y ejecución

Proyecto **Vite** (JS vanilla + `three` + `tone`).

```
murmur-world/
  index.html
  src/
    main.js
    sim/{fireflies.js, ambient.js}
    render/{scene.js, framing.js}
    audio/{engine.js, scale.js}
    ui/panel.js
  test/fireflies.test.js
  docs/superpowers/specs/2026-08-10-murmur-world-firefly-forest-design.md
  package.json
```

```bash
npm install
npm run dev   # localhost; overlay "click para entrar" inicia el audio
```

## Testing

- Juguete audiovisual → el grueso es validación a ojo/oído.
- Test unitario del corazón determinista: `stepPhases` — dos osciladores acoplados convergen en fase
  en N pasos (la varianza de fase decrece bajo un umbral).

## Panel de dev (`ui/panel.js`)

Controles en vivo para tunear sin recompilar: nº de luciérnagas, `K` (acoplamiento), dispersión de ω,
volúmenes de cada capa (drone / cama / destellos), toggle de bloom, radio de vecindad.

## Fuera de alcance (este spec)

- Exportación a `.avi` 466×466 y loop sin costura para la SD (fase posterior).
- Agentes con LLM/TTS (el pipeline "vivo" de murmur). Aquí el sonido es procedural.
- Múltiples temas / cambio de tema tipo device (solo el bosque de luciérnagas).

## Camino al device (fase posterior, referencia)

Cuando el prototipo convenza: renderizar un segmento loopable a 466×466, capturar frames + audio,
pasarlo por `convert_for_sd.sh` (MJPEG 466×466 @15fps + PCM s16le 22050 Hz mono), copiar a la raíz de
la SD FAT32 con nombre que matchee un tema del firmware. Requiere diseño de loop sin costura.
