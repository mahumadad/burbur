# burbur — flags de URL

Cualquier variable del ecosistema se puede **fijar desde la URL** para montar un
escenario concreto sin esperar a que el reloj del mundo dé la vuelta. Los flags
se combinan entre sí y aceptan alias en inglés y español. Se aplican al recargar
la página.

> El reloj es el mismo para los seis mundos, pero cada uno lo lee distinto (hora
> del día / ritmo de la célula / etapa de sueño / ciclo de humedad). Por eso
> `weather` y `phase` usan un **vocabulario distinto por mundo** (ver más abajo),
> mientras que los knobs numéricos (`temperatura`, `rain`, `wind`…) valen en todos.

---

## Variables numéricas

| Flag (alias) | Rango | Qué hace |
|---|---|---|
| `temperature` (`temp`, `temperatura`) | °C | Temperatura del aire. **≤ −3 hace nevar.** |
| `rain` (`lluvia`, `agua`, `water`) | 0–1 | Intensidad de lluvia / cantidad de agua. |
| `snow` (`nieve`) | 0–1 | Atajo: pone temperatura bajo cero **y** nevada. |
| `wind` (`viento`) | 0+ | Viento (mece el pasto, arrastra hojas, ráfagas). |
| `fog` (`niebla`) | 0–1 | Densidad de niebla. |
| `activity` (`actividad`, `act`) | 0–1 | Cuánta vida está activa. |
| `tension` (`tensión`) | 0–1 | Desasosiego (maneja el *mood* del audio). |
| `season` (`estación`, `seasonT`) | 0–1 | Punto del año (0.35 ≈ verano, 0.85 ≈ invierno). |
| `gain` (`brillo`) | 0+ | Brillo ambiente. |

Los knobs numéricos **pinan el valor final**: ganan sobre lo que calculó el reloj
y sobre lo que derivan `weather`/`phase`.

### `snow` (conveniencia)

`?snow=1` arma un escenario nevado sin tener que saber que la nieve se dispara
con temperatura ≤ −3. `?snow=0.4` baja la intensidad de la nevada. Si además pones
`temperatura` o `rain` explícitos, esos ganan (así puedes afinar: `?snow=1&temp=-12`).

---

## Variables de texto: `weather` (`clima`)

Fuerza un estado de clima **en la fuente**, así todo lo que deriva de él
(lluvia, tensión, temperatura, niebla) queda coherente. Cada mundo tiene los
suyos; un clima que no existe en el mundo activo se ignora.

**Bosque / Laguna / Ciudad**

| `weather=` | lluvia | tensión | Δtemp | niebla |
|---|---|---|---|---|
| `dry still` | 0.00 | 0.05 | 0 | 0.10 |
| `light rain` | 0.35 | 0.20 | −3 | 0.35 |
| `frost` | 0.00 | 0.15 | −6 | 0.55 |
| `after rain` | 0.08 | 0.10 | 0 | 0.30 |
| `heavy rain` | 1.00 | 0.45 | −4 | 0.60 |

**Célula** (el "clima" es el medio de cultivo)

| `weather=` | lluvia | tensión | Δtemp | niebla |
|---|---|---|---|---|
| `nutrient rich` | 0.05 | 0.05 | 0 | 0.10 |
| `serum starved` | 0.02 | 0.25 | 0 | 0.28 |
| `hypoxic` | 0.00 | 0.35 | −1 | 0.45 |
| `oxidative stress` | 0.55 | 0.55 | +1 | 0.35 |
| `inflamed` | 0.30 | 0.45 | +2 | 0.20 |
| `acidic` | 0.10 | 0.40 | 0 | 0.40 |

**Neurona** (el "clima" son los neuromoduladores)

| `weather=` | lluvia | tensión | niebla |
|---|---|---|---|
| `cholinergic` | 0.20 | 0.15 | 0.15 |
| `noradrenergic` | 0.30 | 0.50 | 0.10 |
| `dopaminergic` | 0.22 | 0.20 | 0.18 |
| `high adenosine` | 0.10 | 0.30 | 0.40 |
| `caffeine` | 0.18 | 0.40 | 0.20 |
| `gabaergic` | 0.06 | 0.10 | 0.30 |

**Micelio** (el "clima" es la humedad)

| `weather=` | lluvia | tensión | Δtemp | niebla |
|---|---|---|---|---|
| `empapado` | 0.20 | 0.05 | −1 | 0.50 |
| `lluvia` | 1.00 | 0.10 | −1 | 0.60 |
| `niebla` | 0.05 | 0.10 | 0 | 0.72 |
| `rocío` | 0.02 | 0.08 | 0 | 0.42 |
| `secándose` | 0.00 | 0.30 | +1 | 0.20 |
| `seco` | 0.00 | 0.50 | +2 | 0.05 |
| `helada` | 0.00 | 0.45 | −6 | 0.55 |

---

## Variables de texto: `phase` (`hora`, `fase`)

Fuerza el momento del reloj. Controla luz (color), brillo, actividad y un delta
de temperatura. Acepta **nombre exacto** o **índice 0–11** (el índice funciona en
cualquier mundo sin saber el nombre).

| # | Bosque / Laguna / Ciudad | Célula | Neurona | Micelio |
|---|---|---|---|---|
| 0 | `night` | `resting` | `quiet wake` | `medianoche` |
| 1 | `pre-dawn` | `surveillance` | `alert wake` | `madrugada` |
| 2 | `dawn chorus` | `patrolling` | `focused` | `rocío del alba` |
| 3 | `first light` | `chemotaxis` | `drowsy` | `primera luz` |
| 4 | `early morning` | `alert` | `N1` | `mañana` |
| 5 | `mid-morning` | `hunting` | `N2 spindles` | `media mañana` |
| 6 | `morning` | `engulfing` | `N3 slow wave` | `mediodía seco` |
| 7 | `midday` | `digesting` | `N3 deep` | `siesta` |
| 8 | `early afternoon` | `antigen presentation` | `N2 return` | `tarde` |
| 9 | `afternoon` | `cytokine secretion` | `REM` | `frescor` |
| 10 | `golden hour` | `efferocytosis` | `REM burst` | `anochecer` |
| 11 | `dusk` | `recovery` | `waking` | `relente` |

---

## Otros

- `grown` — nace los árboles ya adultos. Útil con una estación fija, porque el
  año no da la vuelta para hacerlos crecer.

## Notas

- **Codificación:** los nombres con espacio van *URL-encoded*: `phase=dawn%20chorus`,
  `weather=heavy%20rain`, `phase=N2%20spindles`.
- **Por mundo:** `weather` y `phase` con un nombre que no existe en el mundo activo
  se ignoran (sigue el reloj); los numéricos aplican en todos.
- **Sin flags:** la URL limpia corre el ciclo normal.

## Ejemplos

```
?snow=1
?rain=1&wind=1
?weather=heavy%20rain&wind=1
?season=0.6&temperatura=-5&grown
?phase=midday&actividad=0.9&tension=0
?fog=0.7&gain=0.8&phase=dusk
```

Todos juntos (atardecer de tormenta nevada, árboles adultos):

```
?temperatura=-5&rain=1&wind=1&fog=0.5&actividad=0.7&tension=0.3&season=0.6&gain=1.1&weather=heavy%20rain&phase=dusk&grown
```
