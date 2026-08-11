# Formas de agentes — moléculas más definidas (diseño)

**Objetivo (pedido del usuario, con 2 imágenes de murmur de referencia):** que los
individuos tengan **jaulas de formas variadas y más definidas** — cubo, paralelepípedo
(caja alta), pirámide cortada (frustum), octaedro/hexágono — cada una conteniendo una
**molécula** de esferas de colores unidas por líneas (bonds), con colores distintos por
especie. Las estelas (estelas rojas punteadas en las imágenes) ya se engrosaron aparte.

## Evidencia (imágenes del usuario)
- **Caja rectangular blanca (paralelepípedo)**, más alta que ancha, con **2 travesaños
  horizontales** internos, y dentro esferas magenta/blanca/amarilla unidas por líneas.
- **Cubo cian** con trozos de color adentro.
- **Octaedro/hexágono cian** (contorno).
- **Cubo chico cian** con núcleo naranja.
- Estelas = **puntos rojos gruesos** que conectan agentes (ya hecho: `trailSize*0.17`).

## Estado actual (`engine/agents3d.js` tras Fase A de ciudad; hoy en `scene.js`)
Kit: `fatLine(positions,color)`, `edgesOf(geometry,color)`, `ringLoop(r,seg,color)`,
`creature(t)` (esfera naranja + 3–4 esferas satélite + bonds), `wedge(e)` (prisma triangular).
Especies: `cyan` (BoxGeometry 6³ + creature), `eye` (wedge|Octahedron 3.6 + anillo/mástil),
`flag` (triángulo + anillo), `dbl` (2 anillos + núcleo). Movimiento por-kind: roll (cyan),
glide (eye), spinY (flag/dbl). `buildAgent(kind)` debe seguir aceptando estos y los nuevos.

## Diseño propuesto

### 1. Vocabulario de JAULAS (nuevos builders en el kit)
- `boxCage(w,h,d,color)` — `edgesOf(BoxGeometry(w,h,d))`. Cubo = w=h=d.
- `parallelepipedCage(w,h,d,color,rungs=2)` — caja alta (ej. 5×9×5) + `rungs` travesaños
  horizontales (LineSegments de 4 aristas cada uno a alturas repartidas) → la "caja con
  estantes" de la imagen.
- `frustumCage(bottom,top,h,color)` — **pirámide cortada**: 8 aristas = cuadrado inferior
  (lado `bottom`) + cuadrado superior (lado `top<bottom`) a altura `h` + 4 diagonales que los
  unen. Un `CylinderGeometry(topR, botR, h, 4)` con `edgesOf` da exactamente el frustum de
  base cuadrada (radial 4). Barato y legible.
- Reutilizar `OctahedronGeometry` (hexágono/diamante) y `wedge`.

### 2. MOLÉCULA más definida (mejorar `creature`)
- Núcleo = 1 esfera grande de color de especie; 3–5 esferas satélite de colores del set,
  a distancias fijas por semilla (deterministas), unidas al núcleo por `fatLine` (bond) y
  **algunas entre sí** (para que se lea como molécula, no como estrella). Radios un pelín
  mayores (más "definidas"). Mantener additive/opaco como hoy.
- Set de colores por especie (ver tabla) → cada jaula tiene su molécula con paleta propia.

### 3. Roster de especies (expandido a 6)
| kind | jaula | molécula (núcleo → satélites) | color jaula | movimiento |
|---|---|---|---|---|
| `cube` | cubo 6³ | naranja → magenta/blanco/cian | cian | roll (rueda, como hoy `cyan`) |
| `slab` | paralelepípedo 5×9×5 + 2 travesaños | magenta → blanco/amarillo/naranja | blanco | spinY lento (gira sobre su eje) |
| `frustum` | pirámide cortada (base 6, tope 3, alt 6) | amarillo → naranja/blanco | cian/blanco | glide (planea, como `eye`) |
| `octa` | octaedro 3.6 | blanco → cian/magenta | blanco | roll suave |
| `flag` | triángulo + anillo (actual) | — | azul/magenta | spinY |
| `dbl` | 2 anillos + núcleo (actual) | naranja | amarillo | spinY |

`SPECIES = ['cube','slab','frustum','octa','flag','dbl']`, asignadas por `i % length` (o
pesos si se quiere más de unas que de otras). Colores exactos desde `config.PALETTE`
(cian/magenta/white/yellow/orange/blue/pink/bond) — NADA de verde (contraste con el pasto).

### 4. Integración (post-merge, sobre `engine/agents3d.js`)
- Añadir `boxCage/parallelepipedCage/frustumCage` al kit exportado por `createAgentKit(rc)`.
- `buildAgent(kind,{colorOverride})` maneja los 6 kinds; ciudad ya necesitaba `whiteC`
  (cubo blanco) → sale gratis como `boxCage(...,PALETTE.white)`.
- El pool de especies lo pasa cada mundo (bosque manda estos 6; ciudad puede mandar su
  subset). No hardcodear el roster dentro del kit.
- Movimiento: reutilizar el bloque roll/glide/spin ya existente (`updateAgentMotion`),
  agregando params por los kinds nuevos (`slab`→spinY, `frustum`→glide, `octa`→roll).

### 5. Presupuesto
6 tipos × `fireflies.count` agentes; cada uno = ~12–15 aristas (LineSegments) + 4–6 esferas
(Mesh) + bonds. Igual orden que hoy (4 tipos) → sin problema de rendimiento.

## Orden
Implementar **después** del merge de la Fase A de ciudad (que extrae `agents3d.js`), para no
duplicar/chocar. Este doc es la fuente; las firmas del kit las fija ciudad.
