// domain/calcPlanilla.ts — Piezas PURAS de la planilla de la Calculadora (fase 8, sep-2026).
//
// La Calculadora pasó de cinco pasos apilados a UNA pantalla partida (panel de
// metas a la izquierda, reparto en vivo a la derecha). Nada de esto cambia la
// matemática del reparto ni del guardado (esas viven en calculator.ts y en
// repartoLinea.ts): son las reglas NUEVAS de la pantalla, sacadas acá para
// poder testearlas sin STATE ni DOM.
//
//   · atajos de meta ("+5%", "+10%", "+15%", "Igual que {mes}")
//   · variación de la meta contra la base del último mes (la pista bajo cada meta)
//   · qué celda de la tabla está "fijada a mano" y cuál pisa lo guardado
//   · "Soltar" una fila: volver al estado previo a teclearla
//   · orden de la tabla (las cuentas más grandes arriba)

/** Factores de los atajos, en el orden en que se muestran. 1 = "Igual que {mes}". */
export const ATAJOS_META: readonly number[] = [1.05, 1.10, 1.15, 1];

/**
 * Meta que pone un atajo: base × factor, redondeada al entero como el resto de
 * la Calculadora (`_calcGoalFor` redondea con Math.round). `null` si la base o
 * el factor no son números usables — el llamador no toca la meta en ese caso.
 * Base 0 da 0: un KAM sin actividad el mes pasado no tiene de dónde crecer.
 */
export function metaAtajo(base: number, factor: number): number | null {
  if (!Number.isFinite(base) || base < 0 || !Number.isFinite(factor) || factor < 0) return null;
  return Math.round(base * factor);
}

/**
 * Variación % de la meta contra la base: (meta − base) / base × 100.
 * `null` sin base (> 0) o sin meta (> 0): una meta en 0 es "todavía no cargada",
 * no un −100%.
 */
export function variacionPct(meta: number, base: number): number | null {
  if (!Number.isFinite(meta) || !Number.isFinite(base) || !(base > 0) || !(meta > 0)) return null;
  return (meta - base) / base * 100;
}

/** Texto de la variación con signo y un decimal: "+16.9%", "−3.2%", "+0.0%". */
export function textoVariacion(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "";
  const r = Math.round(Math.abs(v) * 10) / 10;
  return `${v < 0 && r > 0 ? "−" : "+"}${r.toFixed(1)}%`;
}

type Valor = number | string | undefined | null;
const cargado = (v: Valor) => v !== undefined && v !== null && v !== "";

/**
 * Estado de UNA celda de meta respecto del reparto y de la base de datos.
 *
 *   fijada      → el valor lo tecleó el KAM en esta sesión: distinto de lo que
 *                 está guardado, o sin nada guardado. No sigue el reparto
 *                 automático (así funciona `_calcGoalFor`: un edit manda).
 *   sobrescribe → fijada Y había un valor guardado distinto: al guardar se pisa.
 *
 * Un valor igual al guardado NO está "fijado a mano": viene de la base (así se
 * siembra `edits` al abrir), y marcarlo pintaría de color todas las filas de un
 * mes ya cargado. Misma regla que `_calcContarCambios` (lo que el modo "Solo lo
 * que cambié" va a escribir), para que el tinte y ese conteo digan lo mismo.
 */
export function estadoCelda(edit: Valor, saved: Valor): { fijada: boolean; sobrescribe: boolean } {
  if (!cargado(edit)) return { fijada: false, sobrescribe: false };
  const conGuardado = cargado(saved);
  const fijada = !conGuardado || +(saved as number) !== +(edit as number);
  return { fijada, sobrescribe: fijada && conGuardado };
}

/**
 * "Soltar" las celdas de una fila: devuelve una COPIA de `edits` con esas
 * claves vueltas al estado previo a teclearlas — el valor guardado si lo hay
 * (así se siembran al abrir), o sin edit (vuelven a seguir el reparto).
 * No toca las demás claves.
 */
export function soltarCeldas(
  edits: Record<string, Valor>, saved: Record<string, Valor>, claves: string[]
): Record<string, Valor> {
  const out = { ...edits };
  for (const k of claves) {
    if (cargado(saved[k])) out[k] = saved[k];
    else delete out[k];
  }
  return out;
}

/**
 * Orden de la tabla de reparto: de la cuenta más grande a la más chica según
 * los conductores activos del mes base (las que más pesan en la meta, arriba);
 * a igual tamaño, alfabético por partner y después por ciudad, para que el
 * orden sea estable entre repintados. No muta el arreglo recibido.
 */
export function ordenarUnidades<T extends { partner: string; city: string; ad: number }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    ((+b.ad || 0) - (+a.ad || 0)) ||
    String(a.partner).localeCompare(String(b.partner)) ||
    String(a.city).localeCompare(String(b.city)));
}
