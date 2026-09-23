// domain/conversionCohorte.ts — Embudo de conversión y adquisición por canal:
// el partner contra el PROMEDIO de su cohorte (Top 5 / Top 10 por Conductores
// Activos). PURO: recibe las filas de `conversion_pais` ya mapeadas (las de
// STATE.conversionData) y devuelve números. Sin STATE ni DOM.
//
// Mudado desde Vista Partner (_pvConvData / _pvChannelData) al retirarla (Ola 6,
// sep-2026): el deck de Presentación es lo que se le entrega al partner, y esta
// es la comparación que Vista Partner ya estaba pensada para mostrarle.
//
// REGLA DE PRIVACIDAD (la razón de ser de este módulo, con tests):
//   · NUNCA se devuelve la conversión ni los canales de un competidor
//     individual: solo el partner elegido y PROMEDIOS de cohorte.
//   · Un promedio de pocos es un dato individual disfrazado: con 2 miembros
//     (el partner + uno más) el partner despeja al otro restando. Por eso un
//     promedio de cohorte con menos de COHORTE_MIN miembros NO se devuelve
//     (null) — Vista Partner no tenía este guard; con los filtros AD/ND por
//     defecto el cohorte es mucho más grande, así que no cambia lo habitual.
//
// Mismas definiciones que Vista Partner (no cambian cifras):
//   · Mes = el más reciente con datos en la tabla.
//   · Pares elegibles = filas de ese mes con AD en [adMin, adMax] y nuevos
//     conductores ≥ ndMin, ordenadas por AD (el partner puede estar adentro).
//   · Cohorte = promedio SIMPLE entre partners (cada uno pesa igual).
//   · Partner, embudo = promedio de sus CLIDs ponderado por nuevos conductores
//     (sin nuevos: promedio simple); canales = SUMA de sus CLIDs.

export interface FiltroCohorte { adMin: number; adMax: number; ndMin: number }
export const FILTRO_DEFECTO: FiltroCohorte = { adMin: 0, adMax: 999999, ndMin: 50 };
export const COHORTE_MIN = 3;

export const EMBUDO_COLS = ["firstOrder", "n5", "n10", "n25", "n50", "n100"] as const;
export type EmbudoCol = typeof EMBUDO_COLS[number];

// Orden = el de la pestaña "Adquisition by channel" del Excel. Los nombres son
// los del reporte de origen y se muestran tal cual (ver presentacion2.ts).
export const CANALES = [
  { key: "agencyScouts",    label: "Agency Scouts" },
  { key: "organicPartner",  label: "Organic Partner" },
  { key: "organicScouts",   label: "Organic Scouts" },
  { key: "organicYango",    label: "Organic Yango" },
  { key: "paidYango",       label: "Paid Yango" },
  { key: "partnerScouts",   label: "Partner Scouts" },
  { key: "referralPartner", label: "Referral Partner" },
  { key: "referralYango",   label: "Referral Yango" }
] as const;

type Fila = Record<string, any>;

function _mesReciente(rows: Fila[]): string | null {
  let m: string | null = null;
  for (const r of rows) if (r && r.mes != null && (m == null || String(r.mes) > m)) m = String(r.mes);
  return m;
}

function _pares(cur: Fila[], F: FiltroCohorte): Fila[] {
  return cur
    .filter(r => (r.activeDrivers || 0) >= F.adMin && (r.activeDrivers || 0) <= F.adMax && (r.newDrivers || 0) >= F.ndMin)
    .slice().sort((a, b) => (b.activeDrivers || 0) - (a.activeDrivers || 0));
}

const _num = (v: unknown): v is number => v != null && !isNaN(v as number);

export interface ResultadoCohorte {
  mes: string | null;
  /** Pares elegibles después de los filtros. */
  nPares: number;
  /** Miembros efectivos de cada cohorte (≤ 5 / ≤ 10). */
  nTop5: number;
  nTop10: number;
  partner: Record<string, number | null>;
  top5: Record<string, number | null> | null;
  top10: Record<string, number | null> | null;
  /** El partner tiene al menos una fila en el mes (aunque sea sin valores). */
  tienePartner: boolean;
  /** El partner tiene al menos UN valor que mostrar. */
  hayDatoPartner: boolean;
}

function _cohorte(miembros: Fila[], cols: readonly string[], prom: (rows: Fila[], k: string) => number | null) {
  if (miembros.length < COHORTE_MIN) return null;
  const o: Record<string, number | null> = {};
  cols.forEach(k => { o[k] = prom(miembros, k); });
  return o;
}

/** Embudo (% que llega a 1er viaje, 5, 10, 25, 50, 100 viajes). */
export function embudoCohorte(rows: Fila[], partner: string, F: FiltroCohorte = FILTRO_DEFECTO): ResultadoCohorte {
  const data = rows || [];
  const mes = _mesReciente(data);
  const cur = data.filter(r => String(r.mes) === mes);
  const pop = _pares(cur, F);
  const prom = (rs: Fila[], k: string) => {
    const v = rs.map(r => r[k]).filter(_num);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  const pRows = cur.filter(r => r.partner === partner);
  const pv: Record<string, number | null> = {};
  EMBUDO_COLS.forEach(k => {
    let num = 0, den = 0, ss = 0, sn = 0;
    pRows.forEach(r => {
      const v = r[k];
      if (_num(v)) { const w = r.newDrivers || 0; num += v * w; den += w; ss += v; sn++; }
    });
    pv[k] = den > 0 ? num / den : (sn > 0 ? ss / sn : null);
  });
  const t5 = pop.slice(0, 5), t10 = pop.slice(0, 10);
  return {
    mes, nPares: pop.length, nTop5: t5.length, nTop10: t10.length,
    partner: pv, top5: _cohorte(t5, EMBUDO_COLS, prom), top10: _cohorte(t10, EMBUDO_COLS, prom),
    tienePartner: pRows.length > 0,
    hayDatoPartner: EMBUDO_COLS.some(k => pv[k] != null)
  };
}

/** Adquisición por canal: conteos de nuevos conductores por canal. */
export function canalCohorte(rows: Fila[], partner: string, F: FiltroCohorte = FILTRO_DEFECTO): ResultadoCohorte & { hayDatoMes: boolean } {
  const data = rows || [];
  const mes = _mesReciente(data);
  const cur = data.filter(r => String(r.mes) === mes);
  const pop = _pares(cur, F);
  const keys = CANALES.map(c => c.key);
  const prom = (rs: Fila[], k: string) => rs.length ? rs.reduce((s, r) => s + (r[k] || 0), 0) / rs.length : null;
  const pRows = cur.filter(r => r.partner === partner);
  const pv: Record<string, number | null> = {};
  keys.forEach(k => { pv[k] = pRows.reduce((s, r) => s + (r[k] || 0), 0); });
  const t5 = pop.slice(0, 5), t10 = pop.slice(0, 10);
  return {
    mes, nPares: pop.length, nTop5: t5.length, nTop10: t10.length,
    partner: pv, top5: _cohorte(t5, keys, prom), top10: _cohorte(t10, keys, prom),
    tienePartner: pRows.length > 0,
    hayDatoPartner: pRows.length > 0 && keys.some(k => (pv[k] || 0) > 0),
    hayDatoMes: cur.some(r => keys.some(k => (r[k] || 0) > 0))
  };
}
