// ============================================================
// shared/csv.ts — Celdas CSV seguras (I10)
// ============================================================
// Dos problemas del CSV de Data Raw:
//  1. Se envolvía el texto en comillas SIN duplicar las comillas internas: un
//     partner llamado `TAXI "EL RÁPIDO"` corría todas las columnas siguientes.
//     RFC 4180: un campo con `"`, `,`, CR o LF va entre comillas, y cada `"`
//     interna se duplica.
//  2. Inyección de fórmulas: Excel/Sheets EJECUTAN una celda que empieza con
//     `=`, `+`, `-`, `@` (o tab/CR). Los nombres de partner/KAM vienen de la
//     base y de Excels de terceros. Se neutralizan anteponiendo `'`, que la
//     planilla muestra como texto (recomendación de OWASP).
// Los NÚMEROS no se tocan (un -12 es un número, no una fórmula), y tampoco un
// texto que es un número puro ("-12.5"): no puede ser una fórmula y prefijarlo
// lo convertiría en texto al abrirlo.

const _NUMERO = /^[-+]?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?$/;

export function celdaCSV(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !_NUMERO.test(s.trim())) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function filaCSV(valores: unknown[]): string {
  return valores.map(celdaCSV).join(",");
}
