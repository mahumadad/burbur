// Narrador gramatical: convierte un evento en texto (español). Puro y determinista.
// Estilo bitácora: usa el nombre como sujeto SIN artículo, para no lidiar con el
// género ("MIRLO canta...", "ZORRO se aleja..."). Los objetos estáticos ya traen
// su artículo en el nombre ("el arroyo", "la hojarasca").

import { phaseES, weatherES } from '../i18n.js'

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const pick = (arr, rand) => arr[(rand() * arr.length) | 0]

// Acciones por tipo: { l: fragmento largo, s: forma corta }.
const ACTIONS = {
  flying_animal: [
    { l: 'canta fino y agudo', s: 'canta' },
    { l: 'parlotea desde una rama oculta', s: 'parlotea' },
    { l: 'tamborilea sobre madera muerta', s: 'tamborilea' },
    { l: 'da una vuelta por encima', s: 'sobrevuela' },
    { l: 'regaña a un intruso invisible', s: 'regaña' },
    { l: 'deja caer una sola nota', s: 'canta' },
    { l: 'sale aleteando del follaje', s: 'alza el vuelo' },
  ],
  walking_animal: [
    { l: 'quiebra una ramita al pisar', s: 'quiebra una ramita' },
    { l: 'camina entre la hojarasca', s: 'pasa' },
    { l: 'se congela a medio paso, atento', s: 'se congela' },
    { l: 'hurga en la maleza', s: 'forrajea' },
    { l: 'se aleja a saltos por el helecho', s: 'se aleja a saltos' },
    { l: 'escarba en el suelo húmedo', s: 'escarba' },
  ],
  static_object: [
    { l: 'cruje cuando el viento lo empuja', s: 'cruje' },
    { l: 'gotea sin parar sobre la hojarasca', s: 'gotea' },
    { l: 'zumba con una nube de mosquitos', s: 'zumba' },
    { l: 'suspira cuando el aire lo atraviesa', s: 'suspira' },
    { l: 'corre sobre piedras frías', s: 'fluye' },
  ],
  human: [
    { l: 'pasa con cuidado', s: 'pasa' },
    { l: 'murmura algo por lo bajo', s: 'murmura' },
    { l: 'aparta una rama de un golpe', s: 'aparta una rama' },
    { l: 'silba una vez y calla', s: 'silba' },
    { l: 'rebusca en una mochila', s: 'rebusca' },
  ],
}

// Texturas de ambiente (sin agente).
const AMBIENT = [
  { l: 'Una gota suave cae de las hojas mojadas', s: 'gotean las hojas' },
  { l: 'Una ramita se asienta en la oscuridad', s: 'cruje una ramita' },
  { l: 'Agua lejana corre sobre las piedras', s: 'agua lejana' },
  { l: 'El viento peina las ramas altas', s: 'viento en las ramas' },
  { l: 'La lluvia repica suave sobre las hojas anchas', s: 'lluvia en las hojas' },
  { l: 'Una rama lejana cruje y aguanta', s: 'cruje una rama' },
  { l: 'La hojarasca susurra y vuelve a callar', s: 'susurra la hojarasca' },
]

const DIR_PHRASE = {
  left: 'a la izquierda', right: 'a la derecha', ahead: 'más adelante',
  behind: 'en algún lugar detrás', above: 'por encima', below: 'a ras del suelo',
  'all around': 'por todas partes',
}

function action(type, rand) {
  return pick(ACTIONS[type] || ACTIONS.static_object, rand)
}

/**
 * @param {{type,agent,agentType,dir}} ev
 * @param {{phase,weather}} ctx
 * @returns {{log:string, short:string}}
 */
export function narrate(ev, ctx, rand = Math.random) {
  const name = ev.agent
  const t = ev.agentType || 'static_object'
  const wx = weatherES(ctx.weather)
  const ph = phaseES(ctx.phase)

  switch (ev.type) {
    case 'sound': {
      if (!name) { const am = pick(AMBIENT, rand); return { log: am.l, short: am.s } }
      const a = action(t, rand)
      const d = ev.dir && rand() < 0.5 ? ` ${DIR_PHRASE[ev.dir]}` : ''
      return { log: `${cap(name)} ${a.l}${d}.`, short: `${name} ${a.s}` }
    }
    case 'interaction': {
      const a = action(t, rand)
      return { log: `${cap(name)} ${a.l} mientras ${wx} atraviesa el claro.`, short: `${name} ${a.s}` }
    }
    case 'conflict': {
      const a = action(t, rand)
      return { log: `Algo sobresalta al claro; ${name} ${a.l}.`, short: `${name} ${a.s}` }
    }
    case 'residue': {
      const a = action(t, rand)
      return { log: `${cap(name)} ${a.l} un momento más, y se apaga.`, short: `${name} se asienta` }
    }
    case 'moment': {
      return {
        log: `El viejo roble gime mientras ${wx} se apodera del claro.`,
        short: 'gime el roble',
      }
    }
    case 'overview': {
      return {
        log: `${cap(wx)} se asienta sobre el claro mientras ${ph} se ahonda.`,
        short: 'panorama',
      }
    }
    case 'shift': {
      return { log: `La luz gira hacia ${ph}.`, short: `cambio · ${ph}` }
    }
    case 'setup': {
      const a = action(t, rand)
      return { log: `${cap(name)} ${a.l}, más cerca ahora.`, short: `${name} ${a.s}` }
    }
    case 'distant': {
      const a = action(t, rand)
      return { log: `A lo lejos, ${name} ${a.l}.`, short: `${name} a lo lejos` }
    }
    default: {
      const a = action(t, rand)
      return { log: `${cap(name || 'el claro')} ${a.l}.`, short: name ? `${name} ${a.s}` : 'el claro' }
    }
  }
}
