// ============================================================
// domain/borrarDatos.ts — Filtro de "Eliminar datos" para METAS (B3)
// ============================================================
// Configuración → Mantenimiento pide el mes como "YYYY-MM", pero `metas.mes` es
// el NOMBRE ("JUNIO") y el año va en `mes_year`. El borrado filtraba
// `mes = "2026-06"`: no matcheaba NADA y la pantalla decía "Eliminado ✓".
//
// Este módulo traduce "YYYY-MM" al filtro correcto. Es puro: el I/O vive en
// app.ts (deleteDashboardData).

import { MESES_ES } from "./mesesMeta";

export interface FiltroMetasMes {
  anio: number;
  /** Valores de `metas.mes` que cuentan como ese mes. Se comparan con ILIKE
   *  (casing mixto de uploads viejos). Incluye el alias peruano "SETIEMBRE" y el
   *  formato ISO que algún upload viejo pudo guardar. */
  nombres: string[];
  /** Expresión para `.or()` de PostgREST: mes.ilike.JUNIO,mes.ilike.2026-06 */
  orPostgrest: string;
}

/** null si `ym` no es un "YYYY-MM" válido. */
export function filtroMetasDeMes(ym: string): FiltroMetasMes | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || "").trim());
  if (!m) return null;
  const anio = +m[1], n = +m[2];
  if (n < 1 || n > 12) return null;
  const nombres = [MESES_ES[n - 1]];
  if (n === 9) nombres.push("SETIEMBRE");
  nombres.push(`${m[1]}-${m[2]}`);
  return { anio, nombres, orPostgrest: nombres.map(x => `mes.ilike.${x}`).join(",") };
}
