import * as Tone from 'tone'
import MANIFEST from './fauna-manifest.json'

// Samples REALES de fauna (Wikimedia Commons, CC — ver CREDITS.md). El manifest
// mapea el NOMBRE del agente (tal cual el censo) → archivo en public/audio/fauna/.
// Carga perezosa: hasta que carguen, play() devuelve false y el motor cae al
// synth. Los agentes sin sample también caen al synth. Un solo panner compartido
// (como las voces sintéticas): se setea antes de disparar.
export function createFaunaSamples(destination) {
  const keys = Object.keys(MANIFEST)
  if (!keys.length) return { play: () => false, ready: () => false }

  const pan = new Tone.Panner(0).connect(destination)
  const gain = new Tone.Gain(0.85).connect(pan)
  const players = new Tone.Players(MANIFEST, { baseUrl: '/audio/fauna/' }).connect(gain)

  /** Reproduce el sample real del agente. Devuelve false si no hay/no cargó. */
  function play(name, dirPan = 0) {
    if (!players.loaded || !MANIFEST[name] || !players.has(name)) return false
    pan.pan.value = dirPan
    const p = players.player(name)
    p.stop() // reinicia si ya sonaba (evita solaparse consigo mismo)
    p.start()
    return true
  }
  return { play, ready: () => players.loaded }
}
