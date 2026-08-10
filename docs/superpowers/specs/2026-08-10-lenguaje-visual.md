# Lenguaje visual — especificación de formas

**Fecha:** 2026-08-10
**Base:** observación directa de murmur.living (los 3 mundos) + capturas de referencia.
**Alcance:** el *estilo* y el *vocabulario de formas*. Reconstruimos la geometría nosotros; no
usamos sus archivos (mp3/JSON/video).

---

## 0. La idea rectora

Un **diorama flotando en negro**, iluminado como bajo un foco cálido, con dos registros
superpuestos:

1. **Registro orgánico** — terreno, pasto, flores, árboles, rocas. Suave, texturado, natural.
2. **Registro esquemático** — los agentes: **jaulas wireframe de colores saturados** que flotan
   sobre el mundo, más un HUD tipográfico técnico.

La tensión entre ambos (naturaleza densa vs. diagrama flotante) **es** la identidad visual.
No son criaturas literales: son *marcadores de datos* sobre un paisaje real.

---

## 1. Agentes — el hallazgo central

Cada agente es una **jaula wireframe** (solo aristas, sin relleno, línea gruesa) con un
**marcador interno** que indica su rumbo.

```
   ┌─────────┐        ← aristas gruesas, color saturado, sin relleno
   │   ↗●    │        ← marcador interno: flecha + punto (rumbo/estado)
   └─────────┘
        │              ← tallo vertical opcional hasta el suelo (altitud)
   ·  ·  ·  ·          ← estela punteada
```

**Vocabulario de jaulas observado:**

| Forma | Color típico | Notas |
|---|---|---|
| Cubo en perspectiva | Cyan/teal | La más frecuente |
| Cuadrado plano inclinado | Magenta/rosa | Rota lento en 3D |
| Anillo sobre tallo | Amarillo/ámbar | Tipo alfiler; tallo largo al suelo |
| Triángulo / pirámide | Azul, cyan | Angular |
| Cuadrado | Blanco/crema | Neutro |

**Reglas:**
- Grosor de línea **constante en pantalla** (no adelgaza con la distancia).
- **Sin relleno** — se ve el mundo a través de ellas.
- El **marcador interno** (flecha corta roja/naranja + esfera) apunta a la dirección de avance.
- **Tallo vertical** hasta el suelo para los que vuelan → lee la altitud.
- Color = **grupo/tipo de agente**, no especie individual.
- Al pasar el mouse: **etiqueta** en caja negra, texto blanco condensado en mayúsculas
  (p. ej. `GREEN WOODPECKER`).

> Esto reemplaza nuestros sprites-especie actuales (anillo/punto/cruz/estrella): pasamos de
> *iconos planos* a *jaulas 3D con rumbo*, que es lo que da la sensación de "agente vigilado".

---

## 2. Estelas

- **Cadenas de esferas pequeñas**, espaciado regular, no líneas continuas.
- Se **apoyan en el terreno** (siguen el relieve), no flotan.
- Trazan **recorridos largos y sinuosos** que cruzan toda la isla; son la evidencia de que los
  individuos han estado moviéndose.
- Dominan rojo/carmín y rosa; el punto más reciente algo más brillante, y se desvanecen atrás.
- Persisten bastante tiempo — son "memoria" del mundo, no un rastro corto.

*(Nuestra implementación actual ya es correcta en concepto; falta que se apoyen en el suelo,
sean más largas y persistan más.)*

---

## 3. Flora

Dos familias, ambas **muy abundantes**:

**a) Flor de tallo con cabeza en racimo**
- Tallo finísimo, casi gris, ligeramente curvo.
- Cabeza = **racimo de varias esferas pequeñas** (no un punto único): 5–12 bolitas.
- Paleta: naranja, rosa, blanco, rojo, crema, amarillo.
- Alturas muy variadas; algunas asoman sobre el pasto, otras se hunden en él.

**b) Planta radial tipo destello**
- Un centro con **varios radios finos** que terminan en puntitos.
- Silueta de chispa/fuego artificial. Aporta el "ruido" gráfico característico.

> Nuestro modelo actual (tallo + **una** esfera) es la simplificación pobre. El racimo y la
> radial son lo que da la densidad visual de murmur.

---

## 4. Pasto

- **Muy denso**, hojas finas y **altas**, individualmente distinguibles de cerca.
- Verde brillante y saturado; **degradado vertical fuerte**: oscuro en la base, luminoso en la punta.
- Se mece con el viento.
- Es el "colchón" que cubre toda la superficie habitable.

---

## 5. Árboles

- **Árboles secos sin hojas**: troncos finos, ramas **curvas y orgánicas** (no cilindros rectos),
  bifurcándose varias veces.
- Color hueso / gris claro, con **textura punteada** encima.
- Pocos y dispersos — son hitos verticales del paisaje, no un bosque cerrado.

---

## 6. Rocas y relieve

- Formas **blandas y abultadas** (no poliedros duros), color tierra rojiza/malva.
- **Textura de trama de puntos (dither) muy visible** — es la firma del estilo.
- Se posan sobre el pasto como montículos o bloques de tierra.

---

## 7. Terreno

- **Isla/disco redondeado flotando en negro**, con borde irregular.
- Los bordes **caen y se funden a negro** (no hay corte duro ni horizonte).
- Viñeta fuerte: el centro está iluminado, la periferia se apaga.
- En la ciudad, la isla se **subdivide en manzanas** por calles oscuras.

---

## 8. Clima y luz

- **Lluvia:** líneas diagonales finas, claras, largas, sobre todo el encuadre. Sutiles.
- **Niebla:** neblina que come el contraste en la distancia.
- **Luz:** foco cálido cenital; el mundo brilla, el fondo es negro puro.
- La **hora del día** cambia la temperatura de color (amanecer cálido ↔ noche fría-azulada).

---

## 9. Ciudad — formas propias

- **Torres de losas apiladas**: placas horizontales superpuestas, como una pila de bandejas.
- **Volúmenes-caja** simples para edificios bajos.
- Paleta: **naranja intenso, crema/arena, lavanda/violeta** — contra el verde del pasto.
- Misma textura punteada; algunos edificios se leen casi como **nubes de puntos**.
- **Farolas**: postes finos grises con brazo horizontal.
- Calles oscuras entre manzanas; charcos que reflejan.

---

## 10. UI / HUD

Estética de **lectura técnica**: tipografía condensada en **MAYÚSCULAS**, paneles negros
translúcidos con esquinas redondeadas y borde fino.

| Elemento | Forma |
|---|---|
| **Píldora "ahora sonando"** | Rect. redondeado del color del mundo; arte circular + barras de nivel + texto + iconos de audio |
| **Selector de mundos** | 3 círculos con glifo (hexágono naranja / trébol verde / gota azul); el activo con anillo |
| **Panel ECOSYSTEM** | Etiqueta izquierda, valor derecha; barras finas para `ACTIVITY`/`TENSION`; sliders para `MUSIC`/`WORLD` |
| **EVENTS LOG** | Timestamp atenuado + texto en mayúsculas; lo nuevo arriba; se desvanece abajo; los `shift` resaltados en color |
| **RECORD** | Píldora oscura, punto rojo, waveform, contador |

Color de acento = **color del mundo activo** (verde bosque / naranja ciudad / azul agua).

---

## 11. Brecha contra nuestro render actual

| Elemento | Nuestro estado | Objetivo |
|---|---|---|
| Agentes | Sprites planos (anillo, cruz, estrella) | **Jaulas wireframe 3D + marcador de rumbo + tallo** |
| Flores | Tallo + 1 esfera | **Racimos de esferas + plantas radiales** |
| Terreno | Plano infinito | **Isla flotante con caída a negro** |
| Árboles | Cilindros rectos | **Ramas curvas orgánicas** |
| Estelas | Cortas, flotantes | **Largas, apoyadas en el suelo, persistentes** |
| Rocas | Icosaedros con dither ✅ | Formas más blandas |
| Pasto | Denso ✅ | Degradado vertical más marcado |
| Luz | Plana | **Foco cálido + viñeta + hora del día** |
| Clima | Ninguno | **Lluvia, niebla** |
| UI | Panel de sliders | **HUD técnico completo** |

Lo marcado con ✅ ya está resuelto y se conserva.
