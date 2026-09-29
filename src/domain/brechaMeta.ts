// domain/brechaMeta.ts — "¿Llegamos a la meta?" (puro).
//
// Franja de arriba de Desempeño (29-sep-2026, Manuel eligió la propuesta 1 con
// la franja de la 3). El veredicto usa SIEMPRE la proyección que ya muestra la
// app (Metas/anillo): nunca un criterio propio que pueda contradecirla.
//   · Flujos (N+R, horas): faltan = meta − acumulado; ritmo actual = acumulado
//     por semana transcurrida; ritmo necesario = faltan por semana restante.
//   · Snapshot (AD): faltan = meta − nivel actual (el ritmo no aplica).

export interface EntradaBrecha {
  tipo: "flujo" | "nivel";
  actual: number | null;
  meta: number | null;
  /** Proyección al cierre que ya muestra la app (null si el mes está cerrado). */
  proj: number | null;
  diasTranscurridos: number;
  diasRestantes: number;
}
export interface Brecha {
  falta: number;
  pct: number | null;
  projPct: number | null;
  ritmoActual: number | null;     // por semana
  ritmoNecesario: number | null;  // por semana
  /** true/false según la proyección; null si no hay proyección (mes cerrado). */
  llega: boolean | null;
  cerrado: boolean;
}

export function calcularBrecha(e: EntradaBrecha): Brecha | null {
  const meta = Number(e.meta) || 0;
  if (!(meta > 0) || e.actual == null) return null;
  const actual = Number(e.actual) || 0;
  const falta = Math.max(meta - actual, 0);
  const pct = actual / meta * 100;
  const projPct = e.proj != null && Number.isFinite(e.proj) ? e.proj / meta * 100 : null;
  const cerrado = e.diasRestantes <= 0 || projPct == null;
  let ritmoActual: number | null = null, ritmoNecesario: number | null = null;
  if (e.tipo === "flujo") {
    ritmoActual = e.diasTranscurridos > 0 ? actual / (e.diasTranscurridos / 7) : null;
    ritmoNecesario = e.diasRestantes > 0 ? falta / (e.diasRestantes / 7) : null;
  }
  return { falta, pct, projPct, ritmoActual, ritmoNecesario, llega: projPct == null ? null : projPct >= 100, cerrado };
}
