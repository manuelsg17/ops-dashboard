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
// hasta qué día llega la fila MTD, y la fila no lo dice (no trae fecha de
// corte). La ingesta es SEMANAL, así que el corte es el FIN del último período
// semanal cargado (su lunes + 6), con tope en AYER en Lima (el día de hoy
// todavía no terminó). Sin períodos semanales conocidos: ayer. Antes se usaba
// siempre "ayer" y, con la carga atrasada, la proyección salía baja (seed: la
// mensual de septiembre llega al 20-sep → 7,343 en mensual vs 8,445 en
// semanal para el mismo mes).
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

const DIA_MS = 86400000;
const aISO = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Último día con datos que se puede suponer en la fila mensual MTD: el fin del
 * último período semanal conocido (lunes + 6), con tope en ayer (Lima). Sin
 * períodos semanales: ayer. ISO "YYYY-MM-DD".
 */
export function corteDatosMensual(periodosSemanales?: readonly string[] | null, hoy: Date = new Date()): string {
  const h = fechaLima(hoy);
  const ayer = Date.UTC(h.y, h.m - 1, h.d - 1);
  let max = "";
  for (const p of periodosSemanales || []) if (typeof p === "string" && p > max) max = p;
  if (!/^\d{4}-\d{2}-\d{2}/.test(max)) return aISO(ayer);
  const [y, m, d] = max.slice(0, 10).split("-").map(Number);
  const fin = Date.UTC(y, m - 1, d + 6);
  return aISO(Math.min(fin, ayer));
}

/**
 * Días del mes `mes` (1-12) de `anio` para proyectar un flujo MTD en escala
 * mensual, con la fecha de `corte` usada, o `null` si ese mes NO es el mes en
 * curso en Lima (mes cerrado o futuro: se conserva la regla de siempre,
 * período completo).
 *
 * `anio` null/undefined = meta sin año: se compara solo el mes (mismo criterio
 * que esMesEnCurso). `periodosSemanales`: fechas de inicio de los períodos
 * semanales conocidos (STATE._allPeriods.semanal) — ver corteDatosMensual.
 *
 * Si el corte cae antes del día 1 del mes (primer día del mes, o la semana del
 * mes todavía no cargó) → `null`: sin días con datos, no se extrapola (la
 * proyección queda igual al actual).
 */
export function diasMesEnCursoMensual(mes: number, anio?: number | null, hoy: Date = new Date(),
                                      periodosSemanales?: readonly string[] | null): (DiasMes & { corte: string }) | null {
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return null;
  const h = fechaLima(hoy);
  if (mes !== h.m || (anio != null && anio !== h.y)) return null;
  const daysInMonth = new Date(Date.UTC(h.y, h.m, 0)).getUTCDate();
  const corte = corteDatosMensual(periodosSemanales, hoy);
  const [cy, cm, cd] = corte.split("-").map(Number);
  if (cy !== h.y || cm !== h.m) return null;         // corte antes del día 1 del mes
  const daysElapsed = Math.min(cd, daysInMonth);
  if (daysElapsed <= 0) return null;
  return { daysElapsed, daysRemaining: daysInMonth - daysElapsed, daysInMonth, corte };
}
