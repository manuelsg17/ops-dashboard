// core/dates.js — Parseo de fechas puro (Fase A2: módulo ES)

// Parsea "YYYY-MM-DD" o "YYYY-MM" como fecha LOCAL (medianoche local), no UTC.
// `new Date("2026-06-01")` se interpreta como UTC y en zonas con offset negativo
// (Perú UTC-5) cae el día anterior (2026-05-31), corriendo mes/día. Eso rompía la
// proyección: la semana del 1 de junio parecía "cruzar al mes siguiente" y forzaba
// daysRemaining=0 (Proy = Fact). Construir desde las partes evita el corrimiento.
// Acepta "YYYY-MM" (modo mensual usa date=mes sin día) defaulteando al día 1.
export function parseLocalDate(s) {
  const m = String(s).match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  return m ? new Date(+m[1], +m[2] - 1, +(m[3] || 1)) : new Date(s);
}
