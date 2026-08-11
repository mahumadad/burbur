// Máquina de estados visual de la mitosis: traduce fase del ciclo celular +
// phaseT (0..1 dentro de la fase) a los 4 gestos que consume el render para
// condensar cromatina, alinear cromosomas, separarlos a los polos y
// estrangular la membrana. Puro: sin three/DOM.

const lerp = (a, b, t) => a + (b - a) * t

const REPOSO = { condensation: 0, alignment: 0, separation: 0, furrow: 0 }

/** Traduce (fase, phaseT 0..1 dentro de la fase) a los gestos visibles de la mitosis. */
export function mitosisState(phase, phaseT) {
  switch (phase) {
    case 'prophase':
      return { condensation: phaseT, alignment: 0, separation: 0, furrow: 0 }
    case 'metaphase':
      return { condensation: 1, alignment: phaseT, separation: 0, furrow: 0 }
    case 'anaphase':
      return { condensation: 1, alignment: 1, separation: phaseT, furrow: 0 }
    case 'telophase':
      return { condensation: 1 - phaseT, alignment: 1, separation: 1, furrow: lerp(0, 0.4, phaseT) }
    case 'cytokinesis':
      return { condensation: 0, alignment: 0, separation: 1, furrow: lerp(0.4, 1, phaseT) }
    default:
      return { ...REPOSO }
  }
}
