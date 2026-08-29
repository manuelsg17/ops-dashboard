// domain/metrics.ts — Núcleo de cálculo del dashboard. PURO y testeable.
//
// POR QUÉ EXISTE: la misma métrica se calculaba en tres archivos distintos
// (metas.ts, rendimiento.ts, presentacion2.ts), cada uno con su propia versión
// de "qué es un snapshot", "qué se acumula" y "cómo se proyecta". Mientras
// coincidieran, nadie lo notaba; cuando divergieran, el partner vería un número
// en Metas y otro distinto en su presentación. Este módulo es la definición
// única de esas reglas.
//
// REGLAS DE ESTE ARCHIVO (no negociables, es lo que lo hace testeable):
//   - NO lee STATE. NO toca el DOM. NO importa nada de la app.
//   - Todo entra por parámetros y sale por el return.
//   - Cada función tiene su test en metrics.test.ts.
//
// ── VOCABULARIO ─────────────────────────────────────────────────────────────
// SNAPSHOT  → métrica de NIVEL: cuántos hay AHORA (Active Drivers, autos
//             brandeados, autos propios). NO se suman entre períodos: tener
//             100 conductores activos 4 semanas seguidas es 100, no 400. El
//             valor del rango es el del ÚLTIMO período.
// FLUJO     → métrica de VOLUMEN: cuánto ocurrió (Nuevos+Reactivados, horas de
//             conexión, viajes, comisión). SÍ se acumulan a lo largo del rango.
// PONDERADO → tasa que se promedia pesada por su denominador real (aceptación
//             pesada por viajes, SH/auto = Σ horas / Σ autos). Promediar tasas
//             a secas da un número que no significa nada.

export type Serie = number[];

// ── Snapshots y flujos ──────────────────────────────────────────────────────

/** Valor de una métrica SNAPSHOT en el rango: el del último período con dato. */
export function snapshotValue(serie: Serie): number {
  for (let i = serie.length - 1; i >= 0; i--) {
    const v = serie[i];
    if (v != null && !isNaN(v)) return v;
  }
  return 0;
}

/** Valor de una métrica FLUJO en el rango: la suma. */
export function flowValue(serie: Serie): number {
  let s = 0;
  for (const v of serie) if (v != null && !isNaN(v)) s += v;
  return s;
}

// ── Proyecciones ────────────────────────────────────────────────────────────

// Proyección de Active Drivers: PLANA (= último período con dato).
//
// Historia de la regla, para que nadie la "mejore" de memoria:
// - jul 2026: Manuel pidió máx del rango × 1.4 (AD_PROJECTION_FACTOR).
// - ago 2026: se BACKTESTEÓ contra la serie real de producción (ene–ago 2026,
//   Perú total y top-8 partners, 64 casos partner-mes): el ×1.4 sobreestimaba
//   ~46% en promedio, TODOS los meses, sin excepción — la cartera es plana o
//   declina suave y "el pico visto × 1.4" nunca ocurre. La proyección plana
//   erró 3.4% (país) / 4.8% (partner), la mejor de los 4 métodos probados.
//   Manuel decidió volver a plana con esos números a la vista.
// El factor queda exportado por compatibilidad y para quien quiera dibujar una
// línea de "potencial" (aspiracional, no proyección).
export const AD_PROJECTION_FACTOR = 1.4;

/**
 * Proyección de una métrica SNAPSHOT (Active Drivers y equivalentes):
 * PLANA — el cierre estimado del mes es el nivel actual (último período con
 * dato). Sobre una serie agregada, el último período agregado.
 */
export function projectSnapshot(serie: Serie): number {
  for (let i = serie.length - 1; i >= 0; i--) {
    const v = serie[i];
    if (v != null && !isNaN(v)) return v;
  }
  return 0;
}

/**
 * Proyección de una métrica FLUJO al cierre del mes, por ritmo lineal:
 * "si en `daysElapsed` días acumulé `total`, al cierre acumularé
 * total × diasDelMes / daysElapsed".
 *
 * Si el mes ya está completo (daysRemaining = 0) devuelve el total tal cual:
 * proyectar un período cerrado sería inventar.
 */
export function projectFlow(total: number, daysElapsed: number, daysRemaining: number): number {
  if (!total) return 0;
  if (daysRemaining <= 0 || daysElapsed <= 0) return total;
  return (total * (daysElapsed + daysRemaining)) / daysElapsed;
}

// ── Tasas ponderadas ────────────────────────────────────────────────────────

/**
 * Promedio ponderado. Devuelve 0 si el peso total es 0 — NUNCA NaN: un NaN se
 * propaga en silencio por las sumas y termina como "—" en pantalla sin que
 * nadie sepa de dónde salió.
 */
export function weightedAvg(pairs: Array<[value: number, weight: number]>): number {
  let num = 0, den = 0;
  for (const [v, w] of pairs) {
    if (v == null || w == null || isNaN(v) || isNaN(w)) continue;
    num += v * w;
    den += w;
  }
  return den > 0 ? num / den : 0;
}

/** Ratio seguro: 0 si el denominador es 0. */
export function ratio(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

/** % de cumplimiento. Meta 0/ausente → 0 (no Infinity, no NaN). */
export function attainmentPct(actual: number, meta: number): number {
  if (!meta || meta <= 0) return 0;
  return (actual / meta) * 100;
}

// ── Retención ───────────────────────────────────────────────────────────────

/**
 * Serie de retención período a período:
 *
 *     retención[i] = (AD[i] − nuevos[i] − reactivados[i]) / AD[i−1]
 *
 * Léase: "de los conductores que tenía el período pasado, qué fracción sigue
 * activa" — al AD de hoy se le descuenta todo lo que entró en el período, y lo
 * que queda se compara contra la base anterior.
 *
 * Devuelve `null` (no 0) en el primer período y cuando el AD anterior es 0: sin
 * base previa la retención no está definida, y un 0 se promediaría después como
 * si fuera "perdimos a todos".
 *
 * Puede dar negativo si entraron más conductores de los que hay activos hoy
 * (churn muy alto). Es un número real y se muestra tal cual — recortarlo a 0
 * escondería justo el caso que hay que mirar.
 */
export function retentionSeries(ad: Serie, nuevos: Serie, react: Serie): Array<number | null> {
  return ad.map((_, i) => {
    if (i === 0) return null;
    const prev = ad[i - 1];
    if (!prev) return null;
    // Un hueco en el AD ACTUAL (no el previo, ya cubierto arriba) no es "cero
    // conductores" — es que ese período no tiene dato. `(ad[i] || 0)` lo
    // trataba como 0 y fabricaba una retención muy negativa (churn severo
    // falso) por un dato faltante, no por una caída real.
    const cur = ad[i];
    if (cur == null || Number.isNaN(cur)) return null;
    return (cur - (nuevos[i] || 0) - (react[i] || 0)) / prev;
  });
}

// ── Rollups ─────────────────────────────────────────────────────────────────

export interface LineKpis {
  /** Métricas de nivel: se toma el último período. */
  ad: number;
  /** Métricas de volumen: se acumulan. */
  nr: number;
  sh: number;
  /** Proyecciones al cierre del mes. */
  projAd: number;
  projNr: number;
  projSh: number;
}

/**
 * Suma las KPIs de varias unidades (partner-ciudad) en un total de ciudad, KAM
 * o país.
 *
 * OJO con `ad`: sumar snapshots de unidades DISTINTAS sí es correcto (los
 * conductores activos de Lima más los de Arequipa son conductores distintos);
 * lo que nunca hay que sumar es el mismo snapshot a lo largo del TIEMPO. Esa
 * distinción es la que se equivoca sola si cada vista la reimplementa, y es
 * exactamente la razón por la que este rollup vive acá.
 */
export function sumKpis(items: LineKpis[]): LineKpis {
  const out: LineKpis = { ad: 0, nr: 0, sh: 0, projAd: 0, projNr: 0, projSh: 0 };
  for (const it of items) {
    if (!it) continue;
    out.ad     += it.ad     || 0;
    out.nr     += it.nr     || 0;
    out.sh     += it.sh     || 0;
    out.projAd += it.projAd || 0;
    out.projNr += it.projNr || 0;
    out.projSh += it.projSh || 0;
  }
  return out;
}

/**
 * Agrupa un Map de unidades por una clave derivada (ciudad, KAM, …) y suma sus
 * KPIs. `keyOf` recibe la clave original del Map y su valor.
 */
export function groupSum<T>(
  units: Map<string, T>,
  keyOf: (key: string, val: T) => string | null,
  toKpis: (val: T) => LineKpis
): Map<string, LineKpis> {
  const out = new Map<string, LineKpis>();
  units.forEach((val, key) => {
    const g = keyOf(key, val);
    if (g == null) return;
    const acc = out.get(g);
    const k = toKpis(val);
    out.set(g, acc ? sumKpis([acc, k]) : sumKpis([k]));
  });
  return out;
}

/**
 * Serie por período a partir de un mapa fecha→valor. Devuelve los valores
 * ordenados por fecha ascendente — el orden importa para snapshotValue (que
 * toma el último) y es un error fácil de cometer al iterar un objeto.
 */
export function seriesByDate(byDate: Record<string, number>): Serie {
  return Object.keys(byDate).sort().map(d => byDate[d]);
}
