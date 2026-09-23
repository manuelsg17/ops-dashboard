// ─────────────────────────────────────────────────────────────────────────────
// Meta de una TASA (SH/auto, aceptación, utilización) agregada sobre varias
// unidades (partner, ciudad) — bug B6 del plan de mejora sep-2026.
//
// El portal del partner le daba a cada fila de meta el MISMO peso (el total del
// partner), o sea un promedio simple: una ciudad con 100 autos al 90% y otra con
// 2 autos al 50% daban 70% en el portal y ~89% en la pestaña Metas. Mismo
// partner, mismo mes, dos metas distintas — y el portal es lo que ve el partner.
//
// Ahora cada meta pesa lo que pesa SU unidad (autos para SH/auto y utilización,
// viajes para aceptación), igual que `_metasAggKpi` en metas.ts.
//
// Única diferencia deliberada con Metas: si NINGUNA unidad tiene peso (ninguna
// operó en el rango), `weightedAvg` devolvería 0 — que se lee como "tu meta es
// 0%". Acá se cae al promedio simple de las metas cargadas, que es lo único que
// se sabe. Sin ninguna meta cargada → null ("sin meta"), nunca 0.
// ─────────────────────────────────────────────────────────────────────────────

export function metaTasaPonderada<T>(
  metaRows: T[],
  metaDe: (m: T) => number | null | undefined,
  pesoDe: (m: T) => number | null | undefined
): number | null {
  let num = 0, den = 0, suma = 0, n = 0;
  for (const m of metaRows || []) {
    const v = metaDe(m);
    if (v == null || isNaN(v)) continue;
    suma += v; n++;
    const w = pesoDe(m);
    if (w == null || isNaN(w) || w <= 0) continue;
    num += v * w; den += w;
  }
  if (!n) return null;
  return den > 0 ? num / den : suma / n;
}
