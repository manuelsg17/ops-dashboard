//@ts-nocheck
// shared/mesReporte.ts — Mes de REPORTE al que pertenece una fecha, y sus
// nombres. Extraído de presentacion2.ts (donde nació) para que partnerPortal.ts
// pueda usar la MISMA regla sin arrastrar el chunk lazy de presentacion2
// (Chart.js) a su bundle. Pura: recibe curMode explícito en vez de leer STATE.

export const MES_NOMBRES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

// En SEMANAL, una semana Lun–Dom pertenece al mes donde cae su JUEVES
// (inicio+3 = día mediano) — así la semana que arranca el Lun 29-jun cuenta
// como PRIMERA semana de JULIO, no como última de junio. En MENSUAL/DIARIO el
// mes es el de la fecha misma. Devuelve { y: año, m: 1-12 }.
export function reportYM(dateStr, curMode, parseLocalDate) {
  if (!dateStr) return { y: 0, m: 0 };
  if (curMode === "semanal") {
    const dt = parseLocalDate(dateStr);
    dt.setDate(dt.getDate() + 3);
    return { y: dt.getFullYear(), m: dt.getMonth() + 1 };
  }
  return { y: parseInt(dateStr.slice(0, 4), 10), m: parseInt(dateStr.slice(5, 7), 10) };
}
