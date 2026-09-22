// ─────────────────────────────────────────────────────────────────────────────
// VENTANA DE CARGA SEMANAL: desde qué período traer `rendimiento`.
//
// EL PROBLEMA QUE RESUELVE. Desde la Fase A3, el arranque pedía primero la
// lista de períodos (RPC `dashboard_dates`: ~116 ms en el servidor + un
// round-trip Lima→us-east de ~285-315 ms) y RECIÉN AHÍ disparaba el fetch de
// `rendimiento` — el más pesado del arranque — con el filtro `gte winStart`.
// Esa RPC era el único eslabón secuencial delante de la tabla más grande.
//
// LA IDEA. El inicio de la ventana se puede estimar desde el CALENDARIO (como ya
// hace la escala diaria con `_daysAgoISO`) y disparar `rendimiento` en el acto,
// con la RPC corriendo en paralelo. Cuando la RPC llega, `planVentanaSemanal`
// reconcilia: recorta lo que sobró o pide lo que faltó.
//
// EL INVARIANTE (no negociable): el inicio del calendario NUNCA puede ser
// POSTERIOR al que devolvería `computeWindowStart` con la lista real de
// períodos. Cargar un período de más es barato; que falte uno rompe el WoW del
// primer período de la ventana (mostraría "NEW"). Por eso:
//   1. el calendario lleva HOLGURA para los casos reales (semana recién cerrada
//      todavía sin ingestar, huecos en la serie) — tests en ventanaCarga.test.ts;
//   2. y aun así la holgura NO es la garantía: la garantía es la reconciliación
//      de `planVentanaSemanal`, que pide el complemento si la realidad resultó
//      más vieja que la estimación (ingesta parada varias semanas, huecos
//      grandes). La holgura solo decide cuán seguido hace falta ese complemento.
//
// Todo acá es PURO y en UTC, igual que frescura.ts: los períodos son strings de
// fecha sin hora, y en hora local el resultado dependería del huso de quien mira.
// ─────────────────────────────────────────────────────────────────────────────

import { lunesDe } from "./frescura.js";

const DIA_MS = 86400000;

// Cuántos períodos se traen por defecto en cada escala. El objetivo es que el
// payload quede acotado por la VENTANA y no por el tamaño de la tabla — que
// crece ~180 filas/semana para siempre. El usuario puede pedir más hacia atrás
// (el sidebar ofrece TODOS los períodos vía dashboard_dates) y ahí se re-fetchea.
export const LOAD_WINDOW: Record<string, number> = { semanal: 6, mensual: 6, diario: 90 };

// Desde qué período cargar datos. Toma los últimos LOAD_WINDOW períodos, pero
// respeta `wantFrom` si el usuario tenía guardado un rango más viejo (así no se
// le "corta" su vista al recargar). Siempre suma UN período extra hacia atrás:
// las comparativas WoW/MoM del primer período de la ventana necesitan el
// anterior para calcular su badge — sin él, el primer período mostraría "NEW".
//
// (Movida tal cual desde data.ts para poder testearla contra el calendario; la
// semántica no cambió — incluido que un `wantFrom` que no está en la lista cae
// a allPeriods[0].)
export function computeWindowStart(
  allPeriods: string[] | null | undefined,
  scale: string,
  wantFrom?: string | null
): string | null {
  if (!allPeriods || !allPeriods.length) return null;
  const n   = LOAD_WINDOW[scale] || 16;
  let start = allPeriods[Math.max(0, allPeriods.length - n)];
  if (wantFrom && wantFrom < start) start = wantFrom;
  const si = allPeriods.indexOf(start);
  return si > 0 ? allPeriods[si - 1] : allPeriods[0];
}

/**
 * Semanas de colchón por encima del caso ideal. Cubre, sin necesidad de
 * complemento, cualquiera de estos casos reales (y su combinación de a dos):
 *  - la semana recién cerrada todavía sin ingestar (lunes y martes hasta las
 *    ~14:00 UTC: la tarea corre los martes 9am Lima);
 *  - un hueco en la serie dentro de la ventana.
 * Más allá de eso (ingesta parada 2+ semanas, varios huecos) la estimación se
 * queda corta y `planVentanaSemanal` pide el complemento: nunca falta un
 * período, solo se paga el round-trip que había antes.
 *
 * Costo: en el caso normal (miércoles a domingo, semana ingestada) se descargan
 * 2 semanas de más (~9 en vez de 7) que después se descartan. Con gzip son
 * decenas de kB; el round-trip que se ahorra son ~300-400 ms.
 */
export const HOLGURA_SEMANAS = 2;

/**
 * Inicio ESTIMADO de la ventana semanal, sin conocer la lista de períodos.
 *
 * Caso ideal: la última semana cerrada (lunes de la semana pasada) ya está
 * cargada, sin huecos. `computeWindowStart` toma los últimos `n` períodos más
 * uno extra → el inicio real es `lunesDe(hoy) − 7·(n+1)` días. A eso se le
 * resta la holgura.
 *
 * Siempre devuelve un LUNES (la columna `fecha` semanal es el lunes de cada
 * semana), así que el filtro `gte` corta en un borde de período.
 */
export function inicioVentanaSemanalCalendario(
  hoy: Date,
  n: number = LOAD_WINDOW.semanal,
  holgura: number = HOLGURA_SEMANAS
): string {
  const lunes = lunesDe(hoy);
  return new Date(lunes.getTime() - 7 * (n + 1 + holgura) * DIA_MS).toISOString().slice(0, 10);
}

export interface PlanVentana {
  /**
   * Desde dónde queda cargado DE VERDAD (→ STATE._loadedFrom). `null` = sin
   * cota inferior (toda la tabla), igual que antes cuando la RPC fallaba.
   */
  loadedFrom: string | null;
  /**
   * Descartar las filas con fecha < esto. Deja en memoria EXACTAMENTE lo mismo
   * que dejaba el camino anterior (RPC primero): ni las vistas ni el caché ven
   * la holgura. `null` = no recortar.
   */
  recortarDesde: string | null;
  /**
   * Rango extra a pedir: `[desde, hasta)`. `desde: null` = sin cota inferior.
   * `null` = no hace falta nada más.
   */
  complemento: { desde: string | null; hasta: string } | null;
}

/**
 * Reconciliación, una vez que llegó la RPC: qué hacer con la ventana que se
 * pidió por calendario (`fecha >= inicioCalendario`).
 *
 *  - RPC OK y el inicio real es igual o posterior al estimado (lo normal):
 *    se recorta al inicio real. Resultado idéntico al camino anterior.
 *  - RPC OK y el inicio real es ANTERIOR (ingesta parada, huecos grandes): se
 *    pide el complemento `[real, inicioCalendario)`. Idéntico al anterior
 *    también, pagando el round-trip secuencial solo en este caso raro.
 *  - RPC caída (lista vacía): no se puede saber cuál era el inicio real, así
 *    que se pide TODO lo anterior al calendario — lo mismo que hacía el camino
 *    anterior en ese caso (`computeWindowStart([])` → null → tabla entera).
 *    Degrada performance, nunca deja un período afuera.
 */
export function planVentanaSemanal(
  inicioCalendario: string,
  periodos: string[] | null | undefined
): PlanVentana {
  const real = computeWindowStart(periodos, "semanal");
  if (!real) {
    return { loadedFrom: null, recortarDesde: null, complemento: { desde: null, hasta: inicioCalendario } };
  }
  if (real < inicioCalendario) {
    return { loadedFrom: real, recortarDesde: null, complemento: { desde: real, hasta: inicioCalendario } };
  }
  return { loadedFrom: real, recortarDesde: real, complemento: null };
}
