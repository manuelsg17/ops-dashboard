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

// Factor de proyección de Active Drivers — regla de NEGOCIO de Manuel.
//
// Historia (29-ago-2026, no repetirla): se backtesteó contra producción
// (ene–ago 2026, Perú + top-8 partners): como PRONÓSTICO el ×1.4 sobrestima
// ~46% (la cartera es plana/declive); la plana erró 3.4% y la tendencia 4.2%.
// Se probaron ambas EN el producto y las dos se pegan al avance en una cartera
// plana — "no veo la proyección". Manuel decidió, con esos números a la vista,
// restaurar el ×1.4: se lee como POTENCIAL visible, no como estimación fina.
export const AD_PROJECTION_FACTOR = 1.4;

/**
 * Proyección de una métrica SNAPSHOT (Active Drivers y equivalentes):
 * máximo del rango × AD_PROJECTION_FACTOR — la regla original de Manuel,
 * RESTAURADA el 29-ago-2026 (3ra vuelta) por decisión suya explícita y con
 * el backtest a la vista.
 *
 * Historia completa del día, para no repetirla: plana (la más precisa, 3.4%,
 * pero proyección == avance y "no se veía") → tendencia (4.2%, pero con una
 * cartera plana se pega al avance igual) → ×1.4 de nuevo. El ×1.4 sobrestima
 * ~46% como PRONÓSTICO (ver backtest arriba), así que hay que leerlo como
 * POTENCIAL/ambición, no como estimación del cierre — Manuel lo prefiere
 * porque siempre dibuja una proyección visible y separada del avance.
 *
 * `periodsRemaining` se acepta y se ignora: el plumbing de fechas de los call
 * sites (projAD(serie, lastDate)) queda listo por si la regla vuelve a una
 * basada en calendario.
 *
 * Al agregar niveles NO se suman proyecciones: se proyecta la serie agregada
 * (los máximos por ciudad caen en semanas distintas — caso Lizzo jul 2026).
 */
export function projectSnapshot(serie: Serie, _periodsRemaining: number = 0): number {
  let max = 0;
  for (const v of serie) if (v != null && !isNaN(v) && v > max) max = v;
  return max * AD_PROJECTION_FACTOR;
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

// ── Criterios TukTuk (ago 2026) ─────────────────────────────────────────────
// Reemplazan a las metas TukTuk de AD/N+R/SH, que quedaron obsoletas: ahora
// TukTuk se evalua con DOS criterios del mes (decision de Manuel):
//   1. Horas por conductor BASE >= 24h
//   2. Meta de nuevos (N+R) que el KAM comunica a inicio de mes
export const TK_HORAS_BASE_MIN = 24;   // umbral del criterio 1
export const TK_MIN_ACTIVOS    = 50;   // abajo de esto el ratio no es representativo

/**
 * Horas de conexion por conductor BASE = SH / (activos - nuevos - reactivados).
 *
 * El denominador son los conductores que YA estaban, no los que entraron este
 * mes — por eso se restan nuevos y reactivados. NO es SH/activos: con la
 * division por activos PIAGGIO daba 20,9h (incumplia) y por base da 43,7h
 * (cumple), asi que la eleccion decide el veredicto y esta fijada aca.
 *
 * Devuelve un ESTADO, no solo un numero, porque hay dos formas legitimas de no
 * poder medir y ninguna significa "incumple":
 *   - `pocos_activos`: menos de TK_MIN_ACTIVOS → la muestra es muy chica y el
 *     ratio se dispara; el criterio no aplica.
 *   - `sin_base`: todos los activos son nuevos/reactivados (base <= 0) → no hay
 *     conductores base sobre los cuales promediar.
 * Ojo con la escala: hay que alimentarlo con datos MENSUALES. En semanal el AD
 * es un snapshot y N+R acumula, asi que la base se va a negativo (verificado
 * contra produccion: YevoGo -6, PIAGGIO -65).
 */
export function horasPorConductorBase(sh: number, ad: number, nuevos: number, reactivados: number) {
  const activos = ad || 0;
  const base = activos - (nuevos || 0) - (reactivados || 0);
  if (activos < TK_MIN_ACTIVOS) return { valor: null, base, estado: "pocos_activos" as const };
  if (base <= 0)                return { valor: null, base, estado: "sin_base" as const };
  const valor = (sh || 0) / base;
  return { valor, base, estado: (valor >= TK_HORAS_BASE_MIN ? "cumple" : "no_cumple") as "cumple" | "no_cumple" };
}

// ── Ritmo del mes (pacing) ──────────────────────────────────────────────────

/**
 * Compara cuanto del mes transcurrio contra cuanto de la meta se lleva.
 *
 * SOLO tiene sentido para FLUJOS (N+R, horas, viajes): son los que se acumulan,
 * asi que "a mitad de mes deberia llevar la mitad" es una lectura valida.
 * Para un SNAPSHOT (Active Drivers) NO aplica: el AD no se acumula, es un
 * nivel — estar al 60% del mes no significa que el AD deba estar al 60% de la
 * meta, ya deberia estar cerca de su valor final. Pasarle un snapshot da un
 * "atraso" que no existe.
 *
 * `ritmo` = puntos porcentuales de adelanto (+) o atraso (-) contra el
 * calendario. El umbral de +-5pp evita que un ruido de un dia se lea como
 * problema.
 */
export function pacingFlujo(actual: number, meta: number, daysElapsed: number, daysInMonth: number) {
  if (!meta || meta <= 0 || !daysInMonth) {
    return { pctMeta: null, pctMes: null, ritmo: null, estado: "sin_meta" as const };
  }
  const pctMeta = (actual / meta) * 100;
  const pctMes  = Math.min((daysElapsed / daysInMonth) * 100, 100);
  const ritmo   = pctMeta - pctMes;
  const estado  = ritmo >= 5 ? "adelantado" : ritmo <= -5 ? "atrasado" : "en_ritmo";
  return { pctMeta, pctMes, ritmo, estado: estado as "adelantado" | "atrasado" | "en_ritmo" };
}

/** Mediana. Devuelve null con lista vacia — NO 0, que se leeria como un valor real. */
export function median(nums: Array<number | null | undefined>): number | null {
  const v = nums.filter((n): n is number => n != null && !isNaN(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// ── Períodos duplicados (ago 2026) ──────────────────────────────────────────
/**
 * Descarta un período cuyo conjunto de filas es IDÉNTICO al de otro período
 * bajo otra fecha. Es el mismo dato cargado dos veces con dos etiquetas.
 *
 * Caso real que lo motivó: `dashboard-ops-cron` escribió el 2026-09-03 tres
 * períodos con la fecha MAL (martes 04, 11 y 18 de agosto, contra 43 lunes
 * desde nov-2025). Cada uno llevaba los datos del lunes 6 días posterior: AD y
 * viajes idénticos fila por fila (232/232), horas apenas distintas por
 * acumulación tardía. Consecuencia: los FLUJOS (N+R, horas, viajes) se
 * contaban DOS VECES en cualquier rango que abarcara el par — YEGO mostraba
 * N+R al 178% y horas al 150% de su meta. El snapshot (AD) no se inflaba
 * porque toma el último período, y por eso el error pasaba inadvertido.
 *
 * ALCANCE: atrapa el re-envío limpio del mismo período. Si el proveedor
 * además CAMBIÓ los valores entre una bajada y otra (pasó con el par
 * 08-18/08-24: solo 152 de 227 filas con el mismo AD), la firma ya no coincide
 * y esto no lo ve — eso hay que arreglarlo en el origen, no acá.
 *
 * Qué copia se conserva: la del DÍA DE SEMANA DOMINANTE del dataset. En una
 * serie semanal el período tiene un ancla fija (acá, lunes); la fecha fuera de
 * ese ancla es la espuria. Quedarse con "la más reciente" habría conservado
 * justamente la mala.
 *
 * NO es destructivo: filtra en memoria al cargar, la BD queda intacta. Solo
 * actúa ante una coincidencia EXACTA, así que no puede descartar un período
 * legítimo que apenas se parezca a otro.
 */
export function dropDuplicatePeriods(rows) {
  const porFecha = new Map();
  for (const r of (rows || [])) {
    const d = r.date;
    if (!d) continue;
    let a = porFecha.get(d);
    if (!a) { a = []; porFecha.set(d, a); }
    a.push(r);
  }
  if (porFecha.size < 2) return rows || [];

  // La firma NO incluye supply_hours A PROPOSITO. Verificado contra produccion:
  // cuando el mismo periodo se vuelve a bajar dias despues, AD y viajes salen
  // identicos (232/232) pero las HORAS difieren por acumulacion tardia — el
  // proveedor sigue sumando horas de esa semana. Incluirlas hacia que la firma
  // no coincidiera y el duplicado pasara igual.
  // AD + viajes identicos en las ~230 filas de un periodo es firma suficiente:
  // dos semanas realmente distintas no coinciden asi por azar.
  const firma = (arr) => arr
    .map(r => `${r.clid}|${r.city}|${r.db_id || ""}|${r.activeDrivers}|${r.trips}`)
    .sort().join("\n");

  // Día de semana dominante (el ancla del período).
  const cuentaDow = {};
  for (const d of porFecha.keys()) {
    const dow = new Date(d + "T00:00:00").getDay();
    cuentaDow[dow] = (cuentaDow[dow] || 0) + 1;
  }
  const dowDominante = +Object.keys(cuentaDow).sort((a, b) => cuentaDow[b] - cuentaDow[a])[0];

  const porFirma = new Map();
  for (const [d, arr] of porFecha) {
    const f = firma(arr);
    let g = porFirma.get(f);
    if (!g) { g = []; porFirma.set(f, g); }
    g.push(d);
  }

  const descartar = new Set();
  for (const fechas of porFirma.values()) {
    if (fechas.length < 2) continue;
    const enAncla = fechas.filter(d => new Date(d + "T00:00:00").getDay() === dowDominante);
    const conservar = enAncla.length ? enAncla.sort().slice(-1)[0] : fechas.sort().slice(-1)[0];
    fechas.forEach(d => { if (d !== conservar) descartar.add(d); });
  }
  if (!descartar.size) return rows;
  return rows.filter(r => !descartar.has(r.date));
}

/**
 * Fechas de un periodo (p. ej. el mes de la meta) acotadas al RANGO que el
 * usuario filtro. Si el rango viene vacio, no recorta.
 *
 * Existe porque el deck tenia dos fuentes de fechas en conflicto: los slides
 * recibian el rango filtrado, pero el Ejecutivo y el Resumen usaban el mes
 * entero e ignoraban el "Desde". Con el filtro en una sola semana, Metas
 * mostraba N+R 276 y el deck 1.187 para el MISMO partner.
 *
 * Conserva el ORDEN del periodo (no el del rango) y no inventa fechas que no
 * esten en ambos: es una interseccion, no una union.
 */
export function fechasEnRango(delPeriodo, rango) {
  if (!rango || !rango.length) return delPeriodo || [];
  const set = new Set(rango);
  return (delPeriodo || []).filter(d => set.has(d));
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
