import * as THREE from 'three'
import { createStage } from './stage.js'

// Mundo AGUA (pond). ESQUELETO: compone el escenario compartido (`createStage`)
// y por ahora solo dibuja la lámina de agua plana + la niebla de escena. El
// contenido (terreno lobulado, agua con olas/reflejo, las 6 especies, peces y
// nieve realista) se añade cuando aterrice la descomposición fina `engine/*`
// que lidera la sesión de CIUDAD. Cumple ya la API común del builder para que
// el host lo intercambie en caliente igual que el bosque.
//
// Paridad (spec 2026-08-11-mapa-otros-mundos.md §4): laguna radio mt=64, nivel
// de agua ht=-3.4. Valores en `cfg.pond`.
export function createPond(container, cfg, _agentNames = []) {
  const stage = createStage(container, cfg)
  const { scene } = stage
  const P = cfg.pond
  const waterY = cfg.world.groundY + P.waterLevel // -3.4

  // ─── Lámina de agua (placeholder plano) ───────────────────────────────────
  // Disco a nivel `ht`, dentro del radio de laguna. Azul frío semitransparente;
  // las olas y el reflejo llegan en la fase de render sobre `engine/*`.
  const waterGeo = new THREE.CircleGeometry(P.lagoonRadius, 96)
  waterGeo.rotateX(-Math.PI / 2)
  const waterMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.10, 0.20, 0.30),
    transparent: true, opacity: 0.85, side: THREE.DoubleSide, fog: true,
  })
  const water = new THREE.Mesh(waterGeo, waterMat)
  water.position.y = waterY
  scene.add(water)

  // ─── API del builder ──────────────────────────────────────────────────────
  function update(_swarm, dt, eco) {
    const step = dt || 0.016
    // La niebla de escena la fija el clima (igual que el bosque).
    if (eco) scene.fog.density = 0.0009 + eco.fog * 0.0028
    stage.render(step)
    return [] // sin depredaciones hasta que haya agentes/bichos
  }

  // Sin agentes ni peces aún: `scare` es un no-op hasta la fase de contenido.
  function scare() {}

  return {
    update,
    scare,
    flash: stage.flash,
    resize: stage.resize,
    dispose: stage.dispose,
  }
}
