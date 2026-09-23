// ============================================================
// domain/erroresSubida.ts — Clasificación de errores de carga de Excel (B2)
// ============================================================
// Antes `describeUploadError` clasificaba BUSCANDO TEXTO en el mensaje
// ("duplicate", "unico", "violates"…): se rompía con cualquier cambio de idioma
// o de redacción de Postgres/PostgREST, y encima había quedado sin llamar desde
// la migración al Web Worker (todo error salía como "Error: <mensaje crudo>").
//
// Ahora se clasifica por CÓDIGO: el `code` SQLSTATE/PostgREST que devuelve
// supabase-js, o el `codigo` de un ErrorSubida lanzado por nuestro propio
// parser. El único caso que sigue mirando el mensaje es la caída de red: el
// navegador la entrega como un TypeError sin ningún código.

import { t } from "../core/i18n";

export type CodigoErrorSubida =
  | "cancelado"    // el usuario canceló una confirmación: no se escribió nada
  | "validacion"   // el archivo no pasó nuestras validaciones (mensaje propio)
  | "permiso"      // RLS / rol sin permiso de escritura (42501)
  | "auth"         // JWT vencido o inválido
  | "red"          // sin conexión
  | "conflicto"    // claves repetidas (23505 / 21000)
  | "formato"      // tipo/valor/columna inválidos para la tabla
  | "esquema"      // la base no tiene la estructura que espera el código (42P10…)
  | "desconocido";

/** Error lanzado por nuestro propio código de carga, con código explícito. */
export class ErrorSubida extends Error {
  codigo: CodigoErrorSubida;
  constructor(codigo: CodigoErrorSubida, mensaje: string) {
    super(mensaje);
    this.name = "ErrorSubida";
    this.codigo = codigo;
  }
}

const _PG: Record<string, CodigoErrorSubida> = {
  "42501": "permiso",
  "23505": "conflicto",   // unique_violation
  "21000": "conflicto",   // ON CONFLICT DO UPDATE ... cannot affect row a second time
  "23502": "formato",     // not_null_violation
  "23514": "formato",     // check_violation
  "22P02": "formato",     // invalid_text_representation
  "22003": "formato",     // numeric_value_out_of_range
  "22007": "formato",     // invalid_datetime_format
  "22008": "formato",     // datetime_field_overflow
  "42703": "formato",     // undefined_column (columna del archivo que la tabla no tiene)
  "PGRST204": "formato",  // columna inexistente según el schema cache de PostgREST
  "42P10": "esquema",     // no hay UNIQUE que matchee el onConflict
  "42P01": "esquema",     // tabla inexistente
  "PGRST205": "esquema",  // tabla inexistente según el schema cache
  "PGRST301": "auth",     // JWT inválido/vencido
  "PGRST302": "auth",
  "PGRST303": "auth"
};

export function clasificarErrorSubida(err: unknown): CodigoErrorSubida {
  const e = (err || {}) as { codigo?: string; code?: string; status?: number; name?: string; message?: string };
  if (e.codigo) return e.codigo as CodigoErrorSubida;
  const code = e.code != null ? String(e.code) : "";
  if (code && _PG[code]) return _PG[code];
  if (e.status === 401) return "auth";
  if (e.status === 403) return "permiso";
  // Caída de red: el navegador no da código, solo un TypeError de fetch.
  if (e.name === "TypeError" && /fetch|network|load failed/i.test(e.message || "")) return "red";
  // Un Error propio sin código (validaciones viejas de los uploads: "No se
  // encontraron filas válidas…") ya trae un mensaje pensado para el usuario.
  if (!code && e.name === "Error" && e.message) return "validacion";
  return "desconocido";
}

// Nombre visible de cada tipo de carga (en el idioma de la interfaz).
const _TIPO_KEY: Record<string, string> = {
  rendimiento: "subida.tipo.rendimiento", rendimientoMensual: "subida.tipo.rendimientoMensual",
  rendimientoDiario: "subida.tipo.rendimientoDiario", conversion: "subida.tipo.conversion",
  metas: "subida.tipo.metas", data: "subida.tipo.data", flotas: "subida.tipo.flotas"
};
export function etiquetaTipoSubida(tipo: string): string {
  return _TIPO_KEY[tipo] ? t(_TIPO_KEY[tipo]) : tipo;
}

/** Mensaje para el usuario. `tipo` es el tipo de carga de handleFile. Los textos
 *  viven en core/i18n (subida.err.*); la CLASIFICACIÓN sigue siendo por código. */
export function describirErrorSubida(tipo: string, err: unknown): string {
  const e = (err || {}) as { message?: string; details?: string };
  const base = e.message || t("subida.err.sinDetalle");
  const lbl = etiquetaTipoSubida(tipo);
  const codigo = clasificarErrorSubida(err);
  if (codigo === "validacion") return `${lbl}: ${base}`;
  const k = codigo === "desconocido" ? "subida.err.desconocido" : `subida.err.${codigo}`;
  return t(k, { lbl, base });
}
