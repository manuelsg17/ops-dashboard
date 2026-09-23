// Fecha "de hoy" para NOMBRES DE ARCHIVO, en hora de Lima.
//
// `new Date().toISOString().slice(0, 10)` es la fecha UTC: después de las 19:00
// en Lima ya es "mañana", y el PDF/PNG que un KAM exporta a las 20:00 del 30-sep
// salía con fecha 2026-10-01. Pasa justo en el cierre de mes, cuando más se
// exporta.
//
// `en-CA` formatea como YYYY-MM-DD, el mismo formato que tenían los nombres.

export function fechaLocalISO(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(d);
}
