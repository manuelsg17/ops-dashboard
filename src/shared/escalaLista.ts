// ─────────────────────────────────────────────────────────────────────────────
// ¿El dataset en memoria es el de la escala que dice la pantalla? (bug B12)
//
// `switchMode` cambia `STATE.curMode` en el acto y recién DESPUÉS de esperar la
// carga (loadMensualIfNeeded/loadDiarioIfNeeded) reasigna `STATE.rawData`. En ese
// hueco —segundos en el primer arranque con la escala mensual guardada—
// cualquier render (el refresco de fondo, un filtro restaurado) pintaba los
// números SEMANALES bajo rótulos "mensual". En el portal eso es un número
// equivocado mostrado al partner.
//
// La señal fiable no es el flag `_mensualLoaded` a secas sino la IDENTIDAD del
// array: `rawData` solo pasa a ser `rawDataMensual` cuando la carga terminó y
// switchMode lo asignó. (El flag solo no alcanza: se marca antes de la
// reasignación, y otra capa puede resetearlo para forzar una recarga mientras
// la pantalla sigue mostrando datos válidos.)
//
// Puro: recibe el estado. La capa de datos NO se toca desde acá — es solo el
// guard del lado de la vista.
// ─────────────────────────────────────────────────────────────────────────────
import { normEscala } from "./escala";

export function escalaLista(state: any): boolean {
  if (!state) return false;
  const esc = normEscala(state.curMode);
  const raw = state.rawData;
  if (esc === "mensual") return !!raw && raw === state.rawDataMensual;
  if (esc === "diario")  return !!raw && raw === state.rawDataDiario;
  // Semanal: `_semanalData` es la referencia fija al dataset semanal filtrado.
  // Sin ella todavía (antes de la primera carga) no hay otra escala con la que
  // confundirse.
  return !state._semanalData || raw === state._semanalData;
}

/**
 * Programa `render` para cuando el dataset de la escala activa esté listo.
 * Reintenta cada `cadaMs` hasta `maxMs`; se abandona si `sigue()` da false (el
 * usuario cambió de pestaña). Un solo reintento en vuelo por clave: renders
 * repetidos mientras se espera no apilan timers.
 */
const _pendientes = new Map<string, ReturnType<typeof setTimeout>>();
export function reintentarCuandoEscalaLista(
  clave: string, state: any, render: () => void, sigue: () => boolean,
  cadaMs = 200, maxMs = 60000
): void {
  if (_pendientes.has(clave)) return;
  const t0 = Date.now();
  const tick = () => {
    _pendientes.delete(clave);
    if (!sigue()) return;
    if (escalaLista(state)) { render(); return; }
    if (Date.now() - t0 > maxMs) return;
    _pendientes.set(clave, setTimeout(tick, cadaMs));
  };
  _pendientes.set(clave, setTimeout(tick, cadaMs));
}
