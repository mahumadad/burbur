import * as THREE from 'three'
import { createStage } from './stage.js'
import { createDraw } from './engine/points.js'

// Constantes de paridad (reversed del bundle original, tabla `hg`/geometría de ciudad):
//   Wt = medio-lado de la cuadrícula, Gt = ancho de calle, Kt = altura de bordillo,
//   we = nivel de suelo de la calle. R_CITY = radio aproximado del bloque.
const Wt = 62, Gt = 13, Kt = 2.4, we = -4
const R_CITY = Wt * 1.18

// Mundo CIUDAD ("Block ecosystem"). Por ahora es un esqueleto mínimo pero
// conmutable: usa el stage compartido y un suelo plano temporal para poder
// intercambiar mundos sin romper el host. Terreno, edificios, agentes y clima
// llegan en tareas posteriores.
export function createCityScene(container, cfg, agentNames = []) {
  const rc = cfg.render
  const stage = createStage(container, cfg)
  const { scene } = stage
  const draw = createDraw(rc)

  // Suelo temporal: plano gris a la altura de calle (we). Se reemplaza por la
  // cuadrícula real 150×150 en una tarea posterior.
  const g = new THREE.PlaneGeometry(Wt * 2.35, Wt * 2.35, 4, 4)
  g.rotateX(-Math.PI / 2)
  const ground = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x20242c, fog: true }))
  ground.position.y = we
  scene.add(ground)

  stage.setResizeHook((m) => { draw.uniforms.uProj.value = m.proj })

  function update(swarm, dt, eco) {
    stage.render(dt || 0.016)
    return []
  }

  // Temporal: la sacudida no tiene efecto aún hasta que haya agentes/mundo real.
  function scare(strength) {}

  return {
    update,
    resize: stage.resize,
    flash: stage.flash,
    scare,
    dispose: stage.dispose,
  }
}
