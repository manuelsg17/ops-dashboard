//@ts-nocheck
// shared/mesReporte.ts — Mes de REPORTE al que pertenece una fecha, y sus
// nombres. Extraído de presentacion2.ts (donde nació) para que partnerPortal.ts
// pueda usar la MISMA regla sin arrastrar el chunk lazy de presentacion2
// (Chart.js) a su bundle. Pura: recibe curMode explícito en vez de leer STATE.

// Claves de BD de los meses: la tabla vive en core/meses.ts (única). Se
// re-exporta acá porque presentacion2/partnerPortal ya la importaban de este módulo.
export { MES_NOMBRES } from "../core/meses";
import { diasMesEnCursoMensual } from "../domain/diasMesEnCurso";

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

// Días del MES DE REPORTE, para prorratear un flujo (N+R, horas) hasta fin de
// mes y para la marca de calendario de las barras.
//
// calcProjectionDays (data.ts) hace lo mismo sobre el mes CALENDARIO de la
// fecha, y ahí las dos reglas se separan: la semana del Lun 29-jun pertenece al
// reporte de JULIO (su jueves cae el 2-jul) pero su mes calendario es junio, así
// que devolvía "Día 30 de 30 · mes cerrado" bajo un encabezado que dice JULIO,
// con la marca de calendario clavada al 100% y una sola semana acumulada contra
// la meta mensual entera. Toda pantalla que bucketee por mes de REPORTE
// (presentacion2, partnerPortal) tiene que usar ESTA, no aquélla.
//
// MENSUAL con el mes EN CURSO (24-sep-2026): la fila es el acumulado a la
// fecha, no un mes cerrado. Se prorratea por los días hasta el corte de datos
// (fin de la última semana cargada, tope ayer en Lima — domain/diasMesEnCurso)
// y el resultado lleva `corte` ("YYYY-MM-DD") para decirlo en pantalla. Antes
// la proyección de N+R y horas quedaba igual al actual solo en mensual. Un mes
// cerrado sigue siendo el período completo. `opts`: { periodosSemanales, hoy }
// — usar diasMesReporteDe(STATE, …), que los pasa desde el estado de la app.
export function diasMesReporte(lastDate, curMode, parseLocalDate, opts = {}) {
  if (!lastDate) return { daysElapsed: 28, daysRemaining: 0, daysInMonth: 30 };
  const { y, m } = reportYM(lastDate, curMode, parseLocalDate);
  const daysInMonth = new Date(y, m, 0).getDate();
  const fin = parseLocalDate(lastDate);
  if (curMode === "semanal") fin.setDate(fin.getDate() + 6);
  let daysElapsed;
  if (curMode === "mensual") {
    const mtd = diasMesEnCursoMensual(m, y, opts.hoy || new Date(), opts.periodosSemanales);
    if (mtd) return mtd;
    daysElapsed = daysInMonth;                       // el período ES el mes cerrado
  } else {
    const fy = fin.getFullYear(), fm = fin.getMonth() + 1;
    // El período TERMINA después del mes de reporte (la semana del Lun 27-jul
    // cierra el 2-ago): el mes de reporte ya está completo.
    daysElapsed = (fy > y || (fy === y && fm > m)) ? daysInMonth
                : (fy === y && fm === m)           ? fin.getDate()
                : 0;                                 // inalcanzable (fin ≥ jueves)
  }
  return { daysElapsed, daysRemaining: Math.max(daysInMonth - daysElapsed, 0), daysInMonth };
}

// diasMesReporte con la escala y los períodos semanales del estado de la app
// (STATE._allPeriods.semanal, de la RPC dashboard_dates). Punto ÚNICO para
// Metas, Rendimiento, el deck y el portal: la misma proyección para el mismo mes.
export function diasMesReporteDe(S, lastDate, parseLocalDate) {
  const semanal = (S && S._allPeriods && S._allPeriods.semanal) || null;
  return diasMesReporte(lastDate, S ? S.curMode : "semanal", parseLocalDate, { periodosSemanales: semanal });
}
