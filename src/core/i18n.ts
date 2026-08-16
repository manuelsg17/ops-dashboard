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


  // Nombres de metrica. METRICS (core/config.ts) los conserva en espanol como
  // valor por defecto y lo usan modulos todavia sin traducir; aca viven las
  // versiones traducidas para las vistas que ya pasaron por i18n.
  "metric.ad.label":  { es: "Conductores Activos",  en: "Active Drivers",      ru: "Активные водители" },
  "metric.ad.short":  { es: "Cond. Activos",        en: "Active Drv.",         ru: "Актив. водители" },
  "metric.nr.label":  { es: "Nuevos + Reactivados", en: "New + Reactivated",   ru: "Новые + реактивированные" },
  "metric.nr.short":  { es: "Nuevos+React",         en: "New+React",           ru: "Новые+реакт." },
  "metric.sh.label":  { es: "Horas de Conexión",    en: "Supply Hours",        ru: "Часы на линии" },
  "metric.sh.short":  { es: "Hs. Conexión",         en: "Supply Hrs",          ru: "Часы" },
  "metric.tr.label":  { es: "Viajes",               en: "Trips",               ru: "Поездки" },
  "metric.tr.short":  { es: "Viajes",               en: "Trips",               ru: "Поездки" },
  "metric.nr.abbr":   { es: "N+R",                  en: "N+R",                 ru: "N+R" },
  "rend.col.partner": { es: "Partner",              en: "Partner",             ru: "Партнёр" },
  "rend.col.comision":{ es: "Comisión",             en: "Commission",          ru: "Комиссия" },
  "rend.col.leads":   { es: "Leads Yango",          en: "Yango Leads",         ru: "Лиды Yango" },
  "rend.lbl.activos": { es: "Activos",              en: "Active",              ru: "Активные" },
  "rend.lbl.acumRango":{ es: "acumulado rango",     en: "range total",         ru: "сумма за период" },
  "rend.cmp.semAnterior":{ es: "sem. anterior",     en: "prev. week",          ru: "пред. неделя" },
  "rend.cmp.vs":      { es: "vs {p}",               en: "vs {p}",              ru: "vs {p}" },
  "rend.cmp.mesAnterior":{ es: "mes anterior",      en: "prev. month",         ru: "пред. месяц" },
  "rend.cmp.diaAnterior":{ es: "dia anterior",      en: "prev. day",           ru: "пред. день" },
  // Lineas de negocio: los nombres propios (Fleet, TukTuk) NO se traducen — es
  // como se llaman internamente y traducirlos confundiria mas de lo que ayuda.
  "rend.linea.comb":  { es: "Combinado",  en: "Combined",   ru: "Комбинированный" },
  "rend.linea.agg":   { es: "Agregador",  en: "Aggregator", ru: "Агрегатор" },
  "rend.linea.combTip": { es: "Taxi + TukTuk sumados — avance total del partner",
                          en: "Taxi + TukTuk combined — the partner's total progress",
                          ru: "Такси + ТукТук вместе — общий результат партнёра" },
  "rend.linea.aggTip":  { es: "Taxi — incluye la actividad de las flotas",
                          en: "Taxi — includes fleet activity",
                          ru: "Такси — включая активность автопарков" },
  "rend.linea.fleetTip":{ es: "Solo sub-flotas marcadas Fleet", en: "Only sub-fleets flagged Fleet", ru: "Только подпарки с меткой Fleet" },
  "rend.linea.tkTip":   { es: "Solo TukTuk", en: "TukTuk only", ru: "Только ТукТук" },

  // ── Rendimiento (fase 2) ───────────────────────────────────────────────
  // Períodos: los usa el subtítulo de cada sección para decir de cuándo es el
  // snapshot. En ruso el caso gramatical cambia segun la preposicion, asi que
  // se traducen como frase completa y no armando "ultimo" + "semana".
  "rend.per.ultimaSemana":   { es: "última semana",   en: "last week",     ru: "последняя неделя" },
  "rend.per.ultimoDia":      { es: "último día",      en: "last day",      ru: "последний день" },
  "rend.per.ultimoMes":      { es: "último mes",      en: "last month",    ru: "последний месяц" },
  "rend.per.ultimoPeriodo":  { es: "último período",  en: "last period",   ru: "последний период" },
  "rend.per.periodoAnterior":{ es: "el período anterior", en: "the previous period", ru: "предыдущий период" },

  "rend.peru.titulo":  { es: "Peru - Vista General", en: "Peru - Overview", ru: "Перу — общий обзор" },
  "rend.peru.sub":     { es: "Activos: snapshot {p}  ·  N+R y Horas: acumulado del rango",
                         en: "Active: {p} snapshot  ·  N+R and Hours: range total",
                         ru: "Активные: срез — {p}  ·  N+R и часы: сумма за период" },

  "rend.ciudad.titulo": { es: "Por Ciudad", en: "By City", ru: "По городам" },
  "rend.ciudad.sub":    { es: "Rendimiento y comparativo WoW", en: "Performance and WoW comparison", ru: "Показатели и сравнение с прошлой неделей" },
  "rend.kam.titulo":    { es: "Por KAM", en: "By KAM", ru: "По KAM" },
  "rend.kam.sub":       { es: "Rendimiento por responsable", en: "Performance by owner", ru: "Показатели по ответственному" },

  "rend.tend.titulo":   { es: "Tendencias", en: "Trends", ru: "Тренды" },
  "rend.tend.sub":      { es: "Perú por partner · y comparativa directa entre ciudades",
                          en: "Peru by partner · and direct comparison across cities",
                          ru: "Перу по партнёрам · и прямое сравнение городов" },
  "rend.tend.peruTotal":{ es: "Perú Total · por partner", en: "Peru Total · by partner", ru: "Перу всего · по партнёрам" },

  "rend.prod.titulo":   { es: "Productividad", en: "Productivity", ru: "Производительность" },
  "rend.prod.sub":      { es: "Rendimiento por conductor y por hora · {d} vs período anterior",
                          en: "Performance per driver and per hour · {d} vs previous period",
                          ru: "Показатели на водителя и в час · {d} против предыдущего периода" },

  "rend.mov.titulo":    { es: "Quién se movió", en: "Who moved", ru: "Кто изменился" },
  "rend.mov.sub":       { es: "Mayores variaciones de Conductores Activos vs {d}",
                          en: "Largest Active Drivers changes vs {d}",
                          ru: "Наибольшие изменения активных водителей · база: {d}" },
  "rend.mov.suben":     { es: "📈 Los que más subieron", en: "📈 Biggest risers", ru: "📈 Наибольший рост" },
  "rend.mov.bajan":     { es: "📉 Los que más cayeron", en: "📉 Biggest fallers", ru: "📉 Наибольшее падение" },
  "rend.mov.sinMov":    { es: "Sin movimientos", en: "No changes", ru: "Без изменений" },

  "rend.tabla.titulo":  { es: "Tabla de Partners", en: "Partner Table", ru: "Таблица партнёров" },
  "rend.tabla.sub":     { es: "Click en columna para ordenar", en: "Click a column to sort", ru: "Нажмите на столбец для сортировки" },
  "rend.cards.titulo":  { es: "KPIs por Partner", en: "KPIs by Partner", ru: "KPI по партнёрам" },
  "rend.cards.sub":     { es: "Detalle del último período", en: "Last period detail", ru: "Детали последнего периода" },

  // KPIs
  "rend.kpi.horasCond":  { es: "Horas por conductor", en: "Hours per driver",  ru: "Часов на водителя" },
  "rend.kpi.viajesCond": { es: "Viajes por conductor", en: "Trips per driver", ru: "Поездок на водителя" },
  "rend.kpi.viajesHora": { es: "Viajes por hora",     en: "Trips per hour",    ru: "Поездок в час" },
  "rend.kpi.gmvHora":    { es: "GMV / Hora",          en: "GMV / Hour",        ru: "GMV / час" },
  "rend.kpi.gmvAuto":    { es: "GMV / Auto",          en: "GMV / Car",         ru: "GMV / авто" },
  "rend.kpi.comAuto":    { es: "Comisión / Auto",     en: "Commission / Car",  ru: "Комиссия / авто" },
  "rend.kpi.viajesAuto": { es: "Viajes / Auto",       en: "Trips / Car",       ru: "Поездок / авто" },
  "rend.kpi.shAuto":     { es: "SH / Auto (interno)", en: "SH / Car (internal)", ru: "Часы / авто (внутр.)" },
  "rend.kpi.aceptacion": { es: "Aceptación",          en: "Acceptance",        ru: "Принятие" },
  "rend.kpi.ownedCars":  { es: "Owned Fleet Cars",    en: "Owned Fleet Cars",  ru: "Собственные авто" },
  "rend.kpi.brandedCars":{ es: "Branded Active Cars", en: "Branded Active Cars", ru: "Брендированные активные авто" },
  "rend.kpi.activeCars": { es: "Active Cars",         en: "Active Cars",       ru: "Активные авто" },
  "rend.kpi.brandeados": { es: "Brandeados",          en: "Branded",           ru: "Брендированные" },
  "rend.kpi.pctBrand":   { es: "% Brandeado",         en: "% Branded",         ru: "% брендированных" },
  "rend.kpi.nuevosProp": { es: "Nuevos propios",      en: "Own new drivers",   ru: "Свои новые" },
  "rend.kpi.selfReg":    { es: "Self-registration",   en: "Self-registration", ru: "Саморегистрация" },
  "rend.kpi.pctAdq":     { es: "% adquisición propia", en: "% own acquisition", ru: "% своего привлечения" },

  // Gráficas
  "rend.ch.condActivos": { es: "Conductores Activos", en: "Active Drivers", ru: "Активные водители" },
  "rend.ch.nuevosReact": { es: "Nuevos + Reactivados", en: "New + Reactivated", ru: "Новые + реактивированные" },

  // Fleet
  "rend.fleet.peru":       { es: "Fleet · Perú General",  en: "Fleet · Peru Overview", ru: "Fleet · Перу — обзор" },
  "rend.fleet.peruSub":    { es: "Presencia, calidad y revenue/productividad de flota · snapshot {p}",
                             en: "Fleet presence, quality and revenue/productivity · {p} snapshot",
                             ru: "Присутствие, качество и выручка автопарка · срез — {p}" },
  "rend.fleet.tend":       { es: "Fleet · Tendencias",    en: "Fleet · Trends",        ru: "Fleet · Тренды" },
  "rend.fleet.tendSub":    { es: "Evolución Peru total en el rango filtrado",
                             en: "Peru total evolution over the filtered range",
                             ru: "Динамика по Перу за выбранный период" },
  "rend.fleet.comp":       { es: "Fleet · Composición",   en: "Fleet · Composition",   ru: "Fleet · Состав" },
  "rend.fleet.compSub":    { es: "Snapshot {d} · distribución, no tendencia",
                             en: "{d} snapshot · distribution, not a trend",
                             ru: "Срез {d} · распределение, не тренд" },
  "rend.fleet.calidad":    { es: "Fleet · Calidad y Dependencia", en: "Fleet · Quality and Dependency", ru: "Fleet · Качество и зависимость" },
  "rend.fleet.calidadSub": { es: "Riesgo operativo y madurez del negocio · snapshot {p}",
                             en: "Operational risk and business maturity · {p} snapshot",
                             ru: "Операционный риск и зрелость бизнеса · срез — {p}" },
  "rend.fleet.ciudad":     { es: "Fleet por Ciudad", en: "Fleet by City", ru: "Fleet по городам" },
  "rend.fleet.ciudadSub":  { es: "KPIs de flota por ciudad · comparativo con período anterior",
                             en: "Fleet KPIs by city · compared with the previous period",
                             ru: "KPI автопарка по городам · к предыдущему периоду" },
  "rend.fleet.partner":    { es: "Fleet por Partner", en: "Fleet by Partner", ru: "Fleet по партнёрам" },
  "rend.fleet.partnerSub": { es: "Detalle de flota por partner · ordenado por autos propios",
                             en: "Fleet detail by partner · sorted by owned cars",
                             ru: "Автопарк по партнёрам · по числу собственных авто" },
  "rend.fleet.ownedDonut": { es: "Owned Cars por Partner", en: "Owned Cars by Partner", ru: "Собственные авто по партнёрам" },
  "rend.fleet.brandDonut": { es: "Brandeados vs No Brandeados", en: "Branded vs Non-Branded", ru: "Брендированные и небрендированные" },
  "rend.fleet.noBrand":    { es: "No brandeados", en: "Non-branded", ru: "Небрендированные" },

  // ── Estados comunes ────────────────────────────────────────────────────
  "estado.cargando": { es: "Cargando…", en: "Loading…", ru: "Загрузка…" },
  "estado.datosCargados": { es: "Datos cargados", en: "Data loaded", ru: "Данные загружены" },
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
