// Narrador gramatical: convierte un evento en texto. Puro y determinista dado `rand`.
// Contenido propio (no el de murmur): plantillas + léxico por tipo de agente.

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const pick = (arr, rand) => arr[(rand() * arr.length) | 0]

// Acciones por tipo: { l: fragmento largo, s: forma corta }.
const ACTIONS = {
  flying_animal: [
    { l: 'calls, thin and high', s: 'calls' },
    { l: 'chatters from a hidden branch', s: 'chatters' },
    { l: 'drums on dead wood', s: 'drums' },
    { l: 'wheels once overhead', s: 'wheels' },
    { l: 'scolds an unseen intruder', s: 'scolds' },
    { l: 'lets a single note fall', s: 'sings' },
    { l: 'clatters up out of the canopy', s: 'takes flight' },
  ],
  walking_animal: [
    { l: 'snaps a twig underfoot', s: 'snaps a twig' },
    { l: 'pads through the leaf litter', s: 'pads past' },
    { l: 'freezes mid-step, listening', s: 'freezes' },
    { l: 'noses through the undergrowth', s: 'forages' },
    { l: 'bounds off through the fern', s: 'bounds off' },
    { l: 'scratches at the wet ground', s: 'scratches' },
  ],
  static_object: [
    { l: 'creaks as the wind leans on it', s: 'creaks' },
    { l: 'drips steadily onto the litter', s: 'drips' },
    { l: 'hums with a haze of midges', s: 'hums' },
    { l: 'sighs as the air moves through', s: 'sighs' },
    { l: 'runs on over cold stones', s: 'trickles' },
  ],
  human: [
    { l: 'treads carefully past', s: 'passes' },
    { l: 'murmurs something low', s: 'murmurs' },
    { l: 'snaps a branch aside', s: 'snaps a branch' },
    { l: 'whistles once, then stops', s: 'whistles' },
    { l: 'rummages in a pack', s: 'rummages' },
  ],
}

// Texturas de ambiente (sin agente).
const AMBIENT = [
  { l: 'A gentle drip falls from the wet leaves', s: 'leaves drip' },
  { l: 'A twig settles somewhere in the dark', s: 'a twig settles' },
  { l: 'Distant water moves over stones', s: 'distant water' },
  { l: 'Wind combs through the high branches', s: 'wind in the branches' },
  { l: 'Rain ticks softly on the broad leaves', s: 'rain on leaves' },
  { l: 'A far-off branch creaks and holds', s: 'a branch creaks' },
  { l: 'The litter rustles, then goes still', s: 'litter rustles' },
]

const DIR_PHRASE = {
  left: 'to the left', right: 'to the right', ahead: 'up ahead',
  behind: 'somewhere behind', above: 'overhead', below: 'low to the ground',
  'all around': 'all around',
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

  switch (ev.type) {
    case 'sound': {
      if (!name) { const am = pick(AMBIENT, rand); return { log: am.l, short: am.s } }
      const a = action(t, rand)
      const d = ev.dir && rand() < 0.5 ? ` ${DIR_PHRASE[ev.dir]}` : ''
      return { log: `The ${name} ${a.l}${d}.`, short: `${name} ${a.s}` }
    }
    case 'interaction': {
      const a = action(t, rand)
      return { log: `The ${name} ${a.l} as ${ctx.weather} moves through.`, short: `${name} ${a.s}` }
    }
    case 'conflict': {
      const a = action(t, rand)
      return { log: `Something startles the ${name}; it ${a.l}.`, short: `${name} ${a.s}` }
    }
    case 'residue': {
      const a = action(t, rand)
      return { log: `The ${name} ${a.l} still, then fades.`, short: `${name} settles` }
    }
    case 'moment': {
      return {
        log: `The old oak groans as the ${ctx.weather} takes hold of the clearing.`,
        short: 'the oak groans',
      }
    }
    case 'overview': {
      return {
        log: `${cap(ctx.weather)} settles over the clearing as ${ctx.phase} deepens.`,
        short: 'overview',
      }
    }
    case 'shift': {
      return { log: `The light turns toward ${ctx.phase}.`, short: `shift · ${ctx.phase}` }
    }
    case 'setup': {
      const a = action(t, rand)
      return { log: `The ${name} ${a.l}, closer now.`, short: `${name} ${a.s}` }
    }
    case 'distant': {
      const a = action(t, rand)
      return { log: `Far off, the ${name} ${a.l}.`, short: `distant ${name}` }
    }
    default: {
      const a = action(t, rand)
      return { log: `The ${name || 'clearing'} ${a.l}.`, short: name ? `${name} ${a.s}` : 'the clearing' }
    }
  }
}
