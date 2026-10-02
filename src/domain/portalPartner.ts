// domain/portalPartner.ts — Reglas puras del portal del partner (2-oct-2026).
// Sin STATE ni DOM: los mapas de fleetrooms se pasan como argumento.

export type TipoSub = "fleet" | "tuktuk" | "delivery" | "cargo" | "otra" | "taxi";
export interface MapasFleetroom {
  FLEETROOM_NAME?: Record<string, string>;
  FLEETROOM_IS_FLEET?: Record<string, boolean>;
  FLEETROOM_IS_TUKTUK?: Record<string, boolean>;
  FLEETROOM_IS_DELIVERY?: Record<string, boolean>;
  FLEETROOM_IS_CARGO?: Record<string, boolean>;
  FLEETROOM_EXCLUDE_TAXI?: Record<string, boolean>;
}

/** Tipo de una subflota según su clasificación. Delivery/Cargo primero: no suman al total. */
export function tipoSubflota(dbId: string | null | undefined, m: MapasFleetroom): TipoSub {
  const id = dbId || "";
  if (m.FLEETROOM_IS_DELIVERY?.[id]) return "delivery";
  if (m.FLEETROOM_IS_CARGO?.[id]) return "cargo";
  if (m.FLEETROOM_EXCLUDE_TAXI?.[id]) return "otra";
  if (m.FLEETROOM_IS_TUKTUK?.[id]) return "tuktuk";
  if (m.FLEETROOM_IS_FLEET?.[id]) return "fleet";
  return "taxi";
}

export interface Subflota { id: string; nombre: string; ciudad: string; tipo: TipoSub; enTotal: boolean; ad: number }
interface FilaSub { db_id?: string | null; fleetroom?: string | null; city?: string; date?: string; activeDrivers?: number | null }

/**
 * Subflotas presentes en `rows`, ordenadas: primero las que suman al total
 * (Combinado = Taxi + TukTuk, mayor a menor por conductores del último período),
 * después Delivery/Cargo/excluidas. Filas sin db_id se agrupan como una sola.
 */
export function subflotasDe(rows: FilaSub[], m: MapasFleetroom): Subflota[] {
  const ult = rows.reduce((u, r) => (r.date && r.date > u ? r.date : u), "");
  const por = new Map<string, Subflota>();
  for (const r of rows) {
    const id = r.db_id || "";
    let s = por.get(id);
    if (!s) {
      const tipo = tipoSubflota(id, m);
      s = { id, nombre: m.FLEETROOM_NAME?.[id] || r.fleetroom || id || "—", ciudad: r.city || "", tipo,
            enTotal: tipo !== "delivery" && tipo !== "cargo" && tipo !== "otra", ad: 0 };
      por.set(id, s);
    }
    if (r.date === ult) s.ad += r.activeDrivers || 0;
  }
  return [...por.values()].sort((a, b) => Number(b.enTotal) - Number(a.enTotal) || b.ad - a.ad || a.nombre.localeCompare(b.nombre));
}

/**
 * Veredicto contra el mercado: "mejor" fuera del rango típico hacia el lado
 * bueno, "peor" hacia el malo, "normal" dentro. Sin rango típico (pocos
 * partners) o sin valor propio, "normal": nunca se afirma algo sin base.
 */
export function veredictoMercado(tu: number | null | undefined, p25: number | null | undefined, p75: number | null | undefined, menosEsMejor = false): "mejor" | "peor" | "normal" {
  if (tu == null || p25 == null || p75 == null) return "normal";
  if (menosEsMejor) return tu < p25 ? "mejor" : tu > p75 ? "peor" : "normal";
  return tu > p75 ? "mejor" : tu < p25 ? "peor" : "normal";
}
