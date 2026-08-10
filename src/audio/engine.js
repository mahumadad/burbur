import * as Tone from 'tone'
import { flashToFreq } from './scale.js'

// Grafo de audio: cama naturalista + drone + voces de latido + capa de mundo.
// Pensado para colapsar bien a mono; master con limiter (igual que el device).
export async function createAudio(cfg) {
  const limiter = new Tone.Limiter(cfg.audio.masterLimitDb).toDestination()

  // Drone grave: dos osciladores desafinados + reverb.
  const droneReverb = new Tone.Reverb({ decay: 8, wet: 0.6 }).connect(limiter)
  const droneGain = new Tone.Gain(Tone.dbToGain(cfg.audio.volumes.drone)).connect(droneReverb)
  const oscA = new Tone.Oscillator(cfg.audio.droneRootHz, 'sine').start()
  const oscB = new Tone.Oscillator(cfg.audio.droneRootHz * 1.005, 'triangle').start()
  oscA.connect(droneGain); oscB.connect(droneGain)

  // Cama: ruido rosado → filtro (modulado por viento).
  const bedGain = new Tone.Gain(Tone.dbToGain(cfg.audio.volumes.bed)).connect(limiter)
  const bedFilter = new Tone.Filter(500, 'lowpass').connect(bedGain)
  const noise = new Tone.Noise('pink').start()
  noise.connect(bedFilter)

  // Voces de latido: PolySynth suave + reverb compartido.
  const flashReverb = new Tone.Reverb({ decay: 5, wet: 0.5 }).connect(limiter)
  const flashGain = new Tone.Gain(Tone.dbToGain(cfg.audio.volumes.flash)).connect(flashReverb)
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.0, release: 1.2 },
  })
  synth.maxPolyphony = cfg.audio.flashPolyphony
  synth.connect(flashGain)

  // Grillos: ráfaga corta de ruido pasa-banda, paneada al azar.
  const cricketPan = new Tone.Panner(0).connect(bedGain)
  const cricketFilter = new Tone.Filter(4200, 'bandpass').connect(cricketPan)
  cricketFilter.Q.value = 8
  const cricketEnv = new Tone.AmplitudeEnvelope({ attack: 0.005, decay: 0.05, sustain: 0, release: 0.03 }).connect(cricketFilter)
  const cricketNoise = new Tone.Noise('white').start()
  cricketNoise.connect(cricketEnv)

  // Búho: dos tonos descendentes suaves.
  const owlSynth = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.08, decay: 0.2, sustain: 0.3, release: 0.5 },
  }).connect(droneReverb)
  owlSynth.volume.value = -16

  const boundsY = cfg.fireflies.bounds.y

  function triggerFlash(y, intensity) {
    const f = flashToFreq(y, boundsY, 220, 3)
    try { synth.triggerAttackRelease(f, 0.5, undefined, 0.2 + 0.6 * intensity) } catch (_) {}
  }

  function setWind(w) {
    const clamped = Math.max(0, Math.min(1, w))
    bedFilter.frequency.rampTo(300 + clamped * 1800, 0.3)
    bedGain.gain.rampTo(Tone.dbToGain(cfg.audio.volumes.bed) * (0.5 + clamped), 0.3)
  }

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

  // Graznido áspero (corvidos): ruido pasabanda + tono grave.
  const cawBP = new Tone.Filter(1200, 'bandpass').connect(faunaPan); cawBP.Q.value = 2.2
  const cawEnv = new Tone.AmplitudeEnvelope({ attack: 0.006, decay: 0.14, sustain: 0, release: 0.05 }).connect(cawBP)
  const cawNoise = new Tone.Noise('pink').start(); cawNoise.connect(cawEnv)

  // Golpe/pisada (animal que camina) + crujido de hojas.
  const thud = new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 4, envelope: { attack: 0.001, decay: 0.2, sustain: 0 } }).connect(faunaPan)
  thud.volume.value = -14
  const rustleEnv = new Tone.AmplitudeEnvelope({ attack: 0.01, decay: 0.18, sustain: 0, release: 0.05 }).connect(new Tone.Filter(2600, 'highpass').connect(faunaPan))
  const rustleNoise = new Tone.Noise('brown').start(); rustleNoise.connect(rustleEnv)

  // Insecto/textura aguda.
  const buzzFilter = new Tone.Filter(5200, 'bandpass').connect(faunaPan); buzzFilter.Q.value = 7
  const buzzEnv = new Tone.AmplitudeEnvelope({ attack: 0.004, decay: 0.1, sustain: 0.2, release: 0.05 }).connect(buzzFilter)
  const buzzNoise = new Tone.Noise('white').start(); buzzNoise.connect(buzzEnv)

  const rand = Math.random
  function fauna(type, dir, name = '') {
    faunaPan.pan.value = PAN[dir] ?? 0
    const t = Tone.now()
    const n = name.toLowerCase()
    if (type === 'flying_animal') {
      if (/owl|nightjar/.test(n)) { hoot(260 + rand() * 60, 0.35, t); hoot(240, 0.4, t + 0.5) }
      else if (/crow|jay|magpie|rook/.test(n)) { cawEnv.triggerAttackRelease(0.14, t); if (rand() < 0.6) cawEnv.triggerAttackRelease(0.12, t + 0.22) }
      else if (/dove|cuckoo|pigeon/.test(n)) { chirp(520, 470, 0.18, t); chirp(430, 410, 0.22, t + 0.26) }
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
    } else {
      chirp(700, 620, 0.14, t) // humano: silbido suave
    }
  }
  function insect(dir) {
    faunaPan.pan.value = PAN[dir] ?? 0
    try { buzzEnv.triggerAttackRelease(0.06, Tone.now()) } catch (_) {}
  }

  // ─── Trueno: sub-retumbo + ruido filtrado + chasquido, potente ────────────
  const thunderOut = new Tone.Gain(1.0).connect(limiter)
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
  const rainOut = new Tone.Gain(0).connect(limiter)
  const rainHP = new Tone.Filter(900, 'highpass').connect(rainOut)
  const rainNoise = new Tone.Noise('white').start(); rainNoise.connect(rainHP)
  function setRain(i) {
    const g = Math.max(0, Math.min(1, i))
    rainOut.gain.rampTo(g * 0.5, 0.4)
    rainHP.frequency.rampTo(700 + g * 1500, 0.4)
  }
  // Gota: tic corto y agudo, paneado.
  const dripPan = new Tone.Panner(0).connect(limiter)
  const dripFilter = new Tone.Filter(3000, 'bandpass').connect(dripPan); dripFilter.Q.value = 3
  const dripEnv = new Tone.AmplitudeEnvelope({ attack: 0.001, decay: 0.02, sustain: 0, release: 0.01 }).connect(dripFilter)
  const dripNoise = new Tone.Noise('white').start(); dripNoise.connect(dripEnv)
  function drip() {
    dripPan.pan.value = Math.random() * 2 - 1
    dripFilter.frequency.value = 1800 + Math.random() * 3200
    try { dripEnv.triggerAttackRelease(0.01) } catch (_) {}
  }

  function setFlashVol(db) { flashGain.gain.rampTo(Tone.dbToGain(db), 0.1) }
  function setDroneVol(db) { droneGain.gain.rampTo(Tone.dbToGain(db), 0.1) }
  function setBedVol(db) { bedGain.gain.rampTo(Tone.dbToGain(db), 0.1) }

  return {
    triggerFlash, setWind, cricket, owl, accent, fauna, insect, thunder,
    setRain, drip, setFlashVol, setDroneVol, setBedVol,
  }
}
