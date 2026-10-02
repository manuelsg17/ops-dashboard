// shared/lecturaPartner.ts — Cómo lee el ROL PARTNER las tablas de rendimiento (2-oct-2026).
//
// Desde la migración 2026-10-02_portal_partner_columnas.sql el partner YA NO puede
// leer rendimiento / _mensual / _diario directo: lee por las funciones
// portal_rendimiento*() (solo sus CLIDs, sin columnas internas). PostgREST las
// expone como /rest/v1/rpc/portal_rendimiento con los mismos filtros, orden,
// paginación y conteo que una tabla, así que fetchAllPages no cambia: solo se
// traduce el nombre y la lista de columnas.
//
// Dos detalles de PostgREST 14 que esto resuelve:
//   - Una columna que la función no devuelve hace fallar TODA la consulta (42703),
//     por eso se sacan de la lista las ocultas.
//   - Para ordenar el resultado de una función, las columnas del ORDER BY tienen
//     que estar en el select: la app ordena por fecha + id, así que se agrega `id`.

/** Columnas que el partner NO recibe (decisión de Manuel + internas de Yango). */
export const COLUMNAS_OCULTAS_PARTNER = [
  "kam", "created_at",
  "trips_share", "supply_hours_share", "commission_share",   // participación de mercado
  "driver_subsidies_by_gmv",                                  // subsidios
  "fraud_trips_share"                                         // fraude
];
const TABLAS = new Set(["rendimiento", "rendimiento_mensual", "rendimiento_diario"]);

/** Tabla y columnas a pedir. Para quien no es partner (o para otra tabla), sin cambios. */
export function lecturaPartner(tabla: string, cols: string, esPartner: boolean): { tabla: string; cols: string } {
  if (!esPartner || !TABLAS.has(tabla)) return { tabla, cols };
  const ocultas = new Set(COLUMNAS_OCULTAS_PARTNER);
  if (cols === "*" || !cols) return { tabla: "rpc/portal_" + tabla, cols: "*" };
  const lista = cols.split(",").map(c => c.trim()).filter(c => c && !ocultas.has(c));
  if (!lista.includes("id")) lista.push("id");
  return { tabla: "rpc/portal_" + tabla, cols: lista.join(",") };
}
