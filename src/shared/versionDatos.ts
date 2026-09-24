// ─────────────────────────────────────────────────────────────────────────────
// Revalidación CONDICIONAL de las tablas grandes (sep-2026, egress).
//
// El problema: cada apertura de la app volvía a bajar la ventana semanal entera
// aunque nada hubiera cambiado (la ingesta es semanal), y la precarga en idle
// bajaba además mensual + diario con sus columnas diferidas. Con el plan
// gratuito de Supabase (5 GB de egress por ciclo) un solo usuario activo gastó
// 0,30 GB el primer día del ciclo.
//
// La idea: antes de re-descargar una tabla grande, preguntar algo BARATO
// ("¿cambió algo desde el snapshot?") y reutilizar las filas del caché local
// (IndexedDB) si la respuesta es no. La pregunta tiene dos partes:
//
//   1. VERSIÓN (RPC `data_version`, migrations/2026-09-24_data_version.sql):
//      por tabla, cuántas filas tiene su historia en `audit_log` y la última
//      fecha — cada INSERT/UPDATE/DELETE real (los no-op no se registran) deja
//      una fila ahí vía trigger, así que el CONTEO es un contador que avanza con
//      cada escritura confirmada, en el orden en que se confirman (a diferencia
//      de max(at), que es la hora de INICIO de la transacción y puede quedar
//      igual si una transacción larga confirma después de otra más corta). Más
//      la última ingesta OK de la escala (`ingest_log`), más `partner_users`
//      (cambia QUÉ filas ve un partner sin tocar la tabla) y el ROL del usuario
//      (lo mismo por otra vía).
//   2. CONTEO (HEAD count=exact sobre el mismo filtro con que se bajó el
//      snapshot): cinturón y tirantes contra una escritura que no pasara por el
//      trigger.
//
// Si CUALQUIERA de las dos no está disponible (RPC inexistente, error de red),
// no se reutiliza nada: se descarga como antes. Así el código puede llegar a
// producción antes que la migración sin cambiar ningún número.
//
// Puro: sin STATE, sin DOM, sin red.
// ─────────────────────────────────────────────────────────────────────────────

/** Respuesta de la RPC `data_version()`. */
export interface VersionDatos {
  /** tabla → [filas en audit_log, última escritura ISO] */
  tablas?: Record<string, [number, string | null]>;
  /** escala → última ingesta OK (ISO) */
  ingesta?: Record<string, string | null>;
}

/** Tabla de rendimiento de cada escala (la que se versiona). */
export const TABLA_DE_ESCALA: Record<string, string> = {
  semanal: "rendimiento",
  mensual: "rendimiento_mensual",
  diario:  "rendimiento_diario"
};

/**
 * Clave de versión de `tabla` para un usuario con `rol`. `escalaIngesta`, si se
 * da, suma la última ingesta OK de esa escala. `null` = no se puede saber (sin
 * RPC o respuesta rara) → NO reutilizar.
 *
 * Una tabla que nunca se escribió (sin filas en audit_log) entra como `null`
 * dentro de la clave: sigue siendo comparable (la primera escritura la cambia).
 */
export function claveVersionTabla(
  dv: VersionDatos | null | undefined, tabla: string, rol: string | null | undefined, escalaIngesta?: string
): string | null {
  if (!tabla || !dv || typeof dv !== "object" || !dv.tablas || typeof dv.tablas !== "object") return null;
  const t = dv.tablas;
  const ing = dv.ingesta && typeof dv.ingesta === "object" ? dv.ingesta : {};
  return JSON.stringify([
    tabla,
    t[tabla] ?? null,
    t.partner_users ?? null,
    escalaIngesta ? (ing[escalaIngesta] ?? null) : null,
    rol || null
  ]);
}

/** Clave de versión de los datos de rendimiento de una escala (ver claveVersionTabla). */
export function claveVersion(dv: VersionDatos | null | undefined, escala: string, rol: string | null | undefined): string | null {
  const tabla = TABLA_DE_ESCALA[escala];
  return tabla ? claveVersionTabla(dv, tabla, rol, escala) : null;
}

/** Lo que se guarda junto a las filas de una escala para poder reutilizarlas. */
export interface SnapshotReusable<F> {
  /** Filas crudas, TAL CUAL las devolvió la consulta `col >= desde` (orden incluido). */
  rows: F[];
  /** Clave de versión leída ANTES de pedir esas filas (ver claveVersion). */
  ver: string | null | undefined;
  /** Cota inferior con que se pidieron (`null` = la tabla entera). */
  desde: string | null | undefined;
}

/**
 * ¿Se pueden reutilizar las filas del snapshot en vez de descargarlas?
 * Devuelve las filas a usar (recortadas a la ventana de HOY) o `null` si hay
 * que ir a la red.
 *
 * - `verActual`: clave de versión recién leída. Tiene que ser IGUAL a la del
 *   snapshot (y no nula).
 * - `desdeActual`: cota inferior que pediría hoy la carga normal (`null` = toda
 *   la tabla). El snapshot tiene que CUBRIRLA: haberse pedido desde esa fecha o
 *   antes. Si la ventana avanzó (semana/mes/día nuevo), se descartan las filas
 *   que quedaron afuera — mismo resultado que la consulta `col >= desdeActual`.
 * - `conteo`: filas que hay HOY en la tabla con `col >= snapshot.desde` (HEAD
 *   count=exact). Tiene que coincidir con las del snapshot. `null` = no se pudo
 *   contar → no reutilizar.
 *
 * Las fechas son strings ISO ("2026-09-14") o "YYYY-MM"; se comparan como
 * strings, igual que en la consulta (mismo formato, mismo largo).
 */
export function reusarFilas<F extends Record<string, any>>(
  snap: SnapshotReusable<F> | null | undefined,
  verActual: string | null | undefined,
  desdeActual: string | null | undefined,
  col: string,
  conteo: number | null | undefined
): F[] | null {
  if (!snap || !Array.isArray(snap.rows)) return null;
  if (!verActual || !snap.ver || snap.ver !== verActual) return null;
  if (conteo == null || !Number.isFinite(conteo) || conteo !== snap.rows.length) return null;
  const desdeSnap = snap.desde || null;
  const desdeHoy = desdeActual || null;
  // El snapshot tiene que cubrir la ventana de hoy.
  if (desdeSnap !== null && (desdeHoy === null || desdeSnap > desdeHoy)) return null;
  if (desdeHoy === null || desdeHoy === desdeSnap) return snap.rows;
  return snap.rows.filter(r => r[col] != null && String(r[col]) >= desdeHoy);
}
