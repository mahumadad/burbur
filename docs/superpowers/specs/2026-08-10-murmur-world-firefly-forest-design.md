# murmur-world · Mapa vivo (glade con individuos) — Diseño

**Fecha:** 2026-08-10 (rev. tras pivote visual)
**Estado:** en implementación. Motor de simulación + marco listos; render pivotado a "glade map".

> **Nota de historia:** este proyecto empezó como un "bosque nocturno de luciérnagas"
> (puntos que brillan en la oscuridad). Tras revisar el murmur real (renderer estilizado tipo
> *glade*), la dirección visual **pivotó** a un **mapa aéreo donde se mueven individuos**. El
> motor (agentes + sincronía + sonido + marco circular) se conserva; cambia la capa visual.

## Contexto

Recreación open-source, con estética propia inspirada en [mur mur](https://www.murmur.living/)
(oio + Mattering). El murmur real es una simulación con agentes + LLM (Qwen) + TTS (ElevenLabs)
renderizada en Three.js estilo *glade*; ese motor no es público. Este proyecto reconstruye el
**concepto** — un mundo vivo que se ve y suena — con herramientas open source, apuntando a
alimentar el device DIY ([oio/murmur-diy](https://github.com/oio/murmur-diy)), que reproduce un
`.avi` 466×466 desde una SD.

**Meta del build actual:** prototipo en navegador. Export a `.avi` para la SD es fase posterior.

## Decisiones

- **Ruta A:** simulación offline en el navegador (Three.js + Tone.js), capturable a video después.
- **Tema:** mapa/glade — pasto tupido, relieve terroso, cielo mínimo, vista **aérea 3/4**.
- **Individuos:** los agentes son criaturas coloridas que **se mueven por el mapa** y dejan
  **estela punteada**; laten (sincronía Kuramoto) y ese latido genera sonido.
- **Look:** 2.5D estilizado con textura *dithered/punteada* (firma de murmur), bloom suave,
  marco circular (lente).
- **Sonido:** híbrido — cama naturalista (viento + grillos) + notas pentatónicas en cada latido.
- **Ubicación:** `~/Dev/personal/murmur-world/`.

## Hoja de ruta (orden acordado)

1. **(hecho)** Motor de simulación: agentes con fase/posición, sincronía, estado del enjambre.
2. **(hecho)** Render base glade: cámara aérea, pasto instanciado, relieve, individuos con estela,
   marco circular.
3. **Textura dithered + flora** — estampado punteado en rocas/árboles + florecillas y brotes.
4. **Individuos distintos** — formas propias por especie (cubos wireframe cyan con ojo, estrellas
   amarillas, ráfagas) en vez de anillos iguales.
5. **Sonido** — conectar el motor de audio: los individuos generan el sonido emergente.

## Arquitectura

Módulos con una sola responsabilidad:

| Módulo | Responsabilidad | Estado |
|---|---|---|
| `sim/fireflies.js` | Agentes: fase, posición 3D, acoplamiento, deriva, destellos | hecho |
| `sim/ambient.js` | "Mundo": viento, grillos, búho | pendiente |
| `render/scene.js` | Escena glade: cámara aérea, pasto, relieve, individuos, estelas, bloom | en curso |
| `render/framing.js` | Máscara circular + viñeta (lente) | hecho |
| `audio/scale.js` | Mapeo posición → nota pentatónica | hecho |
| `audio/engine.js` | Grafo Tone.js: cama, drone, voces de latido, limiter | pendiente |
| `ui/panel.js` | Panel de dev: nº agentes, acoplamiento, volúmenes | pendiente |
| `main.js` | Bootstrap + loop; cablea sim→render→audio | en curso |

**Flujo por frame:** `main` avanza `sim` con `dt` → estado (posiciones, latidos, viento) →
`render/scene` (mapea posiciones al mapa, mueve individuos, siembra estelas, dibuja) y
`audio/engine` (dispara voz por latido, modula la cama por viento). `render/framing` compone el
marco circular.

## Modelo de simulación

### Individuos (`sim/fireflies.js`)

Cada agente: posición/velocidad (deriva por el volumen, con rebote), fase θ y frecuencia ω.
**Acoplamiento (Kuramoto):** `θ += (ω + (K/vecinas)·Σ sin(θ_j−θ_i))·dt`; al cruzar 2π **late**
(pico de brillo) y emite evento de sonido. Con `K` sobre el umbral, el enjambre sincroniza solo.
`render/scene.js` mapea la posición de la caja de simulación al mapa (con profundidad) y guarda
una **estela** (ring buffer por individuo, desvanecida). Función pura testeada: `stepPhases`.

### Mundo (`sim/ambient.js`)

Agentes ligeros que modulan atmósfera/sonido: viento (valor global lento), grillos (densidad
variable), búho (evento raro).

## Visual (`render/scene.js` + `render/framing.js`)

- Cámara **aérea 3/4** picada hacia el suelo; el mapa llena el cuadro, cielo mínimo.
- Suelo verde + **pasto instanciado** denso e inclinado (se lee desde arriba).
- Relieve: montículos terrosos (rocas) en plano medio + colinas verdes al fondo (suben el horizonte).
- **Individuos:** sprites/formas coloridas que se mueven; latido → brillo + bloom. **Estela**
  punteada que se desvanece (rastro de movimiento).
- **Textura dithered** (pendiente): estampado punteado en rocas/árboles — firma de murmur.
- **Flora** (pendiente): florecillas/brotes poblando el pasto.
- `framing.js`: máscara circular + viñeta (lente/display redondo). Base lista para exportar 466×466.

## Sonido (`audio/engine.js` + `audio/scale.js`)

Grafo Tone.js, mezcla que colapsa bien a **mono** (parlante del device). Cama naturalista (ruido
rosado filtrado por viento + grillos), drone grave con reverb, y **voces de latido** (cada destello
→ nota pentatónica; tono por posición, intensidad por brillo) con reverb compartido y tope de
polifonía. Master con **limiter −3 dB** (igual que `convert_for_sd.sh`). Arranque tras gesto del
usuario (`Tone.start()` en overlay "click para entrar").

## Interacción (mínima)

- Autónomo por defecto.
- Mouse: atrae a los individuos cercanos (el "asomarse").
- Tecla: perturba las fases (desincroniza) → demo de re-sincronización; emula el "shake" del device.

## Estructura y ejecución

Proyecto **Vite** (JS vanilla + `three` + `tone`).

```bash
npm install
npm run dev   # localhost; overlay "click para entrar" inicia el audio
npm test      # núcleo de simulación + mapeo de sonido
```

## Fuera de alcance (este spec)

- Export a `.avi` 466×466 y loop sin costura para la SD (fase posterior).
- Agentes con LLM/TTS (el pipeline "vivo" de murmur). Aquí el sonido es procedural.
- Foto-realismo. El objetivo es 2.5D estilizado, no render foto-realista.

## Camino al device (fase posterior)

Renderizar un segmento loopable a 466×466, capturar frames + audio, pasarlo por
`convert_for_sd.sh` (MJPEG 466×466 @15fps + PCM s16le 22050 Hz mono), copiar a la raíz de la SD
FAT32 con nombre que matchee un tema del firmware. Requiere diseño de loop sin costura.
