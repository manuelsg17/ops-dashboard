// ─────────────────────────────────────────────────────────────────────────────
// Avance de la línea TukTuk: el ACTUAL suma todas las cuentas, el % se calcula
// SOLO sobre las cuentas con cuota declarada.
//
// Decisión de Manuel (24-sep-2026), textual: "porcentaje de la pestaña tuktuk en
// metas vs el % sobre las cuentas con cuota declarada, es decir que el progreso
// actual si es 1300, eso debe mostrar, pero el % sí sobre las metas declaradas
// indicando".
//
// Por qué: la cuota TukTuk (meta_tk_*) solo existe si el KAM la declaró en la
// Calculadora — en producción es la excepción. Antes el % era el actual de TODAS
// las cuentas TukTuk contra la cuota de las pocas que la tienen (4.621 de 1.414
// = 327%): un número que no mide a nadie. Ahora:
//   · actual    = todas las cuentas (lo que se muestra grande, igual que antes)
//   · meta      = la suma de las cuotas declaradas (igual que antes)
//   · pct       = actual DE LAS CUENTAS CON CUOTA ÷ esa cuota
//   · pctProj   = proyección de las cuentas con cuota ÷ esa cuota
// y se dice cuántas cuentas entran ("3 de 10 cuentas").
//
// Una cuota guardada en 0 ES una cuota declarada (NULL ≠ 0, mismo criterio que
// domain/cuotaTk): la cuenta entra al grupo, aunque sin meta > 0 no hay %.
//
// Pura y genérica: la agregación (suma, o serie agregada para el snapshot de
// AD) la pone quien llama — acá solo se decide QUÉ unidades entran a cada lado.
// ─────────────────────────────────────────────────────────────────────────────

/** Resultado de agregar un KPI sobre un conjunto de unidades. */
export interface Agregado {
  actual: number | null;
  meta: number | null;
  proj: number | null;
}

export interface AvanceCuota {
  /** Actual de TODAS las cuentas (el número grande). */
  actual: number | null;
  /** Suma de las cuotas declaradas (null = ninguna cuenta la declaró). */
  meta: number | null;
  /** Proyección de TODAS las cuentas (acompaña al actual). */
  proj: number | null;
  /** Actual de las cuentas con cuota (null = sin cuota > 0 contra qué medir). */
  actualCuota: number | null;
  /** Proyección de las cuentas con cuota. */
  projCuota: number | null;
  /** actualCuota ÷ meta × 100; null sin meta > 0 o sin ningún actual. */
  pct: number | null;
  /** projCuota ÷ meta × 100; null si no hay proyección o meta > 0. */
  pctProj: number | null;
  /** Cuentas con cuota declarada para este KPI. */
  nCuota: number;
  /** Cuentas con algún dato de este KPI (actual o cuota). */
  nTotal: number;
}

export interface OpcionesAvanceCuota<U> {
  /** ¿La unidad tiene la cuota de ESTE KPI declarada? (0 cuenta como declarada). */
  declarada: (u: U) => boolean;
  /** ¿La unidad tiene algún dato de este KPI? (para el "de N cuentas"). */
  conDato: (u: U) => boolean;
  /** Agregación del KPI sobre un subconjunto (la misma para los dos lados). */
  agregar: (us: U[]) => Agregado;
}

export function avanceSobreCuota<U>(unidades: U[], o: OpcionesAvanceCuota<U>): AvanceCuota {
  const todas = o.agregar(unidades);
  const conCuota = unidades.filter(o.declarada);
  const nTotal = unidades.filter(u => o.declarada(u) || o.conDato(u)).length;
  const base = {
    actual: todas.actual, proj: todas.proj,
    nCuota: conCuota.length, nTotal
  };
  if (!conCuota.length) {
    return { ...base, meta: null, actualCuota: null, projCuota: null, pct: null, pctProj: null };
  }
  const dec = o.agregar(conCuota);
  const meta = dec.meta;
  if (!(meta != null && meta > 0) || todas.actual == null) {
    return { ...base, meta, actualCuota: dec.actual, projCuota: dec.proj, pct: null, pctProj: null };
  }
  // Hay actual en alguna cuenta pero ninguna de las que tienen cuota operó:
  // su avance es 0 (no "sin dato": la cuota existe y no se movió).
  const actualCuota = dec.actual ?? 0;
  const projCuota = todas.proj == null ? null : (dec.proj ?? 0);
  return {
    ...base, meta, actualCuota, projCuota,
    pct: (actualCuota / meta) * 100,
    pctProj: projCuota == null ? null : (projCuota / meta) * 100
  };
}
