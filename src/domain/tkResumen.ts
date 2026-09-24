// Resumen de la porción TukTuk en la Calculadora (sep-2026). PURO: sin STATE
// ni DOM. Solo PANTALLA: la matemática del reparto (repartoLinea.ts) no pasa
// por acá; esto resume lo que ya calculó para mostrarlo en el panel y el cuadre.

/** Absoluto que sale de un % declarado sobre la meta del KAM (el número que
 *  va al Loyalty Program). null si falta el % o la meta: sin eso no hay cifra. */
export function absolutoTk(meta: unknown, pct: unknown): number | null {
  const m = Number(meta) || 0, p = Number(pct) || 0;
  return p > 0 && m > 0 ? Math.round(m * p / 100) : null;
}

type BaseTk = { adTk?: number; shTk?: number; nrTk?: number };

/** Suma de las porciones TukTuk TAL COMO LAS MUESTRA la tabla: cada fila
 *  redondeada por separado y solo las filas con porción (> 0). Así el total del
 *  cuadre es exactamente la suma de las sub-líneas que se ven. */
export function sumaPorcionesTk(bases: Iterable<BaseTk>): { ad: number; sh: number; nr: number } {
  const s = { ad: 0, sh: 0, nr: 0 };
  for (const b of bases) {
    const vals = { ad: b.adTk, sh: b.shTk, nr: b.nrTk };
    (["ad", "sh", "nr"] as const).forEach(k => {
      const v = Number(vals[k]) || 0;
      if (v > 0) s[k] += Math.round(v);
    });
  }
  return s;
}
