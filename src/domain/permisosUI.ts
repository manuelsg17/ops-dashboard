// ============================================================
// domain/permisosUI.ts — Qué controles de escritura mostrar (I3)
// ============================================================
// ESPEJO de las políticas RLS (supabase/migrations/00000000000000_baseline.sql).
// No es seguridad —eso lo hace RLS en el servidor—: sirve para NO ofrecerle a
// alguien un botón que la base le va a rechazar. Antes el CRUD de Partners y la
// edición de Flotas se mostraban a cualquier rol, y como un UPDATE/DELETE
// bloqueado por RLS no da error (afecta 0 filas), la pantalla decía "guardado".
//
// Si cambia una política, cambiar acá también (y su test).

export type AccionUI =
  | "partners.escribir"   // INSERT/UPDATE partners: kam|admin o write:config
  | "partners.borrar"     // DELETE partners: solo admin
  | "flotas.escribir"     // INSERT/UPDATE flotas: kam|admin o write:config (un viewer NO)
  | "fleetrooms.escribir" // INSERT/UPDATE fleetrooms: admin o write:config (un kam NO)
  | "datos.borrar";       // DELETE rendimiento*/metas: admin o delete:data

export interface SesionUI { rol: string | null | undefined; perms?: Iterable<string> | null }

export function puede(accion: AccionUI, s: SesionUI): boolean {
  const rol = s.rol || "";
  if (rol === "partner") return false;   // un partner nunca escribe (RLS igual lo rechaza)
  const perms = new Set(s.perms ? [...s.perms] : []);
  const admin = rol === "admin";
  const kamOAdmin = admin || rol === "kam";
  switch (accion) {
    case "partners.escribir":   return kamOAdmin || perms.has("write:config");
    case "partners.borrar":     return admin;
    case "flotas.escribir":     return kamOAdmin || perms.has("write:config");
    case "fleetrooms.escribir": return admin || perms.has("write:config");
    case "datos.borrar":        return admin || perms.has("delete:data");
    default:                    return false;
  }
}

/** Mensaje cuando la base aceptó la orden pero no tocó ninguna fila: con RLS,
 *  un UPDATE/DELETE sin permiso NO da error, afecta 0 filas. */
export const MSG_SIN_FILAS =
  "La base de datos no aplicó el cambio (0 filas afectadas): tu usuario no tiene permiso para esta acción, o el registro ya no existe. No se guardó nada.";
