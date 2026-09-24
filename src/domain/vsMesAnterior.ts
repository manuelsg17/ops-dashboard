// ─────────────────────────────────────────────────────────────────────────────
// Variación contra el RESULTADO FINAL del mes anterior — una sola regla para
// Rendimiento (escala mensual con el mes en curso) y Metas (tarjetas del
// resumen, todas las escalas).
//
// Decisión de Manuel (24-sep-2026), textual: "tiene que compararse contra el
// resultado final del mes anterior, así de simple".
//   · Flujos (N+R, horas): lo acumulado del mes a la fecha vs el total del mes
//     anterior COMPLETO. Con el mes en curso la variación sale negativa por
//     construcción; por eso el rótulo lo dice: "vs agosto (mes completo)".
//   · Snapshot (conductores activos): el nivel actual vs el nivel del ÚLTIMO
//     período del mes anterior (la semántica de siempre para un snapshot).
// Antes Metas comparaba "al mismo punto" (semanas 1-3 contra semanas 1-3) y en
// mensual con el mes en curso escondía el delta; Rendimiento también lo
// escondía. Las dos pantallas quedan con la misma lectura.
//
// Puro: sin STATE ni DOM. La asignación período → mes de reporte (reportYM) la
// pasa quien llama, porque depende de la escala.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Variación porcentual de `actual` contra `previo`. null si falta alguno o si el
 * previo es 0 (sin base no hay porcentaje: quien llama decide si eso es "NEW").
 */
export function variacionPct(actual: number | null | undefined, previo: number | null | undefined): number | null {
  if (actual == null || previo == null || !Number.isFinite(actual) || !Number.isFinite(previo) || previo === 0) return null;
  return ((actual - previo) / previo) * 100;
}

/** Mes anterior de (y, m), con m 1-12. */
export function mesAnterior(y: number, m: number): { y: number; m: number } {
  return m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
}

/**
 * Períodos del mes ANTERIOR COMPLETO (todos los de ese mes de reporte en
 * `todas`), para comparar contra su resultado final.
 *
 *   mesDates    períodos del mes que se está mirando (define el mes)
 *   todas       todos los períodos disponibles de la escala (STATE.allDates)
 *   ym          período → { y, m } del mes de REPORTE (reportYM de la escala)
 *   minCargada  primer período CARGADO en memoria ("" = nada cargado)
 *
 * null si no hay mes anterior en los datos, o si su primer período quedó fuera
 * de lo cargado (la ventana del arranque): comparar contra un mes a medias
 * daría una variación falsa — mejor no mostrarla.
 */
export function fechasMesAnteriorCompleto(
  mesDates: string[],
  todas: string[],
  ym: (d: string) => { y: number; m: number },
  minCargada: string
): { fechas: string[]; y: number; m: number } | null {
  if (!mesDates || !mesDates.length) return null;
  const r0 = ym([...mesDates].sort()[0]);
  const p = mesAnterior(r0.y, r0.m);
  const fechas = [...todas].sort().filter(d => { const r = ym(d); return r.y === p.y && r.m === p.m; });
  if (!fechas.length) return null;
  if (!minCargada || fechas[0] < minCargada) return null;
  return { fechas, y: p.y, m: p.m };
}

/**
 * Nombre del mes (1-12) tal como va DENTRO de una frase en cada idioma
 * ("agosto" / "August" / "август"). Sin Intl, null (quien llama usa su rótulo).
 */
export function mesEnFrase(m: number, lang: string): string | null {
  try {
    return new Intl.DateTimeFormat(lang, { month: "long", timeZone: "UTC" })
      .format(new Date(Date.UTC(2000, m - 1, 15)));
  } catch (e) {
    return null;
  }
}
