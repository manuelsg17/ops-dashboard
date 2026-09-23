// ─────────────────────────────────────────────────────────────────────────────
// Estado de cumplimiento de una fila (partner·ciudad) en Metas — decide en qué
// chip de filtro cae ("Sobre meta" / "En meta" / "Bajo meta" / "Sin meta").
//
// Decisión de Manuel (24-sep-2026), textual: "Sobre = todos los KPIs ≥100%;
// Bajo = alguno <95%; En meta = el resto". Los COLORES (pColor 80/95/150) NO
// cambian: esto solo clasifica para el filtro. Antes "Sobre meta" era "todos
// ≥95 y alguno >150" (el morado de "revisa la meta"), que dejaba afuera a quien
// cumplía todo entre 100 y 150.
//
// Precedencia: "bajo" gana a todo (un KPI flojo es lo primero que hay que ver),
// después "sobre" (TODOS ≥100), y "en" es el resto (todos ≥95, alguno <100).
//
// Puro: recibe los % (100 = meta cumplida) de los KPIs que tienen meta > 0 y
// actual medible. Sin ningún % → "na" (nada medible contra meta).
// ─────────────────────────────────────────────────────────────────────────────

export type EstadoMeta = "sin" | "na" | "bajo" | "en" | "sobre";

export const UMBRAL_BAJO = 95;
export const UMBRAL_SOBRE = 100;

export function estadoMetaFila(pcts: readonly number[], sinMeta = false): EstadoMeta {
  if (sinMeta) return "sin";
  const ps = pcts.filter(p => typeof p === "number" && Number.isFinite(p));
  if (!ps.length) return "na";
  if (ps.some(p => p < UMBRAL_BAJO)) return "bajo";
  if (ps.every(p => p >= UMBRAL_SOBRE)) return "sobre";
  return "en";
}
