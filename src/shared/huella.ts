// Huella de números (Ola 0 del plan de mejora, docs/plan-mejora-2026-09.md).
//
// Marca con `data-num="<vista>.<seccion>.<metrica>[.<entidad>]"` los elementos
// que MUESTRAN una cifra clave. scripts/huella/huella.js recorre esas marcas en
// cada escala × línea × vista y arma un JSON {clave: texto}; compare.mjs diffea
// dos huellas. Sirve para PROBAR que un rediseño no movió ningún número: si la
// huella cambia, o hay un bug corregido que lo explica, o el rediseño rompió algo.
//
// Reglas de la clave:
//   · SEMÁNTICA y ESTABLE: la entidad es el nombre del partner/ciudad/KAM o el
//     CLID, nunca un índice ni la posición en pantalla (un reorden no es un
//     cambio de número).
//   · Solo se AGREGA el atributo: no cambia el render ni la cifra.
//   · Las partes vacías/null se omiten (p.ej. un KAM "" no deja un ".." suelto).
import { escapeHTML } from "../core/security";

export type ParteClave = string | number | null | undefined;

/** Clave de huella, sin escapar (útil para tests o para armar claves compuestas). */
export function claveNum(...partes: ParteClave[]): string {
  return partes
    .filter(p => p != null && String(p).trim() !== "")
    .map(p => String(p).trim())
    .join(".");
}

/** Atributo listo para interpolar en un template: ` data-num="..."` (con espacio inicial). */
export function dn(...partes: ParteClave[]): string {
  return ` data-num="${escapeHTML(claveNum(...partes))}"`;
}
