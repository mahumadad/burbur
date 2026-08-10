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

  function setFlashVol(db) { flashGain.gain.rampTo(Tone.dbToGain(db), 0.1) }
  function setDroneVol(db) { droneGain.gain.rampTo(Tone.dbToGain(db), 0.1) }
  function setBedVol(db) { bedGain.gain.rampTo(Tone.dbToGain(db), 0.1) }

  return { triggerFlash, setWind, cricket, owl, accent, setFlashVol, setDroneVol, setBedVol }
}
