# Mapa de AUDIO de murmur.living (paridad)

**Fecha:** 2026-08-11
**Fuente:** `script-Daaf7S9n.js` (bundle minificado, 771 KB, ya descargado), cruzado con
`2026-08-10-paridad-murmur-analisis.md` y `2026-08-11-mapa-otros-mundos.md`.
**Método:** `grep -F`/`grep -oE` anclado, por trozos (sin regex compleja sobre el archivo completo).

---

## 0. Conclusión clave (léela antes que el resto)

**murmur.living NO sintetiza su música/ambiente en el navegador.** Todo el "drone profundo" y
la "cama psicodélica" que el usuario escucha son **2 archivos mp3 pre-renderizados por hora**
(música + atmósfera), grabados/producidos offline (probablemente con un DAW/synth real, no con
Web Audio). El bundle solo los **reproduce y mezcla**; no hay osciladores, filtros, reverb ni
delay para la cama musical.

Lo único que el bundle sintetiza en vivo con Web Audio es un **click-track para el gesto
"shake"** (un tren de clicks tipo geiger), y usa un **AudioContext solo para analizar el
espectro** (visualización) y para **grabar** la mezcla, no para generarla.

> Esto confirma y refuerza lo que ya habían encontrado en `2026-08-10-paridad-murmur-analisis.md`
> línea 23-24: *"en audio somos más 'vivos' que ellos (generamos procedural en el navegador con
> Tone.js; ellos reproducen mp3)"*. No hay algoritmo de drone que "extraer" — el material sonoro
> en sí no está en el JS. Lo que sí es replicable con evidencia es: la arquitectura de mezcla,
> el esquema de archivos/rutas, el sistema de sync horario, y el banco de SFX de fauna (que si
> tiene nombres de archivo legibles).

---

## 1. Arquitectura de audio — evidencia

### 1.1 Los dos stems (música + atmósfera)

```js
// build de rutas — grep -oE '.{20}function Ep.{250}' script-Daaf7S9n.js
Cp = {land: `forest`, water: `water`, city: `city`}
wp = 4      // partes por mundo
Tp = 3600   // segundos por parte (1 hora)

function Ep(e,t){ let n=Cp[e]; return `/radio/${n}/murmur-${n}-part${String(t+1).padStart(2,'0')}` }
function Dp(e,t){ return `${Ep(e,t)}-simple.json` }   // timeline de eventos
function Op(e,t){ return `${Ep(e,t)}-mus.mp3` }        // MÚSICA
function kp(e,t){ return `${Ep(e,t)}-atm.mp3` }         // ATMÓSFERA (WORLD)
function Ap(e,t){ let n=Math.max(0,Math.floor(t)); return n>0 ? `${e}#t=${n}` : e }  // seek offset
```

Rutas reales confirmadas (paridad-murmur-analisis.md): `murmur-city-part03-mus.mp3`,
`murmur-city-part03-atm.mp3`, `duration=3600`, offset `#t=902`.

Es decir, por mundo hay **4 partes** de **1 hora** cada una, cada una con **2 pistas** (mus/atm)
+ un JSON de eventos (`-simple.json`). Nada de esto se genera en el cliente.

### 1.2 Sync horario ("radio en vivo" simulado)

```js
// grep -oE 'function vm\(.{0,300}' script-Daaf7S9n.js
function vm(e){
  let t = new Date, n = t.getHours();
  return { partIndex: n % wp, offset: t.getMinutes()*60 + t.getSeconds() + t.getMilliseconds()/1e3, hour: n };
}
```

`partIndex = horaActual % 4` → las 4 partes se **ciclan 6 veces al día** (hora 0,4,8,12,16,20 →
parte 0; hora 1,5,9,13,17,21 → parte 1; etc.). El `offset` es minutos+segundos dentro de la hora
actual, usado como `#t=` para hacer *seek* al punto exacto — así todos los oyentes en el mismo
minuto real escuchan el mismo instante del mp3 (como una radio de verdad, no un loop personal).
Esto es independiente del **reloj de 12 fases** (night/dawn/rush hour/etc.) del HUD "ECOSYSTEM",
que es una capa de metadata narrativa separada (ver `paridad-murmur-analisis.md` §"Estado del
ecosistema").

### 1.3 El grafo Web Audio real (mezcla)

```js
// grep -oE 'ge=\(\)=>\{.{600}' script-Daaf7S9n.js
ge = () => {
  if (ce) return;                                   // ce = AudioContext (singleton)
  let e = window.AudioContext || window.webkitAudioContext;
  ce = new e;
  le = ce.createAnalyser();  le.fftSize = 512;  le.smoothingTimeConstant = .82;
  ue = new Uint8Array(le.frequencyBinCount);
  let t = ce.createMediaElementSource(x);   // x = <audio> MÚSICA
  let n = ce.createMediaElementSource(S);   // S = <audio> ATMÓSFERA
  fe = ce.createGain();  fe.gain.value = pe;   // pe = .55 (gain maestro por defecto)
  t.connect(fe);  n.connect(fe);
  fe.connect(le);  le.connect(ce.destination);
  try { de = ce.createMediaStreamDestination(); fe.connect(de); }  // tap para "grabar" el mix
  catch(e){ console.warn('Radio fullscreen record tap failed:', e); de = null; }
};
```

Grafo real: **`<audio> x (mus) ──┐**
**`<audio> S (atm) ──┴─→ GainNode fe (master, .55) → AnalyserNode le (fftSize 512) → destino`**
**`fe` también alimenta un `MediaStreamDestination` → `MediaRecorder` para exportar la grabación.**

- **No hay** `createConvolver` (reverb), **no hay** `createDelay`, **no hay**
  `createBiquadFilter`, **no hay** `createStereoPanner`/`createPanner`, **no hay** `Tone.*`
  (confirmado por conteo: 0 ocurrencias de cada uno en todo el bundle).
- El **Analyser** (`le`) no colorea el audio — solo lee `frequencyBinCount` (probablemente para
  animar el 3D/UI en reacción al espectro, no está confirmado a qué visual alimenta exactamente,
  pero es el único consumidor de `ue`/`frequencyBinCount`).
- El **fader MUSIC/WORLD** del HUD no toca el grafo Web Audio: opera **directo sobre
  `HTMLMediaElement.volume`** de `x`/`S` (`x.volume = H; x.muted = H===0; S.volume = te; S.muted
  = te===0`). El `GainNode fe` es un gain maestro fijo (con ramp suave via
  `setTargetAtTime` a 0 cuando ambos faders están en 0), no un mezclador por stem.

### 1.4 Único uso de osciladores: el "shake" (no es música)

Ya documentado en `2026-08-11-mapa-otros-mundos.md` líneas 396-411 y re-confirmado aquí
(`grep -oF createOscillator` = 1 ocurrencia en todo el bundle, `createGain` = 2):

```js
function og(e, t=1){
  let n = e.createOscillator(), r = e.createGain();
  n.type = 'triangle'; n.frequency.value = 800 /* + ruido, ver doc previo */;
  r.gain.setValueAtTime(1e-4, tNow);
  r.gain.exponentialRampToValueAtTime(Math.max(1e-4, dur), tNow + .002);
  r.gain.exponentialRampToValueAtTime(1e-4, tNow + .02 + Math.random()*.035);
  n.connect(r).connect(e.destination); n.start(tNow); n.stop(tNow + .12);
}
function sg(e=800){
  let t = window.AudioContext || window.webkitAudioContext;
  ig ||= new t; // AudioContext propio, separado de `ce`
  ig.state === 'suspended' && ig.resume().catch(()=>{});
  // tren de clicks (geiger-counter) durante `e` ms, acelerando
}
```

Esto es un **tren de clicks triangulares cortos (~12-120ms) con envolvente exponencial**, sin
relación con la música/ambiente. Es puramente un efecto de feedback táctil para el gesto shake,
en un `AudioContext` (`ig`) **distinto** del de la mezcla (`ce`).

---

## 2. Banco de fauna/eventos — samples, no síntesis

### 2.1 SFX de "shake" por mundo (confirmado, único lugar con `new Audio(...)` en todo el bundle)

```js
// grep -oE 'var ng=\{.{800}' script-Daaf7S9n.js — única ocurrencia de `new Audio(` en el bundle
var ng = {
  land:  ['forest-acorns-cascade', 'forest-blackbird-alarm', 'forest-blackbird-burst',
          'forest-squirrel-alarm', 'forest-twig-snap', 'forest-badger-alarm',
          'forest-magpie-attack'],
  water: ['water-heron-strike', 'water-cetti-burst', 'water-swan-takeoff',
          'water-geese-alarm', 'water-moorhen-alarm', 'water-vole-plop',
          'water-coot-eruption'],
  city:  ['city-skater-grind', 'city-ambulance-siren', 'city-tram-screech',
          'city-argument', 'city-glass-crash', 'city-fox-screech',
          'city-skater-kickflip', 'city-car-horn'],
};
function rg(){
  let e = ng[Im] || ng.land;                 // Im = mundo activo
  let t = e[Math.floor(Math.random()*e.length)];
  let a = new Audio(`/radio/shake-fx/${t}.mp3`);
  a.volume = .85; a.play().catch(()=>{});
}
```

**No existe "crow" (cuervo) en todo el bundle** (`grep -oF "crow"` → 0 ocurrencias). Sí existe
**"blackbird" (mirlo)**, 2 veces: `forest-blackbird-alarm` y `forest-blackbird-burst`. El córvido
más cercano por nombre es `forest-magpie-attack` (urraca) — si el usuario escuchó algo tipo
"cuervo" en el sitio real, es más probable que sea el mirlo/urraca del stem de fondo (que no está
en el JS, está grabado dentro del mp3 `-atm.mp3`), no un sample nombrado "crow".

**Esto responde la pregunta del usuario directamente: los sonidos de aves SÍ son samples
mp3 (uno por especie/evento), pero solo se disparan así para el gesto shake.** Para el
ambiente normal del mundo, los pájaros (si están) vienen **grabados dentro del `-atm.mp3`**, no
disparados individualmente por el cliente.

### 2.2 El JSON de eventos (`-simple.json`) no dispara sonidos

Confirmado por `2026-08-10-paridad-murmur-analisis.md` (esquema `events[]` con
`sound_source: "cache"|"ghost"|"live"|null`, `event_type: "sound"|"overview"|"residue"|...`): la
timeline de eventos es **texto + metadata para el log/HUD** (event_log_label, short_event_label,
ecosystem_setting), **no** referencias a archivos de audio individuales. El campo `sound_source`
describe cómo se originó ese sonido *cuando se generó offline la mezcla*, no una instrucción para
el cliente. El cliente nunca lee ese campo para reproducir nada — solo pinta el log y anima
agentes. Confirmado indirectamente: no hay más llamadas a `new Audio(` en el bundle aparte de
la de shake-fx (§2.1).

### 2.3 Home page: preview de audio por mundo

```js
// grep -oE 'function Dm\(.{0,300}' — contexto de _p
var _p = ['water', 'land', 'city'];
function Dm(){
  if (document.body.classList.contains('page-home'))
    for (let e of _p) { let t = document.createElement('audio'); t.preload='auto'; t.hidden=!0; ... }
}
```
Precarga silenciosa de `<audio>` por mundo en la home (para transición instantánea al entrar al
fullscreen), mismo mecanismo de mus/atm, no un sistema distinto.

---

## 3. La "cama" musical/drone — lo que SÍ y lo que NO se puede extraer

**No hay generador de drone en el JS.** No hay tabla de escalas, no hay frecuencias base, no hay
envolventes ADSR, no hay reverb/delay — porque la música **no se genera ahí**. Es contenido de
audio pre-producido (probablemente compuesto/renderizado en un DAW o motor de audio server-side
no expuesto al cliente) y sólo streameado como mp3.

Lo único parametrizable client-side es:
- **Qué parte suena** (`partIndex = hora % 4`, §1.2) → variación entre 4 composiciones fijas por
  mundo, cicladas 6x/día — **no** hay una cama continua que module con clima/actividad/tension en
  tiempo real; esas dimensiones (`weather`, `activity`, `tension` del HUD ecosystem) son
  **narrativas** (afectan el texto del log y probablemente influyeron en la composición offline),
  no inputs a un sintetizador en vivo.
- **Volumen/mute de MÚSICA y ATMÓSFERA** por separado (`x.volume`/`S.volume`, §1.3).
- **Gain maestro fijo** `pe=.55` con rampa a 0 si ambos faders están muteados.

**Conclusión para el objetivo de paridad:** no hay nada que "portar" del drone de murmur porque
no existe como algoritmo — es una grabación. Nuestra ventaja real (ya identificada en
`paridad-murmur-analisis.md`) es que **nuestro motor Tone.js procedural es más "vivo"** que el
de ellos. La sección 5 da lineamientos de diseño (no de "port") para lograr el vibe descrito.

---

## 4. Mezcla — buses y ganancias

| Elemento murmur | Equivalente conceptual nuestro | Notas |
|---|---|---|
| `<audio> x` (mus) + fader `H`/`MUSIC` | bus **MUSIC** | volumen directo sobre el elemento, no sobre un GainNode dedicado |
| `<audio> S` (atm) + fader `te`/`WORLD` | bus **WORLD** | idem |
| `GainNode fe` (pe=.55) | gain maestro global | solo se mueve a 0 cuando ambos faders están muteados (rampa `setTargetAtTime`) |
| `AnalyserNode le` (fftSize 512, smoothing .82) | opcional: feed para visuales reactivos | no afecta el sonido, solo lo lee |
| `MediaStreamDestination de` + `MediaRecorder` | función "grabar/exportar" el mix | tap post-gain maestro, pre-analyser branch no importa el orden exacto |

No hay bus de "SFX" separado — el shake-fx se reproduce con un `new Audio()` suelto y volumen
fijo `.85`, fuera del grafo Web Audio, mezclándose acústicamente pero no en el grafo lógico.

---

## 5. Cómo replicarlo (o superarlo) en nuestro engine Tone.js

Dado que no hay algoritmo de murmur que copiar para el drone, esto son **lineamientos de diseño**
para el vibe "psicodélico ambiental pero chill" + "sonidos profundos" que el usuario describe,
aprovechando que ya generamos procedural (ventaja real sobre murmur):

1. **Cama de drone real (lo que murmur NO tiene pero suena a eso):**
   - 2-3 osciladores detuned muy sutil (±3-7 cents) por nota — `Tone.Oscillator` tipo `sine`/
     `triangle` apilados, o `Tone.FatOscillator`, para el "grosor" psicodélico sin llegar a
     áspero.
   - Registro grave real: fundamentales en **C1-C2 / ~32-65 Hz** para el "muy profundo", con una
     capa media (C3-C4) para que no quede solo sub-bajo inaudible en parlantes chicos.
   - Escala: pentatónica menor o modo dórico/frigio para ambient — pocas notas, cambios lentos
     (cada 30-90s), sin resolución tonal fuerte (evita tónica-dominante clásico, mantiene el
     "flotando").
   - Envolventes larguísimas: attack 4-8s, release 6-15s (`Tone.AmplitudeEnvelope` o
     automatización de gain con `rampTo`), para que las notas aparezcan/desaparezcan sin ataque
     percusivo — clave para "chill".
   - Filtro pasabajos lento y modulado: `Tone.Filter` (lowpass) con LFO muy lento (`Tone.LFO`
     0.02-0.08 Hz) sobre la frecuencia de corte → efecto de "respiración" del drone.
   - **Reverb largo** (`Tone.Reverb` o `Tone.Freeverb`, decay 8-20s) + **delay con feedback**
     (`Tone.FeedbackDelay`, delayTime sincronizado a la escala/tempo lento, feedback .4-.6) —
     esto es lo que murmur *no* implementa client-side (nosotros sí podemos, y es gran parte del
     "psicodélico").
   - Modulación lenta de panorama estéreo (`Tone.AutoPanner` muy lento, 0.02-0.05 Hz) para
     movimiento espacial sutil.

2. **Modulación por estado del mundo (esto SÍ es nuestra ventaja sobre murmur, que no lo hace en
   vivo):**
   - `tension` → densidad armónica (más notas simultáneas / disonancias sutiles cuando sube) y
     velocidad del LFO del filtro.
   - `activity` → probabilidad/frecuencia de disparo de nuevas notas del drone.
   - hora del día / clima → elegir escala o centro tonal (ej. modo más brillante de día, más
     grave/oscuro de noche o con lluvia), igual que documentaron en `paridad-murmur-analisis.md`
     G10 ("MUSIC procedural modulado por tension").

3. **Aves/fauna (paridad directa, esto sí es 1:1 portable como *patrón*, no como archivo):**
   - Igual que murmur: **usar samples cortos por especie/evento**, no síntesis de canto de
     pájaro (síntesis de canto real es muy difícil de lograr creíble; murmur tampoco lo intenta
     — usa mp3). Definir un banco `ng`-equivalente por mundo/bioma con nombres tipo
     `forest-blackbird-*`, y disparar con `new Audio()` o mejor `Tone.Player` (para poder
     encadenar a un bus WORLD con reverb, algo que murmur no hace).
   - Diferencia a favor nuestro: como pasamos el player por un bus Tone.js, podemos darle **una
     pizca de reverb/space** al sample para que se sienta integrado al drone, algo que el
     `new Audio()` suelto de murmur no logra (sale seco, fuera del grafo).
   - Si se quiere variedad tipo "cuervo" que el usuario percibió y no está en el banco nombrado
     de murmur: es razonable sintetizar un graznido simple (ruido filtrado + pitch envelope
     rápido descendente, `Tone.Noise` → `Tone.Filter` bandpass barrido) como voz *adicional*
     nuestra, no como "paridad" (murmur no tiene un sample de crow nombrado).

4. **Mezcla (paridad simple):**
   - Dos buses **MUSIC** y **WORLD** con gain independiente (fader UI), igual que murmur
     (`x.volume`/`S.volume`), pero ambos pasando por Tone.Destination a través de un gain maestro
     — esto ya lo tenemos según `paridad-murmur-analisis.md` G10.
   - Opcional: agregar un tercer bus lógico **SFX** (aves/eventos) con su propio send a un reverb
     compartido, para que fauna y drone convivan en el mismo "espacio" — mejora sobre murmur, que
     mezcla el shake-fx completamente seco y fuera de grafo.

---

## 6. Resumen para citar rápido

| Pregunta del usuario | Respuesta con evidencia |
|---|---|
| ¿Web Audio crudo, Tone.js, o mp3? | **mp3 pre-renderizado** para música/ambiente (`Op`/`kp` → `-mus.mp3`/`-atm.mp3`); Web Audio crudo (sin Tone.js) solo para mezclar/analizar/grabar y para el click del shake |
| ¿Hay reverb/delay/filtros? | **No**, 0 ocurrencias de `createConvolver`/`createDelay`/`createBiquadFilter` en todo el bundle |
| ¿Cantos de aves = síntesis o samples? | **Samples** mp3 nombrados por especie (`forest-blackbird-alarm`, etc.), pero solo confirmados para el gesto **shake**; el ambiente normal trae fauna grabada dentro del `-atm.mp3`, no disparada por evento |
| ¿"Cuervo"? | No existe `crow` en el bundle; lo más cercano es `blackbird` (mirlo) y `magpie` (urraca) |
| ¿Cómo module el drone con hora/clima/tension? | **No lo hace en vivo** — solo elige cuál de las 4 partes pre-grabadas suena (`hora % 4`) y hace seek al segundo exacto (`hora:min:seg` real) |
| ¿Buses MUSIC/WORLD? | Sí, pero son **volumen directo sobre los dos `<audio>`**, no un mixer Web Audio; hay un gain maestro fijo (.55) que solo se usa para mute suave |

---

## Archivos/identificadores citados (para grep rápido futuro)

`Ep`, `Dp`, `Op`, `kp`, `Ap`, `Cp`, `wp`, `Tp`, `vm`, `he`, `ge`, `ce`, `le`, `ue`, `fe`, `de`,
`pe`, `x`, `S`, `ng`, `rg`, `og`, `sg`, `ig`, `ag`, `Im`, `_p`, `Dm`, `Fp`, `Em` — todos en
`script-Daaf7S9n.js`.
