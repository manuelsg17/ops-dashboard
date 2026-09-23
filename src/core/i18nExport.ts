// core/i18nExport.ts — Idioma de lo que se le ENTREGA al partner (Ola 3, sep-2026).
//
// ─── NO ES EL MISMO IDIOMA QUE core/i18n.ts ────────────────────────────────
// core/i18n.ts (`t()`) traduce la HERRAMIENTA y lee un idioma GLOBAL: el del
// KAM que la está usando. Este módulo traduce lo que sale hacia el partner
// (deck de Presentación, tarjeta de la Calculadora, lectura ejecutiva) y el
// idioma entra SIEMPRE por parámetro, porque conviven dos idiomas vivos a la
// vez: el KAM navega en español y exporta el PDF en ruso. No unificarlos.
//
// Antes había tres resolvers casi iguales (`P2T` del deck, `_T` de la lectura,
// `_calcLab` de la tarjeta) y ninguno formateaba números: un deck en ruso salía
// con "2,415" y "12.5%" (formato es-PE). Ahora los tres pasan por acá.
//
// Cascada de idioma: ru → en → es. Nunca de ruso a español directo: un texto en
// español dentro de un documento ruso parece un error de datos; uno en inglés
// se lee como el idioma puente del equipo.
//
// Puro: sin STATE ni DOM. Testeado en core/i18nExport.test.ts.

import { mesNombre, mesIndice } from "./meses";

export type ExportLang = "es" | "en" | "ru";
export const EXPORT_LANGS: ExportLang[] = ["es", "en", "ru"];

export interface Trio { es: string; en?: string; ru?: string }

/** Normaliza cualquier valor a un ExportLang (lo desconocido → "es"). */
export function exportLang(x: unknown): ExportLang {
  return x === "en" || x === "ru" ? x : "es";
}

/** Resuelve un trío en `lang` con la cascada ru → en → es. */
export function pick(tr: Trio, lang: string): string {
  if (lang === "ru") return tr.ru || tr.en || tr.es;
  if (lang === "en") return tr.en || tr.es;
  return tr.es;
}

// ── Etiquetas compartidas ───────────────────────────────────────────────────
// UNA definición por KPI. Antes había seis y no coincidían: la tarjeta decía
// "Active Drivers" en español y el deck "Conductores Activos" para la misma
// métrica, en dos documentos que el mismo partner recibe la misma semana.
// Las formas `*Corto` existen para columnas angostas (la tarjeta), no para
// decir otra cosa.
export const EXPORT_STR: Record<string, Trio> = {
  "kpi.ad":       { es: "Conductores Activos", en: "Active Drivers", ru: "Активные водители" },
  "kpi.nr":       { es: "Nuevos + Reactivados", en: "New + Reactivated", ru: "Новые + реактивированные" },
  "kpi.nrCorto":  { es: "N+R", en: "N+R", ru: "Новые+реактив." },
  "kpi.sh":       { es: "Horas de Conexión", en: "Supply Hours", ru: "Часы на линии" },
  "kpi.trips":    { es: "Viajes", en: "Trips", ru: "Поездки" },
  "kpi.cars":     { es: "Brandeados", en: "Branded", ru: "Брендированные" },
  "kpi.shcar":    { es: "SH/Auto", en: "SH/Car", ru: "Часы/авто" },
  "kpi.accept":   { es: "Aceptación", en: "Acceptance", ru: "Принятие заказов" },
  "kpi.util":     { es: "Utilización", en: "Utilization", ru: "Утилизация" },
  "sinMeta":        { es: "sin meta", en: "no target", ru: "без цели" },
  "sinMetaCargada": { es: "sin meta cargada", en: "no target", ru: "цель не загружена" },
  "ciudad":       { es: "Ciudad", en: "City", ru: "Город" },
  "pagina":       { es: "pág", en: "page", ru: "стр." },
  "peru":         { es: "Perú", en: "Peru", ru: "Перу" },
  // Gantt de Seguimiento: lo dibuja la MISMA función en la pestaña (idioma de
  // la interfaz) y en la hoja del deck (idioma del deck), así que vive acá.
  "seg.st.pendiente": { es: "Pendiente", en: "Pending", ru: "Ожидает" },
  "seg.st.en_curso":  { es: "En curso", en: "In progress", ru: "В работе" },
  "seg.st.hecho":     { es: "Hecho", en: "Done", ru: "Выполнено" },
  "seg.st.bloqueado": { es: "Bloqueado", en: "Blocked", ru: "Заблокировано" },
  "seg.sinTareas":    { es: "Aún no hay tareas de seguimiento.", en: "No follow-up tasks yet.", ru: "Задач сопровождения пока нет." },
  "seg.sinProyecto":  { es: "Sin proyecto", en: "No project", ru: "Без проекта" },
  "seg.hechas":       { es: "hechas", en: "done", ru: "выполнено" },
  "seg.hoy":          { es: "Hoy", en: "Today", ru: "Сегодня" },
  "seg.tarea":        { es: "Tarea", en: "Task", ru: "Задача" },
  "seg.estado":       { es: "Estado", en: "Status", ru: "Статус" }
};

// Ciudades: la clave es el valor NORMALIZADO de la BD (normCity → "LIMA") y no
// se toca; solo cambia el texto. Una ciudad que no está acá se muestra con la
// capitalización de siempre ("Cusco") en cualquier idioma.
const CIUDADES: Record<string, Trio> = {
  LIMA:     { es: "Lima", en: "Lima", ru: "Лима" },
  AREQUIPA: { es: "Arequipa", en: "Arequipa", ru: "Арекипа" },
  TRUJILLO: { es: "Trujillo", en: "Trujillo", ru: "Трухильо" }
};

/** Etiqueta compartida. Clave desconocida → la clave (visible, no un hueco). */
export function xl(key: string, lang: string, params?: Record<string, unknown>): string {
  const tr = EXPORT_STR[key];
  let s = tr ? pick(tr, lang) : key;
  if (params) for (const k of Object.keys(params)) s = s.split(`{${k}}`).join(String(params[k]));
  return s;
}

/** Nombre de ciudad para exportar. `c` es el valor de la BD ("LIMA", "lima"). */
export function ciudadL(c: unknown, lang: string): string {
  const k = String(c ?? "").trim().toUpperCase();
  if (!k) return "";
  const tr = CIUDADES[k];
  if (tr) return pick(tr, lang);
  return k.charAt(0) + k.slice(1).toLowerCase();
}

/** Nombre de mes a partir de la clave de BD ("JULIO") en el idioma de exportación.
 *  Lo que no es un nombre de mes (p.ej. "2026-07") se devuelve tal cual. */
export function mesL(mesBD: unknown, lang: string, opts: { corto?: boolean } = {}): string {
  const i = mesIndice(mesBD);
  return i < 0 ? String(mesBD ?? "") : mesNombre(i, lang, opts);
}

// ── Números ─────────────────────────────────────────────────────────────────
// es → es-PE (el formato de siempre: los números de las exportaciones en
// español NO cambian), en → en-US, ru → ru-RU ("2 415", "12,5").
const LOCALE: Record<ExportLang, string> = { es: "es-PE", en: "en-US", ru: "ru-RU" };
export function localeDe(lang: string): string { return LOCALE[exportLang(lang)]; }

/** Igual que fmt() de core/format.ts (mismas reglas de redondeo), en el idioma pedido. */
export function fmtL(n: number | null | undefined, lang: string): string {
  const v = n || 0;
  return v.toLocaleString(localeDe(lang), {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(v) >= 10000 ? 0 : 2
  });
}

/** Igual que fmtSmart() de core/format.ts (K/M con 1 decimal fijo), en el idioma pedido. */
export function fmtSmartL(n: number | null | undefined, lang: string): string {
  if (n === null || n === undefined || isNaN(n)) return "0";
  const neg = n < 0, abs = Math.abs(n), loc = localeDe(lang);
  const d1 = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  const out = abs >= 1_000_000 ? (abs / 1_000_000).toLocaleString(loc, d1) + "M"
            : abs >= 1_000     ? (abs / 1_000).toLocaleString(loc, d1) + "K"
            : fmtL(abs, lang);
  return neg ? "-" + out : out;
}

/**
 * Número con `dec` decimales FIJOS y sin separador de miles — el reemplazo de
 * `x.toFixed(dec)` en texto visible (porcentajes, ratios). En es/en devuelve
 * exactamente `toFixed` (nada cambia); en ru usa la coma decimal.
 *
 * NO usar para valores que van a CSS (`width:${x}%`): ahí el punto es sintaxis.
 */
export function fmtDecL(n: number, dec: number, lang: string): string {
  if (exportLang(lang) !== "ru") return n.toFixed(dec);
  return n.toLocaleString("ru-RU", { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: false });
}

// ── makeT ───────────────────────────────────────────────────────────────────
export interface ExportT {
  /** Frase en línea: `T("Hola", "Hello", "Привет")`. ru opcional → cae a en. */
  (es: string, en?: string, ru?: string): string;
  lang: ExportLang;
  /** Etiqueta compartida de EXPORT_STR. */
  k: (key: string, params?: Record<string, unknown>) => string;
  num: (n: number | null | undefined) => string;
  smart: (n: number | null | undefined) => string;
  dec: (n: number, dec: number) => string;
  mes: (mesBD: unknown, opts?: { corto?: boolean }) => string;
  ciudad: (c: unknown) => string;
}

/** Traductor + formateadores atados a un idioma de exportación. */
export function makeT(lang: unknown): ExportT {
  const L = exportLang(lang);
  const T = ((es: string, en?: string, ru?: string) => pick({ es, en, ru }, L)) as ExportT;
  T.lang   = L;
  T.k      = (key, params) => xl(key, L, params);
  T.num    = n => fmtL(n, L);
  T.smart  = n => fmtSmartL(n, L);
  T.dec    = (n, d) => fmtDecL(n, d, L);
  T.mes    = (m, opts) => mesL(m, L, opts);
  T.ciudad = c => ciudadL(c, L);
  return T;
}
