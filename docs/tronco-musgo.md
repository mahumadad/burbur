

## Cómo construye alikim

- Cada "planta" es tronco + ramas (niveles 0..4); en cada nivel puede instanciar
  **hojas/pétalos**.
- `LeafGeom(obj)` / `PetalGeom(obj)` (en `lpf.js`) cargan una **silueta vectorial
  FXG** (`assets[type].data[name]`, p. ej. `'moss'`, `'lilly'`, `'lotus'`) y la
  convierten en malla con `makeBuffGeomFromFXG(src, quality, makeZ, bisecDist)`.
  `makeZ(x,y)` le da la curvatura 3D a la silueta plana.
- Los materiales son `MeshLambertMaterial` → **la escena está ILUMINADA** (hay
  luz direccional). Nuestro mundo es *unlit*; ver "Reproducción" abajo.

## 1) El tronco (nivel "trunk") — código exacto

```js
const geo = new THREE.TorusGeometry(1, 0.2, 80, 80, Math.PI); // MEDIO toro = tronco curvo
noisePos(geo, [0.015, 0.015, 0.015]);   // perturba posiciones → corteza irregular
noiseNor(geo, [0.6, 0.6, 0.6]);         // perturba normales → sombreado rugoso
geo.scale(1, 0.9, 1);
geo.rotateX(0.5);
geo.rotateY(0.5);
geo.translate(0, -0.1, 0);

mesh = {
  height: 0.1,
  uniscale: true,
  mat: new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }),
  geo,
};

// color de corteza POR VÉRTICE (no textura):
for (let i = 0; i < color.length; i++)
  color[i] = new THREE.Color(0.15, 0.1, 0.05); // marrón muy oscuro
```

Claves:
- **Forma**: medio toro (arco `Math.PI`, tubo radio `0.2`) → tronco grueso y
  **curvo tipo banana**, no un cilindro recto.
- **Rugosidad**: `noisePos` + `noiseNor` (no hay geometría de ramas en este
  preset; es un solo trozo curvo).
- **Sin textura**: la corteza es color de vértice `(0.15, 0.1, 0.05)` sombreado
  por Lambert.

## 2) El musgo (instanciado sobre el tronco) — código exacto

```js
const leaf = LeafGeom({
  name: 'moss',
  bisecDist: 0.5,
  makeZ: (x, y) => -0.004 * x * x + 0.002 * y * y, // cada hojita ahuecada
});

petals = {                       // "petals" = sistema de instanciado de alikim
  shineThrough: 0.7,             // deja pasar algo de luz (traslúcido)
  mat: new THREE.MeshLambertMaterial({ color: 0xcccccc, side: THREE.DoubleSide }),
  geo: leaf.geo,                 // SILUETA de hoja de musgo (FXG 'moss')
  offset: [0, 0, 15],
  ybias: [20, 80],               // se inclina 20–80° respecto a la superficie
  usenormals: true,              // se orienta según la NORMAL del tronco en cada punto
};
petals.geo.scale(0.0015, 0.0015, 0.0015); // hojitas diminutas

// color por instancia: verde base (embebido en la silueta 'moss') + variación:
const lc = leaf.rgb;
const base = [(lc >> 16) & 0xff, (lc >> 8) & 0xff, lc & 0xff].map(e => e / 255);
const clr = petals.color = new Array(80 * 80 / 4); // ~1600 hojitas
for (let i = 0; i < clr.length; i++)
  clr[i] = new THREE.Color(base[0] + 0.3 * rand(), base[1] - 0.5 * rand(), base[2]);
```

Claves:
- El musgo **no** es puntos ni una textura: son **~1600 hojitas-malla** (silueta
  `'moss'`) instanciadas sobre la superficie del tronco, **orientadas por la
  normal** (`usenormals`), inclinadas 20–80° (`ybias`) y **diminutas**
  (escala `0.0015`).
- **Sin textura**: material gris (`0xcccccc`) modulado por **color de vértice
  verde con variación aleatoria** (`+0.3 rand` en R, `-0.5 rand` en G).
- `makeZ` da a cada hojita una leve copa; `shineThrough: 0.7` la vuelve algo
  traslúcida.

## 3) Reeds / pasto fino (nivel adyacente, por si se quiere)

```js
mesh = {
  mat: new THREE.MeshLambertMaterial(),
  geo: new THREE.CylinderGeometry(0.012, 0.02, 1, 5), // tallo delgado ahusado
};
for (let i = 0; i < color.length; i++)
  color[i] = new THREE.Color(0.3 + 0.4 * i / color.length, 0.4, 0.1); // verde-mostaza
```

## 4) Texturas de la escena — dónde SÍ hay

El **tronco y el musgo NO usan textura** (todo es color de vértice + Lambert).
Las únicas texturas del "secret pond" están en los **pétalos de loto** y en la
**hoja de nenúfar**:

- `/_lush/tree/textures/petals/lotus.png`  → mapa del pétalo del loto
- `/_lush/tree/textures/leaves/lilly.png`  → mapa (venas) de la hoja de nenúfar

Se cargan con `texldr.load(url, ...)` en el material de esos niveles
(`petals.mat.map = texldr.load(...)`).

## 5) Cómo lo reproducimos en burbur (y qué falta para ser idéntico)

Nuestro mundo es **unlit** (`MeshBasicMaterial`, sin luces) y de estética
puntos/líneas glow. Equivalencias con lo que ya tenemos:

| alikim | burbur (hoy) | para acercarlo/igualarlo |
|---|---|---|
| medio toro marrón grueso + ruido | `buildFallenLog` (tubo ahusado + ramas, wireframe hueso) en `src/render/engine/deadwood.js` | espina en **arco** (medio toro) para el tronco curvo tipo banana |
| corteza = color de vértice, sin textura | wireframe hueso + relleno casi negro | corteza **marrón sólida** `(0.15,0.1,0.05)` con ruido de vértice |
| musgo = hojitas-malla instanciadas por normal | `mossClump` = cúmulos de **puntos** verdes sobre la cara de arriba (`addLogMoss` en `src/render/pond.js`) | cambiar puntos por **hojitas-malla** (planitos pequeños) orientadas por la normal, verde con variación |
| Lambert (iluminado) | unlit + falso volumen por color de vértice | añadir una luz direccional, u **hornear** el sombreado en el color de vértice |

Pasos mínimos para acercarlo sin romper el estilo del mundo:

1. **`deadwood.js`**: añadir una opción de espina en **arco** (medio toro grueso)
   → tronco curvo, no recto.
2. **Corteza marrón sólida** (`0.15,0.1,0.05`) con ruido de vértice, en vez de
   solo el wireframe hueso.
3. **Musgo con hojitas-malla**: reemplazar los puntos de `mossClump` por planitos
   pequeños (2–3 triángulos) orientados por la normal de la superficie del
   tronco, verde con variación `(+0.3/-0.5 rand)` — igual que alikim.
4. (Opcional) una **luz direccional** tenue solo para estos sólidos, o
   vertex-color con gradiente base→punta para fingir volumen.
