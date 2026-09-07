// ─────────────────────────────────────────────────────────────────────────────
// ESCALA: resolución de los slices por escala activa (semanal / mensual / diario)
//
// POR QUE EXISTE ESTE ARCHIVO. Esta lógica estuvo COPIADA en cuatro lugares
// (`rendimiento`, `metas`, `partnerView`, `partnerPortal`) y escrita inline en
// otros cinco (`rawdata`). Y antes de eso estuvo MAL en todos ellos a la vez:
// era un booleano — `mensual ? mensualX : semanalX` — para TRES escalas, así que
// en DIARIO caía al slice SEMANAL en silencio. Sin error de consola, sin fila
// faltante: números de otra escala con el rótulo de la escala elegida. Ese es
// exactamente el fallo que le manda un dato equivocado a un partner.
//
// El bug reapareció TRES veces (Fleet/TukTuk en diario, el sidebar de
// solo-TukTuk, y los slices del portal) porque arreglar una copia no arregla las
// otras. Una sola función, con tests, es la única forma de cerrarlo de verdad.
//
// Estas funciones son PURAS: reciben el estado, no lo leen de un global. Por eso
// se pueden testear sin DOM, sin sesión y sin Supabase.
// ─────────────────────────────────────────────────────────────────────────────

export type Escala = "semanal" | "mensual" | "diario";

/** Las tres escalas, en el orden en que aparecen en la UI. */
export const ESCALAS: Escala[] = ["diario", "semanal", "mensual"];

/**
 * Normaliza cualquier valor a una escala válida.
 *
 * SEMANAL es el default a propósito: es la escala por defecto de la app, y ante
 * un valor corrupto (localStorage manipulado, estado a medio construir) es mejor
 * caer en la escala que el usuario espera ver que en una vacía.
 */
export function normEscala(modo: unknown): Escala {
  return modo === "mensual" || modo === "diario" ? modo : "semanal";
}

/**
 * Sufijo que llevan las claves de STATE para esta escala.
 *
 *   semanal → ""          →  STATE.rawDataTuktuk
 *   mensual → "Mensual"   →  STATE.rawDataMensualTuktuk
 *   diario  → "Diario"    →  STATE.rawDataDiarioTuktuk
 *
 * El semanal SIN sufijo es histórico (fue la primera escala que existió). No
 * cambiarlo: hay ~40 claves de STATE con ese nombre.
 */
export function sufijoEscala(modo: unknown): "" | "Mensual" | "Diario" {
  const e = normEscala(modo);
  return e === "mensual" ? "Mensual" : e === "diario" ? "Diario" : "";
}

/** Nombre de la clave de STATE para un slice y una escala. `base:""` → el agregador. */
export function claveSlice(base: string, modo: unknown): string {
  return "rawData" + sufijoEscala(modo) + (base || "");
}

/**
 * El slice de STATE para esta base y esta escala. Siempre devuelve un array:
 * una escala sin datos cargados da `[]`, nunca `undefined` — así el llamador no
 * necesita un guard y no puede confundir "no cargado" con "cero filas" a fuerza
 * de un `?.` olvidado.
 */
export function sliceEscala(state: any, base: string, modo?: unknown): any[] {
  const m = modo === undefined ? state?.curMode : modo;
  return (state && state[claveSlice(base, m)]) || [];
}

export type Linea = "agg" | "tk" | "fleet" | "comb";

/**
 * Dataset de una línea de negocio en la escala activa.
 *
 * Las cuatro líneas son LENTES sobre datos ya deduplicados, nunca aditivas:
 *   agg   → el agregador (Taxi). `state.rawData` YA es el de la escala activa
 *           (switchMode lo intercambia), por eso no se re-resuelve acá.
 *   tk    → solo TukTuk.
 *   fleet → solo Fleet (⊂ agregador: sus autos hacen Taxi).
 *   comb  → Taxi ∪ TukTuk. Se pueden concatenar porque son DISJUNTOS: los
 *           partners TukTuk se excluyen de `rawData` en la carga.
 */
export function datasetLinea(state: any, linea: Linea, modo?: unknown): any[] {
  const agg = (state && state.rawData) || [];
  if (linea === "agg")   return agg;
  if (linea === "fleet") return sliceEscala(state, "Fleet", modo);
  const tk = sliceEscala(state, "Tuktuk", modo);
  if (linea === "comb")  return agg.concat(tk);
  return tk;
}
