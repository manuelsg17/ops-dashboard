// ============================================================
// shared/sesion.ts — Reseteo del estado POR USUARIO al cerrar sesión (I2)
// ============================================================
// Salir y volver a entrar SIN recargar la página reutiliza los mismos módulos
// ya evaluados. Todo estado que vive a nivel de módulo (CALC_STATE de la
// Calculadora, la conversión ya cargada, las promesas de columnas diferidas…)
// sobrevivía al logout: el usuario siguiente heredaba los números a medio
// cargar del anterior.
//
// auth.ts no puede importar los módulos de vista (son chunks lazy: importarlos
// desde acá los metería en el bundle de arranque), así que cada módulo registra
// su propio reseteo al evaluarse y el logout los corre todos. Un módulo que
// nunca se cargó no tiene nada que resetear, y no se registra.

const _resets = new Set<() => void>();

/** Registra una función que deja el estado del módulo como recién cargado. */
export function alCerrarSesion(fn: () => void): void {
  _resets.add(fn);
}

/** Corre todos los reseteos registrados. Uno que falle no frena al resto. */
export function resetearEstadoDeSesion(): void {
  for (const fn of _resets) {
    try { fn(); } catch (e) { console.error("resetearEstadoDeSesion:", e); }
  }
}
