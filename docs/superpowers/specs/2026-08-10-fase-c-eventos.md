# Fase C — Agentes con identidad + motor de eventos

**Fecha:** 2026-08-10
**Meta:** que el mundo *cuente algo*: agentes con nombre y tipo, un motor que genera
eventos (10 tipos), un narrador que los pone en palabras, y el EVENTS LOG + píldora.

## La costura que importa: `EventSource`

El resto del sistema (log, píldora, sonido paneado) consume **solo** objetos `Event` con
esquema fijo. De dónde salen es intercambiable:

```
interface EventSource { update(dt, world): Event[] }
```

- **EventEngine** (procedural) — implementación de ahora.
- **BakedTimeline** — lee un JSON de eventos pre-horneado (como el de murmur).
- **LiveLLM / generative_agents** — futuro: [joonspk-research/generative_agents]
  corre **offline en servidor** y produce el mismo esquema de eventos + storylines por
  agente. NO corre en el navegador (es Python + LLM por tick, pensado para tiles).

Mientras `Event` no cambie, cualquiera de las tres se enchufa sin tocar render/audio/UI.

## Esquema de evento (basado en el real de murmur)

```jsonc
{
  "t": 12.4,                 // segundos de simulación
  "type": "interaction",     // sound|interaction|overview|residue|moment|conflict|shift|setup|distant|peak
  "agent": "roe deer",       // nombre del censo, o null (ambiente)
  "agentIdx": 3,             // índice de un agente visible, o null
  "dir": "left",             // left|right|ahead|behind|above|below|all around|null → paneo
  "log": "The roe deer freezes mid-step, ears swivelling.",  // texto del log
  "short": "roe deer freezes",                               // texto de la píldora
  "source": "cache"          // live|cache|ghost|null
}
```

## Modelo de agente (preparado para un "cerebro")

```jsonc
{ "name": "green woodpecker", "type": "flying_animal",
  "memory": [], "state": "move" }   // memory/state hoy no se usan; son el gancho del LLM
```

El censo del bosque (~30) es mayor que los agentes visibles (~18): la mayoría de los
sonidos son de ambiente (`source: ghost|cache`, `agent` del censo o null); las
interacciones y conflictos ocurren entre agentes visibles cercanos.

## Módulos

| Archivo | Rol | Pureza |
|---|---|---|
| `sim/agents.js` | Censo: nombres + tipos; asigna identidad a los visibles | puro |
| `sim/narrator.js` | Plantillas + léxico por tipo → `log` y `short` | puro |
| `sim/events.js` | EventEngine: densidad por `activity`, proximidad→interacción, colas→residue, resúmenes, `shift` en cambios de hora/clima | puro |
| `ui/eventlog.js` | EVENTS LOG (timestamps, lo nuevo arriba) + píldora "ahora sonando" | DOM |

## Densidad y distribución (del análisis del bundle)

- Bosque ≈ **37 eventos/min**; modulado por `activity` del ecosistema.
- Mezcla observada: `sound` ~74%, luego `residue`, `overview`, `interaction`, `shift`,
  `moment`, `conflict`, y unos pocos `setup`/`distant`/`peak`.

## Contenido: nuestro, no el suyo

Usamos su **esquema** y sus **distribuciones**, no sus frases. El léxico y las plantillas
del narrador son originales — y así los eventos son infinitos, no una hora que se repite.
