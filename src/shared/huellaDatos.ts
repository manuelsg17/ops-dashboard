// ─────────────────────────────────────────────────────────────────────────────
// Huella de un conjunto de respuestas crudas de Supabase (Ola 2, V4).
//
// Para qué: el arranque pinta desde el caché y, cuando llega la red, volvía a
// aplicar y re-renderizar TODO aunque los datos fueran los mismos (6 de cada 7
// días: la ingesta es semanal). Con la huella del snapshot guardada junto a él,
// si la red trae exactamente lo mismo se salta el segundo render y el guardado.
//
// Qué entra: CADA fila completa (JSON de todas sus columnas), de CADA tabla —
// incluidas las de tagging (partners/fleetrooms/flotas), que cambian números sin
// cambiar ninguna fila de rendimiento. Así "igual" es igual de verdad; lo
// liviano es el hash (FNV-1a de 32 bits), no lo que se mira.
//
// Independiente del orden de las filas: PostgREST ordena por fecha pero NO
// garantiza el orden entre filas de la misma fecha, y un orden distinto no es
// un dato distinto. Por tabla se combinan cantidad + suma + XOR de los hashes
// por fila (dos agregados independientes para que un choque sea improbable).
// Si igual chocara, el costo es mostrar el snapshot (que ya estaba en pantalla)
// hasta la próxima carga — la dirección segura sería al revés, por eso se usan
// las filas completas y no un subconjunto de columnas.
//
// Puro: sin STATE ni DOM.
// ─────────────────────────────────────────────────────────────────────────────

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Huella de una tabla (array de filas). Independiente del orden. */
export function huellaTabla(filas: unknown): string {
  if (!Array.isArray(filas)) return `x:${typeof filas}:${filas === null ? "null" : String(filas)}`;
  let suma = 0, xor = 0;
  for (const f of filas) {
    const h = fnv1a(JSON.stringify(f));
    suma = (suma + h) >>> 0;
    xor = (xor ^ h) >>> 0;
  }
  return `${filas.length}.${suma.toString(36)}.${xor.toString(36)}`;
}

/** Huella de varias partes (tablas u otros valores), en ESE orden. */
export function huellaDatos(partes: unknown[]): string {
  return partes.map(p => Array.isArray(p) ? huellaTabla(p) : `v:${JSON.stringify(p ?? null)}`).join("|");
}
