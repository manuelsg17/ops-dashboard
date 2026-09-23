// ─────────────────────────────────────────────────────────────────────────────
// Desglose por KAM que SUMA el total (bug B4 del plan de mejora sep-2026).
//
// Antes, "Por KAM" y el desglose de cada tarjeta país de Rendimiento iteraban
// `Object.values(STATE.KAM_MAP)`: ahí nunca aparece "No KAM" (un partner sin KAM
// tiene "" en KAM_MAP, y KAM_PARTNERS[""] no existe), así que las filas de los
// partners huérfanos quedaban fuera de TODOS los grupos. En local: 7.724 + 4.883
// + 1.273 ≠ 14.637. Y con el filtro "No KAM" la sección salía vacía.
//
// Ahora el desglose es una PARTICIÓN de las filas por su KAM efectivo: cada fila
// cae en exactamente un grupo, así que las partes suman el total por
// construcción, sin depender de que dos estructuras (KAM_MAP y KAM_PARTNERS)
// estén de acuerdo.
// ─────────────────────────────────────────────────────────────────────────────

/** Agrupa filas por el KAM que devuelve `kamOf` (partición: cada fila en un solo grupo). */
export function particionarPorKam<T>(rows: T[], kamOf: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows || []) {
    const k = kamOf(r);
    let a = out.get(k);
    if (!a) { a = []; out.set(k, a); }
    a.push(r);
  }
  return out;
}

/**
 * Orden de presentación de los KAMs: alfabético, con el bucket "sin KAM" al
 * FINAL (es un pendiente de configuración, no un KAM más — mismo criterio que el
 * desplegable del sidebar). Sin repetidos ni vacíos.
 */
export function ordenarKams(kams: Iterable<string>, sinKam: string): string[] {
  const set = new Set([...kams].filter(k => k != null && String(k).trim() !== ""));
  const reales = [...set].filter(k => k !== sinKam).sort((a, b) => a.localeCompare(b));
  return set.has(sinKam) ? [...reales, sinKam] : reales;
}
