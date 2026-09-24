// ─────────────────────────────────────────────────────────────────────────────
// Días transcurridos del MES EN CURSO, para proyectar un flujo (N+R, horas) en
// escala MENSUAL.
//
// EL PROBLEMA (24-sep-2026). En mensual el período ES el mes, y toda la app lo
// trataba como CERRADO (diasMesReporte: daysElapsed = días del mes). Para un mes
// pasado es correcto. Para el mes en curso no: la fila de septiembre trae el
// acumulado a la fecha (MTD), así que la "proyección al cierre" de N+R y horas
// quedaba igual al actual (72,7% → proyección 72,7%), mientras la de Conductores
// activos sí mostraba el potencial ×1.4 (132%). En semanal y diario el mismo mes
// sí se extrapolaba por días — la escala cambiaba la respuesta a la misma
// pregunta.
//
// LA REGLA. Mismo prorrateo que semanal/diario (domain/metrics.projectFlow:
// total × días del mes / días transcurridos). Lo único que hay que decidir es
// cuántos días cubre la fila MTD, y la fila no lo dice (no trae fecha de corte).
// Se toman los días YA CERRADOS en Lima: hasta AYER. El día de hoy todavía no
// terminó, y los exports de taxiparks se piden por días completos. Si la carga
// mensual quedara atrasada varios días, la proyección saldría algo BAJA (se
// divide por más días de los que trae el dato) — el error es conservador, nunca
// infla.
//
// Hora de Lima por la misma razón que domain/mesEnCurso: a las 20:00 del 30-sep
// en Lima ya es 1-oct en UTC.
//
// Puro: `hoy` entra por parámetro (default: el reloj).
// ─────────────────────────────────────────────────────────────────────────────

import { TZ_LIMA } from "./mesEnCurso";

export interface DiasMes {
  daysElapsed: number;
  daysRemaining: number;
  daysInMonth: number;
}

/** Año, mes (1-12) y día calendario de `d` en Lima. */
export function fechaLima(d: Date = new Date()): { y: number; m: number; d: number } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_LIMA, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(d);
  const n = (tipo: string) => Number(partes.find(p => p.type === tipo)?.value);
  return { y: n("year"), m: n("month"), d: n("day") };
}

/**
 * Días del mes `mes` (1-12) de `anio` para proyectar un flujo MTD en escala
 * mensual, o `null` si ese mes NO es el mes en curso en Lima (mes cerrado o
 * futuro: se conserva la regla de siempre, período completo).
 *
 * `anio` null/undefined = meta sin año: se compara solo el mes (mismo criterio
 * que esMesEnCurso).
 *
 * El primer día del mes todavía no hay ningún día cerrado → `null` también: sin
 * base, no se extrapola (la proyección queda igual al actual).
 */
export function diasMesEnCursoMensual(mes: number, anio?: number | null, hoy: Date = new Date()): DiasMes | null {
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return null;
  const h = fechaLima(hoy);
  if (mes !== h.m || (anio != null && anio !== h.y)) return null;
  const daysInMonth = new Date(Date.UTC(h.y, h.m, 0)).getUTCDate();
  const daysElapsed = h.d - 1;                       // días completos: hasta ayer
  if (daysElapsed <= 0) return null;
  return { daysElapsed, daysRemaining: daysInMonth - daysElapsed, daysInMonth };
}
