# Mapa completo del bundle de murmur

**Fecha:** 2026-08-10
**Fuente:** `assets/script-Daaf7S9n.js` (754 KB), módulo del mundo ≈ offset 583k–660k.
**209 funciones** en total (incluye libs empaquetadas: Line2/LineMaterial, postproceso).
Aquí van solo las del MUNDO, por subsistema, con **estado de portado**.

Leyenda: ✅ portado · 🟡 parcial · ⬜ pendiente · ➖ no aplica (usamos alternativa).

---

## 1. Campos escalares del terreno  ✅ (bosque)
| fn | qué es | estado |
|---|---|---|
| `Me` | fbm SIN normalizar, lacunaridad 2.03 | ✅ `noise.js` fbm |
| `je` | ruido de valor 2D | ✅ `noise2` |
| `Pe` | altura del terreno | ✅ `terrainHeight` |
| `Fe` | fertilidad (recorte duro → zonas) | ✅ `fertility` |
| `Ie` | máscara de isla (caída 60→98%) | ✅ `islandMask` |
| `Le` | ¿dentro de una roca? | ✅ (rockSpots) |
| `ze` | rampa de color del pasto (5 paradas) | ✅ `GRASS_RAMP` |
| `Ct,Tt,Dt,Ot,kt,At,Et,wt,xt,St,cn,fn,sn` | campos de **agua/ciudad** (nivel de agua, altura de islas, bordes) | ⬜ (agua/ciudad) |

## 2. Suelo, pasto, flora  ✅ (bosque)
| fn | qué es | estado |
|---|---|---|
| `at` | **malla de suelo** 88×88 | ✅ |
| `ot` | pasto bosque (80k líneas, gradiente) | ✅ |
| `Vt` `Dn` | pasto ciudad / pasto pond | ⬜ |
| `it` | **una flor** (tallo curvo + racimo) | ✅ `flower()` |
| `dt` | dispersar flores en anillo | ✅ (en patch loop) |
| `ft` | parches de flores bosque | ✅ |
| `rt` | paleta de parche `[a,a,b]` | ✅ `patchPalette` |
| `Ht` | flores extra | 🟡 |
| `kn` `Lt` | flores de ciudad / pond | ⬜ |
| `g` | **bayas** (racimo rojo/naranja/blanco) | ⬜ |

## 3. Árboles y rocas  ✅ (bosque)
| fn | qué es | estado |
|---|---|---|
| `o(e,t,n,o)` | **tubo ahusado** alrededor de espina | ✅ `tube()` |
| `s` | rama recursiva (espina 4 tramos) | ✅ `branch()` |
| `lt` | árbol completo (malla + WireframeGeometry) | ✅ |
| `ut` | sembrar árboles (3–5 pie + caídos) | ✅ |
| `st` | **una roca** (esfera deformada + liquen/musgo/flores) | ✅ |
| `ct` | formación de rocas (monolito + medianas + chicas) | ✅ |

## 4. Primitivas de render  ✅
| fn | qué es | estado |
|---|---|---|
| `et` | subir buffer de líneas | ✅ (nuestro sistema líneas) |
| `tt` | push punto | ✅ `pushPoint` |
| `nt` | push segmento de línea | ✅ `pushLine` |
| `pt` | subir todos los puntos (shader tamaño-mundo + DOF) | ✅ |
| `ep` | shader de puntos (2275) | ✅ (nuestro `pointMat`) |
| `Bt` | **neblina aditiva** (4200 pts) | ✅ |
| `Ut` | **polvo del borde** (8500 pts) | ✅ |

## 5. AGENTES — fábrica de especies  🟡
`In` (3693) = dispatch por tipo. Especies:
| fn | especie | mundo | estado |
|---|---|---|---|
| `he` | **eye** (cuña planeadora / octaedro + anillo + mástil) | bosque | ✅ |
| `ge` | **cyan/pink/whiteC** (jaula cubo + criatura) | bosque | ✅ |
| `_e` | **flag** (trípode + mástil + anillo) | bosque | ✅ |
| `ve` | **dbl** (dos anillos + núcleo) | bosque | ✅ |
| `ye` | jaula genérica (aristas + satélites) | compartido | ✅ (`edgesOf`) |
| `me` | **criatura interna** (núcleo + satélites fijos) | compartido | ✅ `creature()` |
| `pe` | geometría de cuña (9 aristas) | compartido | ✅ `wedge()` |
| `fe` | aristas de un sólido | compartido | ✅ `edgesOf` |
| `xe` | **strider** (patas) | pond/ciudad | ⬜ |
| `Se` | **orb** | pond | ⬜ |
| `W` | **burst** (ráfaga) | ciudad | ⬜ |
| `Ce` | **pins** (alfileres) | pond | ⬜ |
| `U` | **lamp** (farola/luz) | ciudad | ⬜ |
| `be` | **ice** (buceador) | pond | ⬜ |

## 6. AGENTES — física y animación  🟡
| fn | qué es | estado |
|---|---|---|
| `Rn` (5250) | **update por-frame**: move/rest, wander, separación, flujo, límites, city-offroad, pond-dive/hover | 🟡 `wander.js` (falta dweller ciudad, dive/hover pond) |
| `Ln` | campo de flujo sinusoidal | ✅ `flow()` |
| `zn` | sub-física (colisiones/altura) | 🟡 |
| `Vn` | **rodado de jaula** (eje = arriba×vel, ang = dist/effR·rollMul) + glide + spinY | ✅ (recién portado) |
| `on` | gradiente de campo (para orientar) | 🟡 |

## 7. Estelas  ✅
`trail` de puntos por individuo → ✅ (nuestra implementación).

## 8. CIUDAD (block)  ⬜
| fn | qué es |
|---|---|
| `tn` (2593) | **red de calles** (pares, celdas, manzanas `Xt`) |
| `bn` | torre |
| `Sn,Cn,wn,Tn` | edificios / losas apiladas (shading `flat`) |
| `P,F,nn,rn,an` | helpers de manzana (bbox, distancia a manzana) |
| `Et,Dt,Ot,kt,At` | campos de altura urbanos (charcos, calles) |

## 9. AGUA (pond)  ⬜
| fn | qué es |
|---|---|
| `nr` | **tabla de config por mundo** (water/pond/city/field) — clave para multi-mundo |
| campos `Ct,Tt,Dt,Ot` en modo pond | nivel de agua, islas, orillas |
| especies `be/Se/Ce` | buceadores, orbes, alfileres |

## 10. Cámara y post  ✅ / ➖
| fn | qué es | estado |
|---|---|---|
| `yr` | **controles de arrastre** (pointerdown/grab) + inercia | ➖ usamos OrbitControls |
| setup cámara fov 93° | ✅ |
| pase lente (fisheye+cromática+viñeta) | ✅ |
| niebla | ✅ |

## 11. Ecosistema, eventos, audio, UI
| fn | qué es | estado |
|---|---|---|
| `Cm` (493) | **fetch del JSON de eventos** (ticker horneado) | ➖ nosotros generamos procedural (`events.js`) |
| `Zn` (881) | **log de eventos** (DOM, timestamps) | ✅ `eventlog.js` |
| `Sr` | **etiqueta flotante sobre el agente** (`radio-fs-agent-label`) | ⬜ (falta hover-label) |
| `yr`/`Sr`/`Qn` | HUD ecosystem + interacción | 🟡 `hud.js` |
| `Yn` (1153) | **audio**: 2 stems mp3 (mus/atm), mute, sync | ➖ nosotros generamos con Tone.js |
| `Dm,Om` | UI de la píldora de audio/volumen | 🟡 `eventlog.js` píldora |
| `xm,Sm,Cm,bm,nm` | scheduler/estado del ticker | ➖ (procedural) |

---

## Resumen de lo que FALTA portar

**Alto valor (bosque, para paridad fina):**
1. `g` **bayas** — racimos rojos/naranjas, densifican el sotobosque.
2. `Sr` **etiquetas flotantes** sobre cada agente al pasar el mouse (`GREEN WOODPECKER`).
3. `Rn` detalles finos: afinado exacto de move/rest y separación.

**Mundos nuevos (gran alcance):**
4. **CIUDAD** — `tn` calles + `bn/Sn/Cn/wn/Tn` edificios + manzanas `Xt` + especies `W/U`. El core (deambular + `pathPull` alto) ya está listo.
5. **AGUA** — `nr` config multi-mundo + campos pond + especies `be/Se/Ce` (buceadores) + dive/hover en `Rn`.
6. Especies faltantes compartidas: `xe strider`, `Se orb`, `W burst`, `Ce pins`, `U lamp`, `be ice`.

**Ya cubierto (bosque):** terreno, suelo, pasto, flores, árboles, rocas (liquen/musgo/flores), neblina, polvo, 4 especies con jaula/criatura, rodado como esfera, glide, spinY, estelas, deambular+flujo+caminos, lente, ecosistema, eventos procedurales, log, píldora, y nuestras mejoras (bichos→flores, depredación, posarse en árboles/rocas/cielo).
