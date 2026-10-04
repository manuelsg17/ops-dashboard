// domain/erroresAdmin.ts — Errores de la Edge Function `admin-users`, en el idioma
// de la UI (3-oct-2026).
//
// La función (supabase/functions/admin-users) responde `{ error: "…" }` con
// textos fijos en español, y el panel de Usuarios los mostraba tal cual: en
// inglés o ruso salían en español. Se traducen ACÁ, al mostrarlos, para no tener
// que redesplegar la función. Si la función cambia un texto, el mensaje se ve
// como venga (en español), nunca se pierde. Puro: recibe `t` para poder testearse.

type Traductor = (clave: string, vars?: Record<string, string | number>) => string;

const _EXACTOS: Array<[RegExp, string]> = [
  [/^No autenticado\.?$/, "au.err.noAutenticado"],
  [/^Requiere rol admin\.?$/, "au.err.requiereAdmin"],
  [/^Falta email\.?$/, "au.err.faltaEmail"],
  [/^Falta userId\.?$/, "au.err.faltaUsuario"],
  [/^No puedes quitarte tu propio rol admin\.?$/, "au.err.propioAdmin"],
  [/^KAM inválido: máximo 60 caracteres\.?$/, "au.err.kamLargo"],
  [/^KAM inválido\.?$/, "au.err.kamInvalido"],
  [/^No puedes eliminar tu propia cuenta\.?$/, "au.err.propiaCuenta"],
  [/^Es el último administrador: no se puede eliminar\.?$/, "au.err.ultimoAdmin"],
  [/^Error interno\.?$/, "au.err.interno"],
  // De Supabase Auth, pasa tal cual por el catch de la función (500).
  [/already (been )?registered|already exists/i, "au.err.emailExiste"]
];
const _CON_DATO: Array<[RegExp, string, string]> = [
  [/^Rol inválido:\s*(.*)$/, "au.err.rolInvalido", "r"],
  [/^Acción desconocida:\s*(.*)$/, "au.err.accionDesconocida", "a"]
];

/** Traduce un mensaje conocido de `admin-users`; si no lo conoce, lo devuelve igual. */
export function traducirErrorAdmin(msg: string, t: Traductor): string {
  const m = String(msg || "").trim();
  for (const [re, k] of _EXACTOS) if (re.test(m)) return t(k);
  for (const [re, k, v] of _CON_DATO) {
    const x = m.match(re);
    if (x) return t(k, { [v]: x[1] });
  }
  return msg;
}
