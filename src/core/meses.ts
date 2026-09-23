// core/meses.ts — LA tabla de meses (Ola 3, sep-2026).
//
// Antes había ocho: I18N mes.*, P2_MES_EN/RU (deck), CALC_MES_EN/RU y
// CALC_MES_NOMBRES (tarjeta), _segMonths (Gantt), MES_NOMBRES
// (shared/mesReporte) y MESES_ES (domain/mesesMeta). Ocho copias de lo mismo
// divergen tarde o temprano — y el día que una tiene "Setiembre" y otra
// "Septiembre", la misma meta aparece con dos nombres en dos pantallas.
//
// ─── DOS COSAS DISTINTAS, NO MEZCLARLAS ─────────────────────────────────────
// 1. MES_NOMBRES son CLAVES DE BASE DE DATOS: `metas.mes` se guarda como
//    "ENERO"…"DICIEMBRE" (español, mayúsculas, sin año). Se comparan por
//    igualdad contra la BD y NUNCA se traducen ni se les cambia la grafía.
// 2. mesNombre() es TEXTO para mostrar, en el idioma que se pida (el de la
//    interfaz o el de la exportación, según quién llame).
//
// Puro: no lee STATE ni el idioma global. El idioma entra por parámetro.

export const MES_NOMBRES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

const LARGO: Record<string, string[]> = {
  es: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
       "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"],
  en: ["January", "February", "March", "April", "May", "June",
       "July", "August", "September", "October", "November", "December"],
  ru: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
       "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
};
const CORTO: Record<string, string[]> = {
  es: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  ru: ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"]
};

/**
 * Nombre del mes `i` (0 = enero … 11 = diciembre) en `lang` ("es" | "en" | "ru").
 * Un idioma desconocido cae a español (es el idioma base de la app); un índice
 * fuera de rango devuelve "" para que el llamador decida qué mostrar.
 */
export function mesNombre(i: number, lang: string, opts: { corto?: boolean } = {}): string {
  if (!Number.isInteger(i) || i < 0 || i > 11) return "";
  const tabla = opts.corto ? CORTO : LARGO;
  return (tabla[lang] || tabla.es)[i];
}

/** Índice 0-11 de una clave de BD ("JULIO", "julio", " Julio "). -1 si no es un mes. */
export function mesIndice(nombre: unknown): number {
  return MES_NOMBRES.indexOf(String(nombre ?? "").trim().toUpperCase());
}
