// i18n de la INTERFAZ — ES / EN / RU.
//
// Generaliza el patrón que ya funcionaba en partnerView.ts (`PV_I18N` + `_t`):
// diccionario `{clave: {es, en, ru}}` y un resolver con interpolación `{campo}`.
// No se inventó arquitectura nueva; se movió a core y se le agregó ruso.
//
// ─── OJO: SON DOS IDIOMAS DISTINTOS, NO UNO ─────────────────────────────────
// Este módulo controla el idioma de la HERRAMIENTA (nav, botones, filtros).
// Vista Partner, Presentación 2.0 y la tarjeta de la Calculadora tienen su
// PROPIO selector (ES/EN/ES-EN) para lo que se le ENTREGA al partner, y debe
// seguir siendo independiente: un KAM puede querer el dashboard en ruso y
// mandarle igual el PDF en español a su partner. No unificarlos.
//
// ─── CÓMO SE APLICA ─────────────────────────────────────────────────────────
// El HTML estático lleva `data-i18n="clave"` (texto) y opcionalmente
// `data-i18n-title` / `data-i18n-ph` (title y placeholder). `aplicarI18nEstatico()`
// los recorre. El HTML generado desde JS usa `t("clave")` directamente.
//
// El ruso está pendiente de revisión de un hablante nativo del equipo. Donde
// falta, cae a inglés y después a español — nunca muestra la clave cruda.

export const IDIOMAS = [
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "ru", label: "Русский", flag: "🇷🇺" }
];

const LS_KEY = "yangoLang";

export const I18N: Record<string, Record<string, string>> = {
  // ── Login ──────────────────────────────────────────────────────────────
  "login.sub":      { es: "Partner Performance Analytics", en: "Partner Performance Analytics", ru: "Аналитика эффективности партнёров" },
  "login.email":    { es: "Email",       en: "Email",      ru: "Эл. почта" },
  "login.password": { es: "Contraseña",  en: "Password",   ru: "Пароль" },
  "login.submit":   { es: "Ingresar",    en: "Sign in",    ru: "Войти" },
  "login.loading":  { es: "Ingresando…", en: "Signing in…",ru: "Вход…" },
  "login.footer":   { es: "Acceso restringido · Uso interno Yango Peru",
                      en: "Restricted access · Yango Peru internal use",
                      ru: "Ограниченный доступ · Для внутреннего использования Yango Peru" },

  // ── Navegación ─────────────────────────────────────────────────────────
  "nav.analisis":    { es: "Análisis",         en: "Analysis",      ru: "Аналитика" },
  "nav.rendimiento": { es: "Rendimiento",      en: "Performance",   ru: "Показатели" },
  "nav.metas":       { es: "Metas",            en: "Goals",         ru: "Цели" },
  "nav.calculadora": { es: "Calculadora",      en: "Calculator",    ru: "Калькулятор" },
  "nav.vistaPartner":{ es: "Vista Partner",    en: "Partner View",  ru: "Обзор партнёра" },
  "nav.seguimiento": { es: "Seguimiento",      en: "Tracking",      ru: "Отслеживание" },
  "nav.dataRaw":     { es: "Data Raw",         en: "Raw Data",      ru: "Сырые данные" },
  "nav.present2":    { es: "Presentación 2.0", en: "Presentation 2.0", ru: "Презентация 2.0" },
  "nav.config":      { es: "Configuración",    en: "Settings",      ru: "Настройки" },
  // Con emoji: el icono viaja DENTRO de la traduccion para que cada idioma pueda
  // moverlo o quitarlo si estorba.
  "nav.calculadoraE":  { es: "🎯 Calculadora",   en: "🎯 Calculator",   ru: "🎯 Калькулятор" },
  "nav.vistaPartnerE": { es: "📊 Vista Partner", en: "📊 Partner View", ru: "📊 Обзор партнёра" },
  "nav.seguimientoE":  { es: "📋 Seguimiento",   en: "📋 Tracking",     ru: "📋 Отслеживание" },

  // ── Barra superior ─────────────────────────────────────────────────────
  "top.upload":     { es: "Actualizar información", en: "Update data", ru: "Обновить данные" },
  "top.logout":     { es: "Salir →",          en: "Sign out →",   ru: "Выйти →" },
  "top.refreshing": { es: "↻ Actualizando…",  en: "↻ Refreshing…", ru: "↻ Обновление…" },
  "top.langTitle":  { es: "Idioma de la interfaz", en: "Interface language", ru: "Язык интерфейса" },

  // ── Escala y filtros ───────────────────────────────────────────────────
  "mode.diario":  { es: "Diario",  en: "Daily",   ru: "Ежедневно" },
  "mode.semanal": { es: "Semanal", en: "Weekly",  ru: "Еженедельно" },
  "mode.mensual": { es: "Mensual", en: "Monthly", ru: "Ежемесячно" },

  "filtro.desde":     { es: "Desde",        en: "From",         ru: "С" },
  "filtro.hasta":     { es: "Hasta",        en: "To",           ru: "По" },
  "preset.week":      { es: "Esta semana",  en: "This week",    ru: "Эта неделя" },
  "preset.fortnight": { es: "Quincena",     en: "Fortnight",    ru: "Две недели" },
  "preset.month":     { es: "Este mes",     en: "This month",   ru: "Этот месяц" },
  "preset.hoy":       { es: "Hoy",          en: "Today",        ru: "Сегодня" },
  "preset.d7":        { es: "7 días",       en: "7 days",       ru: "7 дней" },
  "preset.d14":       { es: "14 días",      en: "14 days",      ru: "14 дней" },
  "preset.d30":       { es: "30 días",      en: "30 days",      ru: "30 дней" },
  "preset.d90":       { es: "90 días",      en: "90 days",      ru: "90 дней" },
  "preset.m3":        { es: "Últ. 3 meses", en: "Last 3 months",ru: "Посл. 3 месяца" },
  "preset.m6":        { es: "Últ. 6 meses", en: "Last 6 months",ru: "Посл. 6 месяцев" },

  "sidebar.escala":     { es: "Escala",         en: "Scale",          ru: "Масштаб" },
  "sidebar.rango":      { es: "Rango de Fechas", en: "Date Range",     ru: "Период" },
  "sidebar.ciudad":     { es: "Ciudad",          en: "City",           ru: "Город" },
  "sidebar.kam":        { es: "KAM",             en: "KAM",            ru: "KAM" },
  "sidebar.buscar":     { es: "Buscar Partner",  en: "Search Partner", ru: "Поиск партнёра" },
  "sidebar.partners":   { es: "Partners",        en: "Partners",       ru: "Партнёры" },
  "sidebar.filtrar":    { es: "Filtrar...",      en: "Filter...",      ru: "Фильтр…" },
  "sidebar.totalPeru":  { es: "Total Peru",      en: "Peru Total",     ru: "Перу — всего" },
  "sidebar.todos":   { es: "Todos",   en: "All",  ru: "Все" },
  "sidebar.ninguno": { es: "Ninguno", en: "None", ru: "Никто" },

  // ── Estados comunes ────────────────────────────────────────────────────
  "estado.cargando": { es: "Cargando…", en: "Loading…", ru: "Загрузка…" },
  "estado.sinDatos": { es: "Sin datos", en: "No data",  ru: "Нет данных" }
};

let _lang = "es";
try {
  const guardado = localStorage.getItem(LS_KEY);
  if (guardado && IDIOMAS.some(i => i.code === guardado)) _lang = guardado;
} catch (e) { /* localStorage bloqueado: se queda en español */ }

export function getLang(): string { return _lang; }

// El atributo lang del <html> hay que fijarlo TAMBIEN al arrancar, no solo al
// cambiar de idioma: al recargar con "ru" guardado, setLang() no corre (no hay
// cambio) y el documento quedaba anunciandose como "es" — lo ven los lectores de
// pantalla y el corrector ortografico del navegador.
try { document.documentElement.setAttribute("lang", _lang); } catch (e) { /* SSR/tests */ }

/** Devuelve true si el idioma cambió (el caller decide si re-renderiza). */
export function setLang(code: string): boolean {
  if (!IDIOMAS.some(i => i.code === code) || code === _lang) return false;
  _lang = code;
  try { localStorage.setItem(LS_KEY, code); } catch (e) { /* no bloquea */ }
  document.documentElement.setAttribute("lang", code);
  return true;
}

/**
 * Resuelve una clave. Cascada ES→EN→RU al revés: idioma pedido, luego inglés,
 * luego español. NUNCA devuelve la clave cruda si existe alguna traducción —
 * una pantalla con "nav.metas" es peor que una con una palabra en español.
 */
export function t(key: string, opts?: Record<string, unknown>): string {
  const e = I18N[key];
  if (!e) return key;
  let s = e[_lang] || e.en || e.es || key;
  if (opts) for (const k of Object.keys(opts)) s = s.split(`{${k}}`).join(String(opts[k]));
  return s;
}

/** Aplica las traducciones al HTML estático (index.html). */
export function aplicarI18nEstatico(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach(el => {
    const k = el.getAttribute("data-i18n");
    if (k) el.textContent = t(k);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach(el => {
    const k = el.getAttribute("data-i18n-title");
    if (k) el.setAttribute("title", t(k));
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-ph]").forEach(el => {
    const k = el.getAttribute("data-i18n-ph");
    if (k) el.setAttribute("placeholder", t(k));
  });
}

/** Selector de idioma para la barra superior. */
export function selectorIdiomaHTML(): string {
  return `<div class="lang-switch" title="${t("top.langTitle")}">` +
    IDIOMAS.map(i =>
      `<button class="lang-btn${i.code === _lang ? " active" : ""}" data-act="setUiLang" data-lang="${i.code}" title="${i.label}">${i.flag}</button>`
    ).join("") + `</div>`;
}
