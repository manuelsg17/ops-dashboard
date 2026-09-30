// domain/cuadre.ts — ¿la suma del reparto cuadra con la meta del KAM? (puro)
//
// EXACTO (30-sep-2026). La tolerancia vieja de 0.5% de la meta venía de cuando
// el reparto redondeaba fila por fila y la suma podía quedar ±n. Desde el
// reparto por resto mayor (repartoLinea.cuotasEnteras, 29-sep) la suma del
// reparto ES la meta, y el 0.5% escondía ediciones reales: subir una celda en
// +10 sobre una meta de 3,000 seguía diciendo "Cuadra" (3,010 / 3,000).
// Las metas son enteras: "cuadra" = diferencia menor a medio conductor/hora.

export const TOL_CUADRE = 0.5;

export interface Cuadre { sum: number; target: number; gap: number; ok: boolean; hasGoal: boolean }

export function cuadreMetrica(sum: number, target: number): Cuadre {
  const hasGoal = target > 0;
  const gap = sum - target;
  return { sum, target, gap, ok: hasGoal && Math.abs(gap) < TOL_CUADRE, hasGoal };
}
