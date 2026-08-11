import * as Tone from 'tone'
import { flashToFreq } from './scale.js'
import { createFaunaSamples } from './samples.js'

// Grafo de audio: cama naturalista + drone + voces de latido + capa de mundo.
// Pensado para colapsar bien a mono; master con limiter (igual que el device).
export async function createAudio(cfg) {
  const limiter = new Tone.Limiter(cfg.audio.masterLimitDb).toDestination()
  // ── Tres capas de mezcla, con su propio fader (los sliders del HUD) ────────
  //   FONDO    = el drone ambiental.
  //   MUNDO    = el clima: truenos, viento (cama de ruido) y lluvia.
  //   ACTIVIDAD = la vida: fauna (síntesis + samples), grillos, búho, latidos.
  const busDrone = new Tone.Gain(1).connect(limiter)
  const busWeather = new Tone.Gain(1).connect(limiter)
  const busActivity = new Tone.Gain(1).connect(limiter)
  // Samples reales de fauna (CC). Si el agente tiene sample cargado, suena el
  // real; si no, cae a las voces sintéticas de abajo. Van a la capa ACTIVIDAD.
  const faunaSamples = createFaunaSamples(busActivity)

  // ─── Drone psicodélico ambiental (chill) ──────────────────────────────────
  // murmur usa mp3 pre-renderizados por hora; nosotros lo SINTETIZAMOS (más vivo).
  // Cadena: voces graves detuned → filtro con LFO lento (respira) → autopan lento
  //         → reverb largo + delay con feedback → limiter.
  const droneReverb = new Tone.Reverb({ decay: 20, wet: 0.78 }).connect(busDrone)
  const droneDelay = new Tone.FeedbackDelay({ delayTime: 0.75, feedback: 0.48, wet: 0.32 }).connect(busDrone)
  const droneAutoPan = new Tone.AutoPanner({ frequency: 0.03, depth: 0.55 }).start()
  droneAutoPan.connect(droneReverb); droneAutoPan.connect(droneDelay)
  const droneFilter = new Tone.Filter(360, 'lowpass').connect(droneAutoPan)
  droneFilter.Q.value = 2.2 // más resonante → barrido "vocal", psicodélico
  // LFO muy lento sobre el corte → el drone "respira", y se queda GRAVE/oscuro.
  const droneLFO = new Tone.LFO({ frequency: 0.04, min: 90, max: 520 }).start()
  droneLFO.connect(droneFilter.frequency)
  const droneGain = new Tone.Gain(Tone.dbToGain(cfg.audio.volumes.drone)).connect(droneFilter)
  // Pulso hipnótico (throb) tipo Enter the Void: tremolo lento SOBRE las voces,
  // antes del volumen, para que el bajo "late/respira" sin pelear con el slider.
  const droneThrob = new Tone.Gain(1).connect(droneGain)
  const throbLFO = new Tone.LFO({ frequency: 0.2, min: 0.6, max: 1.0, type: 'sine' }).start()
  throbLFO.connect(droneThrob.gain)

  // Voces: sub (una octava abajo, "muy profundo") + fundamental + quinta, con
  // FatOscillator para el grosor psicodélico sin volverse áspero.
  const droneRoot = cfg.audio.droneRootHz
  const droneVoices = [
    new Tone.FatOscillator(droneRoot / 2, 'sine', 8),
    new Tone.FatOscillator(droneRoot, 'triangle', 12),
    new Tone.FatOscillator(droneRoot * 1.5, 'sine', 16),
  ]
  for (const v of droneVoices) { v.count = 3; v.start(); v.connect(droneThrob) }

  // Evolución armónica lenta: cada ~22s mueve las notas por una pentatónica
  // menor con rampas largas → pad flotante, sin resolución tonal (chill).
  const PENT = [1, 1.2, 1.3333, 1.5, 1.8]
  const droneEvolve = setInterval(() => {
    const a = PENT[(Math.random() * PENT.length) | 0]
    const fifth = PENT[3 + ((Math.random() * 2) | 0)] // 1.5 o 1.8
    droneVoices[0].frequency.rampTo(droneRoot * a / 2, 15)
    droneVoices[1].frequency.rampTo(droneRoot * a, 15)
    droneVoices[2].frequency.rampTo(droneRoot * a * fifth, 15)
  }, 30000) // deriva glacial: pad flotante, más hipnótico

  // Cama: ruido rosado → filtro (modulado por viento).
  const bedGain = new Tone.Gain(Tone.dbToGain(cfg.audio.volumes.bed)).connect(busWeather)
  const bedFilter = new Tone.Filter(500, 'lowpass').connect(bedGain)
  const noise = new Tone.Noise('pink').start()
  noise.connect(bedFilter)

  // Voces de latido: PolySynth suave + reverb compartido.
  const flashReverb = new Tone.Reverb({ decay: 5, wet: 0.5 }).connect(busActivity)
  const flashGain = new Tone.Gain(Tone.dbToGain(cfg.audio.volumes.flash)).connect(flashReverb)
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.0, release: 1.2 },
  })
  synth.maxPolyphony = cfg.audio.flashPolyphony
  synth.connect(flashGain)

  // Grillos: ráfaga corta de ruido pasa-banda, paneada al azar.
  const cricketPan = new Tone.Panner(0).connect(busActivity)
  const cricketFilter = new Tone.Filter(4200, 'bandpass').connect(cricketPan)
  cricketFilter.Q.value = 8
  const cricketEnv = new Tone.AmplitudeEnvelope({ attack: 0.005, decay: 0.05, sustain: 0, release: 0.03 }).connect(cricketFilter)
  const cricketNoise = new Tone.Noise('white').start()
  cricketNoise.connect(cricketEnv)

  // Búho: dos tonos descendentes suaves.
  const owlSynth = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.08, decay: 0.2, sustain: 0.3, release: 0.5 },
  }).connect(flashReverb) // búho → capa ACTIVIDAD (con reverb), no al drone
  owlSynth.volume.value = -16

  const boundsY = cfg.fireflies.bounds.y

  function triggerFlash(y, intensity) {
    const f = flashToFreq(y, boundsY, 220, 3)
    try { synth.triggerAttackRelease(f, 0.5, undefined, 0.2 + 0.6 * intensity) } catch (_) {}
  }

  // El bed de "mundo" es clima de exterior: en mundos interiores (célula,
  // neurona) se apaga por completo para que no arrastre el fondo de los otros.
  let bedWind = 0, bedOn = true
  function applyBed() {
    const g = bedOn ? Tone.dbToGain(cfg.audio.volumes.bed) * (0.5 + bedWind) : 0
    bedGain.gain.rampTo(g, 0.3)
  }
  function setWind(w) {
    bedWind = Math.max(0, Math.min(1, w))
    bedFilter.frequency.rampTo(300 + bedWind * 1800, 0.3)
    applyBed()
  }
  function setWeatherBed(on) { bedOn = on; applyBed() }

  function cricket() {
    cricketPan.pan.value = Math.random() * 2 - 1
    cricketEnv.triggerAttackRelease(0.03)
  }

  function owl() {
    const now = Tone.now()
    owlSynth.triggerAttackRelease(320, 0.25, now)
    owlSynth.triggerAttackRelease(260, 0.5, now + 0.28)
  }

  // Acento de evento: nota suave paneada según la dirección del evento.
  const accentPan = new Tone.Panner(0).connect(flashReverb)
  const accentSynth = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.008, decay: 0.5, sustain: 0, release: 0.4 },
  }).connect(accentPan)
  accentSynth.volume.value = -18
  const PAN = { left: -0.7, right: 0.7, ahead: 0, behind: 0, above: 0.25, below: -0.25, 'all around': 0 }
  const ACCENT_HZ = [220, 262, 294, 330, 392, 440]
  function accent(dir, hzIndex) {
    accentPan.pan.value = PAN[dir] ?? 0
    const f = ACCENT_HZ[hzIndex % ACCENT_HZ.length]
    try { accentSynth.triggerAttackRelease(f, 0.3) } catch (_) {}
  }

  // ─── Voces de fauna: síntesis con barridos de frecuencia (más natural) ────
  const faunaPan = new Tone.Panner(0).connect(flashReverb)

  // Voz de canto: oscilador con barrido de tono + envolvente + pasabanda.
  const songBP = new Tone.Filter(3000, 'bandpass').connect(faunaPan); songBP.Q.value = 3
  const songEnv = new Tone.AmplitudeEnvelope({ attack: 0.004, decay: 0.04, sustain: 0.6, release: 0.03 }).connect(songBP)
  const songOsc = new Tone.Oscillator(2200, 'sine').start(); songOsc.connect(songEnv)
  // Chirrido: barrido de f0→f1 en `dur`, con la envolvente disparada.
  function chirp(f0, f1, dur, t) {
    songOsc.frequency.setValueAtTime(f0, t)
    songOsc.frequency.linearRampToValueAtTime(f1, t + dur)
    songEnv.triggerAttackRelease(dur, t)
  }

  // Ululato grave (búho/chotacabras).
  const hootEnv = new Tone.AmplitudeEnvelope({ attack: 0.09, decay: 0.25, sustain: 0.4, release: 0.25 }).connect(faunaPan)
  const hootOsc = new Tone.Oscillator(300, 'sine').start(); hootOsc.connect(hootEnv)
  hootEnv.connect(new Tone.Gain(0.6).connect(faunaPan))
  function hoot(f, dur, t) {
    hootOsc.frequency.setValueAtTime(f, t)
    hootOsc.frequency.linearRampToValueAtTime(f * 0.92, t + dur)
    hootEnv.triggerAttackRelease(dur, t)
  }

  // Graznido áspero (cuervos/córvidos): ruido pasabanda con barrido DESCENDENTE
  // (la inflexión típica del "craa") + un tono grave rasposo que le da cuerpo.
  const cawBP = new Tone.Filter(1400, 'bandpass').connect(faunaPan); cawBP.Q.value = 3.2
  const cawEnv = new Tone.AmplitudeEnvelope({ attack: 0.006, decay: 0.16, sustain: 0, release: 0.06 }).connect(cawBP)
  const cawNoise = new Tone.Noise('pink').start(); cawNoise.connect(cawEnv)
  const cawToneEnv = new Tone.AmplitudeEnvelope({ attack: 0.006, decay: 0.16, sustain: 0, release: 0.06 }).connect(new Tone.Gain(0.5).connect(faunaPan))
  const cawTone = new Tone.Oscillator(320, 'sawtooth').start(); cawTone.connect(cawToneEnv)
  function caw(t, dur = 0.16) {
    cawBP.frequency.setValueAtTime(1700, t)
    cawBP.frequency.linearRampToValueAtTime(780, t + dur)
    cawTone.frequency.setValueAtTime(330, t)
    cawTone.frequency.linearRampToValueAtTime(210, t + dur)
    cawEnv.triggerAttackRelease(dur, t)
    cawToneEnv.triggerAttackRelease(dur, t)
  }

  // Golpe/pisada (animal que camina) + crujido de hojas.
  const thud = new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 4, envelope: { attack: 0.001, decay: 0.2, sustain: 0 } }).connect(faunaPan)
  thud.volume.value = -14
  const rustleEnv = new Tone.AmplitudeEnvelope({ attack: 0.01, decay: 0.18, sustain: 0, release: 0.05 }).connect(new Tone.Filter(2600, 'highpass').connect(faunaPan))
  const rustleNoise = new Tone.Noise('brown').start(); rustleNoise.connect(rustleEnv)

  // Insecto/textura aguda.
  const buzzFilter = new Tone.Filter(5200, 'bandpass').connect(faunaPan); buzzFilter.Q.value = 7
  const buzzEnv = new Tone.AmplitudeEnvelope({ attack: 0.004, decay: 0.1, sustain: 0.2, release: 0.05 }).connect(buzzFilter)
  const buzzNoise = new Tone.Noise('white').start(); buzzNoise.connect(buzzEnv)

  // Voz de la CÉLULA: un "bloop" húmedo y redondo (nada de pájaro) para los
  // eventos del mundo interior (organelos, motores, invasores).
  const bloopLP = new Tone.Filter(700, 'lowpass').connect(faunaPan); bloopLP.Q.value = 2.5
  const bloopEnv = new Tone.AmplitudeEnvelope({ attack: 0.004, decay: 0.16, sustain: 0, release: 0.08 }).connect(bloopLP)
  const bloopOsc = new Tone.Oscillator(200, 'sine').start(); bloopOsc.connect(bloopEnv)
  function bloop(f, t) {
    bloopOsc.frequency.setValueAtTime(f * 1.4, t)
    bloopOsc.frequency.exponentialRampToValueAtTime(f, t + 0.12) // caidita "gota"
    bloopEnv.triggerAttackRelease(0.13, t)
  }

  // Voz de la NEURONA: un tick eléctrico seco y corto (nada húmedo — la célula
  // ya tomó ese registro). Más agudo para interneuronas (disparo rápido), más
  // grave para la glía. El sonido propio del mundo (clicks de spike, ritmos) es F5.
  const tickBP = new Tone.Filter(2600, 'bandpass').connect(faunaPan); tickBP.Q.value = 4
  const tickEnv = new Tone.AmplitudeEnvelope({ attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 }).connect(tickBP)
  const tickNoise = new Tone.Noise('white').start(); tickNoise.connect(tickEnv)
  function tick(hz) { tickBP.frequency.value = hz; try { tickEnv.triggerAttackRelease(0.02) } catch (_) {} }

  // ─── Click del SPIKE (mundo neurona) ──────────────────────────────────────
  // Un potencial de acción sonificado es literalmente esto: un click seco y
  // brevísimo, sin reverb. Muchos juntos suenan a lluvia / palomitas de maíz —
  // el registro multiunidad real. Paneado por la posición de la neurona.
  const spikeGain = new Tone.Gain(0.30).connect(busActivity)
  const spikePan = new Tone.Panner(0).connect(spikeGain)
  const spikeBP = new Tone.Filter(2800, 'bandpass').connect(spikePan); spikeBP.Q.value = 1.1
  const spikeEnv = new Tone.AmplitudeEnvelope({ attack: 0.0004, decay: 0.008, sustain: 0, release: 0.004 }).connect(spikeBP)
  const spikeNoise = new Tone.Noise('white').start(); spikeNoise.connect(spikeEnv)
  function spike(pan = 0, bright = 1) {
    spikePan.pan.value = Math.max(-1, Math.min(1, pan))
    spikeBP.frequency.value = 1700 + bright * 2400
    try { spikeEnv.triggerAttackRelease(0.006) } catch (_) {}
  }
  // Ritmo cerebral (delta/theta/alfa/gamma) → velocidad del throb del drone: en
  // sueño profundo late lento e hipnótico; despierto, un temblor rápido. Es la
  // forma correcta de oír los ritmos (están por debajo del rango de tono).
  function setThrob(hz) { throbLFO.frequency.rampTo(Math.max(0.05, hz), 0.6) }

  const rand = Math.random
  function fauna(type, dir, name = '') {
    // Primero el sample REAL del animalito; si no hay/no cargó, voz sintética.
    if (faunaSamples.play(name, PAN[dir] ?? 0)) return
    faunaPan.pan.value = PAN[dir] ?? 0
    const t = Tone.now()
    const n = name.toLowerCase()
    if (type === 'flying_animal') {
      if (/owl|nightjar|tucúquere|tucuquere|lechuza|concón|concon/.test(n)) { hoot(260 + rand() * 60, 0.35, t); hoot(240, 0.4, t + 0.5) }
      else if (/crow|jay|magpie|rook|raven|tiuque|jote|traro|tordo/.test(n)) { const reps = 1 + ((rand() * 3) | 0); for (let k = 0; k <= reps; k++) caw(t + k * (0.22 + rand() * 0.1), 0.14 + rand() * 0.06) }
      else if (/dove|cuckoo|pigeon|torcaza|tórtola|tortola/.test(n)) { chirp(520, 470, 0.18, t); chirp(430, 410, 0.22, t + 0.26) }
      else { // canto: trino de 2–4 chirridos ascendentes
        const reps = 2 + ((rand() * 3) | 0)
        const base = 1600 + rand() * 900
        for (let k = 0; k < reps; k++) chirp(base, base + 700 + rand() * 500, 0.06 + rand() * 0.03, t + k * 0.1)
      }
    } else if (type === 'walking_animal') {
      thud.triggerAttackRelease(50 + rand() * 30, 0.16, t)
      rustleEnv.triggerAttackRelease(0.14, t + 0.02)
    } else if (type === 'static_object') {
      if (/stream/.test(n)) buzzEnv.triggerAttackRelease(0.25, t) // agua
      else buzzEnv.triggerAttackRelease(0.1, t)
    } else if (type === 'organelle' || type === 'invader' || type === 'motor' ||
               type === 'structure' || type === 'signal') {
      // Vida celular: bloops por tipo. Invasores más agudos; motores, graves.
      const f = type === 'invader' ? 320 + rand() * 130 : type === 'motor' ? 130 : 190 + rand() * 90
      bloop(f, t)
    } else if (type === 'neuron' || type === 'interneuron' || type === 'glia' ||
               type === 'neurotransmitter' || type === 'tissue') {
      tick(type === 'interneuron' ? 3400 : type === 'glia' ? 1200 : 2600)
    } else if (type === 'soil_fauna') {
      rustleEnv.triggerAttackRelease(0.08, t) // roce menudo de bicho de suelo
    } else if (type === 'mycelium' || type === 'colony') {
      // Húmedo y grave: el "pico eléctrico" que emite la red (Adamatzky).
      bloop(80 + rand() * 60, t)
    } else if (type === 'substrate') {
      buzzEnv.triggerAttackRelease(0.12, t) // madera/materia que cruje
    } else {
      chirp(700, 620, 0.14, t) // humano: silbido suave
    }
  }
  function insect(dir) {
    faunaPan.pan.value = PAN[dir] ?? 0
    try { buzzEnv.triggerAttackRelease(0.06, Tone.now()) } catch (_) {}
  }

  // ─── Trueno: sub-retumbo + ruido filtrado + chasquido, potente ────────────
  const thunderOut = new Tone.Gain(1.0).connect(busWeather)
  const thunderGain = new Tone.Gain(0).connect(thunderOut)
  const thunderFilter = new Tone.Filter(180, 'lowpass').connect(thunderGain)
  const thunderNoise = new Tone.Noise('brown').start(); thunderNoise.connect(thunderFilter)
  const subGain = new Tone.Gain(0).connect(thunderOut)
  const subOsc = new Tone.Oscillator(42, 'sine').start(); subOsc.connect(subGain)
  const crack = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.3, sustain: 0 } })
  const crackFilter = new Tone.Filter(1800, 'highpass').connect(thunderOut)
  crack.connect(crackFilter); crack.volume.value = -4
  function thunder(intensity = 1) {
    const t = Tone.now()
    const dur = 2.8 + intensity * 2
    try {
      crack.triggerAttackRelease(0.25, t)
      thunderGain.gain.cancelScheduledValues(t)
      thunderGain.gain.setValueAtTime(0.001, t)
      thunderGain.gain.linearRampToValueAtTime(0.9 + 0.5 * intensity, t + 0.06)
      thunderGain.gain.exponentialRampToValueAtTime(0.001, t + dur)
      thunderFilter.frequency.setValueAtTime(70 + 160 * intensity, t)
      subGain.gain.cancelScheduledValues(t)
      subGain.gain.setValueAtTime(0.001, t + 0.05)
      subGain.gain.linearRampToValueAtTime(0.5 + 0.3 * intensity, t + 0.12)
      subGain.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.8)
    } catch (_) {}
  }

  // ─── Lluvia: siseo de banda ancha + goteo individual ──────────────────────
  const rainOut = new Tone.Gain(0).connect(busWeather)
  const rainHP = new Tone.Filter(900, 'highpass').connect(rainOut)
  const rainNoise = new Tone.Noise('white').start(); rainNoise.connect(rainHP)
  function setRain(i) {
    const g = Math.max(0, Math.min(1, i))
    rainOut.gain.rampTo(g * 0.5, 0.4)
    rainHP.frequency.rampTo(700 + g * 1500, 0.4)
  }
  // Gota: tic corto y agudo, paneado.
  const dripPan = new Tone.Panner(0).connect(busWeather)
  const dripFilter = new Tone.Filter(3000, 'bandpass').connect(dripPan); dripFilter.Q.value = 3
  const dripEnv = new Tone.AmplitudeEnvelope({ attack: 0.001, decay: 0.02, sustain: 0, release: 0.01 }).connect(dripFilter)
  const dripNoise = new Tone.Noise('white').start(); dripNoise.connect(dripEnv)
  function drip() {
    dripPan.pan.value = Math.random() * 2 - 1
    dripFilter.frequency.value = 1800 + Math.random() * 3200
    try { dripEnv.triggerAttackRelease(0.01) } catch (_) {}
  }

  // Traqueteo del "shake": tren de clicks triangulares (800–2500 Hz) que decae
  // en ~800 ms. Igual espíritu que el click-track del shake de murmur.
  const rattleOut = new Tone.Gain(0.5).connect(busActivity)
  function rattle(ms = 800) {
    const start = Tone.now()
    let t = 0
    while (t < ms / 1000) {
      const osc = new Tone.Oscillator(800 + Math.random() * 1700, 'triangle')
      const g = new Tone.Gain(0).connect(rattleOut)
      osc.connect(g)
      const at = start + t
      const mag = 1 - (t / (ms / 1000)) * 0.35
      g.gain.setValueAtTime(1e-4, at)
      g.gain.linearRampToValueAtTime(0.28 * mag, at + 0.002)
      g.gain.exponentialRampToValueAtTime(1e-4, at + 0.02 + Math.random() * 0.035)
      osc.start(at); osc.stop(at + 0.12)
      const kill = (t + 0.35) * 1000
      setTimeout(() => { try { osc.dispose(); g.dispose() } catch (_) {} }, kill)
      t += 0.04 + Math.random() * 0.075
    }
  }

  // Faders de las 3 capas (los sliders del HUD). El balance interno de cada
  // capa lo fijan droneGain/bedGain/flashGain; estos buses son el volumen grupal.
  function setDroneVol(db) { busDrone.gain.rampTo(Tone.dbToGain(db), 0.15) }      // FONDO
  function setWeatherVol(db) { busWeather.gain.rampTo(Tone.dbToGain(db), 0.15) }  // MUNDO (clima)
  function setActivityVol(db) { busActivity.gain.rampTo(Tone.dbToGain(db), 0.15) } // ACTIVIDAD (fauna)
  // El drone "respira" más rápido y se pone más resonante con la tensión del mundo.
  function setMood(tension) {
    const t = Math.max(0, Math.min(1, tension || 0))
    droneLFO.frequency.rampTo(0.035 + t * 0.11, 3)
    droneFilter.Q.rampTo(1.1 + t * 1.7, 3)
  }

  return {
    triggerFlash, setWind, cricket, owl, accent, fauna, insect, thunder,
    setRain, drip, setDroneVol, setWeatherVol, setActivityVol, setMood, rattle,
    spike, setThrob, setWeatherBed,
  }
}
