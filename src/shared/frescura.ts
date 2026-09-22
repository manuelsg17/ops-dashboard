// ─────────────────────────────────────────────────────────────────────────────
// FRESCURA DE DATOS: ¿falta algún período?
//
// EL PROBLEMA QUE RESUELVE. El badge del sidebar mostraba "BD actualizada hace
// N días" leyendo `ingest_log`, o sea CUÁNDO CORRIÓ la ingesta. Esa no es la
// pregunta que importa. Una corrida puede terminar en "ok" y aun así no haber
// traído el período que falta: pasó en producción (sep 2026) con la escala
// diaria parada en el 31-ago mientras el badge decía "hace 3 días" y se veía
// perfectamente sano.
//
// La pregunta correcta es HASTA CUÁNDO LLEGAN LOS DATOS de la escala que estoy
// mirando. Eso es lo que se le manda al partner en un deck rotulado "última
// semana": si el último período cargado no es el que el calendario dice que
// debería estar, el rótulo miente.
//
// Todo acá es PURO y trabaja en UTC a propósito: los períodos son strings de
// fecha sin hora ("2026-08-24", "2026-08"), y hacer aritmética con ellos en hora
// local hace que el resultado dependa del huso de quien mira. Un KAM en Lima y
// el runner de CI en UTC tienen que sacar la misma conclusión.
// ─────────────────────────────────────────────────────────────────────────────

import type { Escala } from "./escala.js";

const DIA_MS = 86400000;

/** "2026-08-24" | "2026-08" → Date en UTC. El día 1 cuando no viene día. */
function aUTC(periodo: string): Date {
  const [y, m, d] = periodo.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

const iso   = (dt: Date) => dt.toISOString().slice(0, 10);
const isoYM = (dt: Date) => dt.toISOString().slice(0, 7);

/**
 * Lunes de la semana que contiene `dt`.
 * getUTCDay(): 0=domingo … 6=sábado. El domingo retrocede 6 días, no 0 — las
 * semanas de este dashboard arrancan LUNES (verificado contra la serie real de
 * `rendimiento`: todos los períodos semanales caen en lunes).
 */
export function lunesDe(dt: Date): Date {
  const d = new Date(dt.getTime());
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d;
}

/** Último día del período (para diario es el propio día). */
export function finDePeriodo(escala: Escala, periodo: string): Date {
  const ini = aUTC(periodo);
  if (escala === "diario")  return ini;
  if (escala === "semanal") return new Date(ini.getTime() + 6 * DIA_MS);
  // mensual: día 0 del mes siguiente = último día de este mes
  return new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + 1, 0));
}

/**
 * El último período que YA CERRÓ a fecha `hoy`. Es el que debería estar cargado.
 *
 * Nunca devuelve un período en curso: el mes/semana/día corriente todavía se
 * está llenando, así que exigirlo sería marcar un falso atraso todos los días.
 */
export function ultimoPeriodoCerrado(escala: Escala, hoy: Date): string {
  if (escala === "diario") {
    return iso(new Date(hoy.getTime() - DIA_MS));            // ayer
  }
  if (escala === "semanal") {
    return iso(new Date(lunesDe(hoy).getTime() - 7 * DIA_MS)); // lunes de la semana pasada
  }
  return isoYM(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1)));
}

/** Período siguiente al dado. */
export function siguientePeriodo(escala: Escala, periodo: string): string {
  const d = aUTC(periodo);
  if (escala === "mensual") return isoYM(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
  return iso(new Date(d.getTime() + (escala === "semanal" ? 7 : 1) * DIA_MS));
}

/**
 * Días de gracia entre que un período cierra y que lo consideramos atrasado.
 * Salen de la cadencia REAL de la ingesta, no de un número redondo:
 *  - semanal: la semana cierra domingo y la tarea programada corre el martes
 *    9am Lima → 2 días. El miércoles sin datos ya es un problema.
 *  - diario: el reporte del día aparece al día siguiente; 2 días de colchón.
 *  - mensual: el cierre contable tarda más; 4 días.
 */
export const GRACIA_DIAS: Record<Escala, number> = { diario: 2, semanal: 2, mensual: 4 };

export interface Frescura {
  /** Último período realmente cargado (o null si no hay datos). */
  ultimo: string | null;
  /** El último que ya cerró según el calendario. */
  esperado: string;
  /** Cuántos períodos faltan entre uno y otro. 0 = al día. */
  faltan: number;
  /** true si además ya pasó la ventana de gracia de la ingesta. */
  atrasado: boolean;
  /**
   * Días desde que cerró el PRIMER período faltante — no el último.
   *
   * La diferencia importa: con la escala diaria parada hace una semana, el
   * último faltante cerró ayer y mediría 1 día, ocultando el problema justo
   * cuando es más grave. El primero que falta es el que dice hace cuánto se
   * cortó el suministro. 0 cuando no falta ninguno.
   */
  diasDesdeCierre: number;
}

/**
 * Compara lo cargado contra lo que el calendario dice que debería estar.
 *
 * `faltan` y `atrasado` son distintos A PROPÓSITO: el lunes a la mañana la
 * semana ya cerró (faltan = 1) pero la ingesta todavía no corrió, así que NO
 * está atrasado. Marcar rojo ahí entrenaría a ignorar el indicador, que es la
 * forma más segura de que nadie lo mire el día que importa.
 */
export function evaluarFrescura(
  escala: Escala,
  periodos: string[] | null | undefined,
  hoy: Date = new Date()
): Frescura {
  const esperado = ultimoPeriodoCerrado(escala, hoy);
  const lista = (periodos || []).filter(Boolean).slice().sort();
  const ultimo = lista.length ? lista[lista.length - 1] : null;

  // Sin datos todavía (arranque, o una escala que aún no se cargó) NO es un
  // atraso: sería un falso positivo en cada arranque, y eso entrena a ignorar
  // el indicador.
  if (!ultimo)           return { ultimo: null, esperado, faltan: 0, atrasado: false, diasDesdeCierre: 0 };
  // `>=` y no `===`: una carga manual adelantada deja un período MÁS NUEVO que
  // el esperado. Eso no es un error.
  if (ultimo >= esperado) return { ultimo, esperado, faltan: 0, atrasado: false, diasDesdeCierre: 0 };

  const primerFaltante = siguientePeriodo(escala, ultimo);
  const diasDesdeCierre = Math.floor(
    (hoy.getTime() - finDePeriodo(escala, primerFaltante).getTime()) / DIA_MS
  );
  return {
    ultimo, esperado,
    faltan: contarPeriodos(escala, ultimo, esperado),
    atrasado: diasDesdeCierre > GRACIA_DIAS[escala],
    diasDesdeCierre
  };
}

/** Cuántos períodos hay entre `desde` (exclusivo) y `hasta` (inclusivo). */
export function contarPeriodos(escala: Escala, desde: string, hasta: string): number {
  const a = aUTC(desde), b = aUTC(hasta);
  if (escala === "mensual") {
    return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  }
  const dias = Math.round((b.getTime() - a.getTime()) / DIA_MS);
  return escala === "semanal" ? Math.round(dias / 7) : dias;
}
