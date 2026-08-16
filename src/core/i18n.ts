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


  // ── Metas (fase 2) ─────────────────────────────────────────────────────
  // Los titulos de seccion se armaban concatenando (`title + " por Ciudad"`).
  // Eso no se puede traducir: el orden de las palabras cambia por idioma y en
  // ruso ademas hay que declinar. Por eso van como plantilla con {t}.
  "metas.secCiudad":  { es: "{t} por Ciudad",  en: "{t} by City",    ru: "{t} по городам" },
  "metas.secKam":     { es: "{t} por KAM",     en: "{t} by KAM",     ru: "{t} по KAM" },
  "metas.secPartner": { es: "{t} por Partner", en: "{t} by Partner", ru: "{t} по партнёрам" },
  "metas.secMes":     { es: "{t} — {m}",       en: "{t} — {m}",      ru: "{t} — {m}" },

  "metas.sub.progProy":   { es: "Progreso y proyección",        en: "Progress and projection",   ru: "Прогресс и прогноз" },
  "metas.sub.progResp":   { es: "Progreso total por responsable", en: "Total progress by owner", ru: "Общий прогресс по ответственному" },
  "metas.sub.metaVsAct":  { es: "Meta vs actual individual",    en: "Goal vs actual, per partner", ru: "Цель и факт по партнёру" },
  "metas.sub.progInd":    { es: "Progreso individual con proyección", en: "Individual progress with projection", ru: "Индивидуальный прогресс с прогнозом" },
  "metas.sub.progMes":    { es: "Progreso actual vs meta del mes", en: "Current progress vs monthly goal", ru: "Текущий прогресс к цели месяца" },
  "metas.cumplimiento":   { es: "Cumplimiento de Metas",        en: "Goal Attainment",           ru: "Выполнение целей" },
  "metas.titulo":         { es: "Metas",                        en: "Goals",                     ru: "Цели" },
  "metas.tit.fleet":      { es: "Metas Fleet",     en: "Fleet Goals",     ru: "Цели Fleet" },
  "metas.tit.tuktuk":     { es: "Metas TukTuk",    en: "TukTuk Goals",    ru: "Цели ТукТук" },
  "metas.tit.comb":       { es: "Metas Combinado", en: "Combined Goals",  ru: "Общие цели" },
  "metas.metaSinActual":  { es: "meta · sin actual medible", en: "goal · no measurable actual", ru: "цель · нет измеримого факта" },
  // "Fact" y "Plan" son el vocabulario que ya usa el equipo en los reportes;
  // se traducen igual porque en la UI conviven con texto traducido.
  "metas.fact":           { es: "Fact",  en: "Actual", ru: "Факт" },
  "metas.meta":           { es: "Meta",  en: "Goal",   ru: "Цель" },
  "metas.plan":           { es: "Plan",  en: "Plan",   ru: "План" },
  "metas.proy":           { es: "Proy.", en: "Proj.",  ru: "Прогноз" },
  "metas.proyeccion":     { es: "Proyección", en: "Projection", ru: "Прогноз" },
  "metas.dePlan":         { es: " de plan {n}", en: " of plan {n}", ru: " от плана {n}" },
  "metas.ultimoPeriodo":  { es: "último período", en: "last period", ru: "последний период" },
  "metas.acumulado":      { es: "acumulado", en: "accumulated", ru: "накоплено" },
  "metas.acumMesSub":     { es: "acumulado mes", en: "month to date", ru: "накоплено за месяц" },
  "metas.sinMetaCargada": { es: "sin meta cargada", en: "no goal loaded", ru: "цель не загружена" },
  "metas.sinMetaMes":     { es: "sin meta cargada para este mes", en: "no goal loaded for this month", ru: "цель на этот месяц не загружена" },
  "metas.fleetSub":       { es: "Meta de flota vs actual del rango · SH/auto (interno), aceptación, utilización · las tasas se ponderan por autos/viajes al agrupar",
                            en: "Fleet goal vs actual over the range · SH/car (internal), acceptance, utilization · rates are weighted by cars/trips when grouped",
                            ru: "Цель автопарка против факта за период · часы/авто (внутр.), принятие, загрузка · при группировке ставки взвешиваются по авто/поездкам" },
  "metas.tkSub":          { es: "Meta TukTuk vs actual del rango · Active Drivers, N+R, Brandeados, Horas de Conexión",
                            en: "TukTuk goal vs actual over the range · Active Drivers, N+R, Branded, Supply Hours",
                            ru: "Цель ТукТук против факта за период · активные водители, N+R, брендированные, часы на линии" },
  "metas.horasConexion":  { es: "Horas Conexión", en: "Supply Hours", ru: "Часы на линии" },
  "metas.nuevosReact":    { es: "Nuevos + React", en: "New + React", ru: "Новые + реакт." },
  "metas.activeDrivers":  { es: "Active Drivers", en: "Active Drivers", ru: "Активные водители" },
  "metas.brandeados":     { es: "Brandeados", en: "Branded", ru: "Брендированные" },
  "metas.overachievement":{ es: "🏆 Overachievement", en: "🏆 Overachievement", ru: "🏆 Перевыполнение" },
  "metas.superasPlan":    { es: "Superas el plan (>100%)", en: "Above plan (>100%)", ru: "Выше плана (>100%)" },
  "metas.combSub":        { es: "Actual del RANGO seleccionado (ambas líneas sumadas) vs meta combinada · si el partner empuja TukTuk también avanza su meta · para % reales usa el preset del mes de la meta",
                            en: "Actual over the selected RANGE (both lines summed) vs the combined goal · if the partner pushes TukTuk their goal advances too · for real % use the goal month preset",
                            ru: "Факт за выбранный ПЕРИОД (обе линии вместе) против общей цели · если партнёр развивает ТукТук, цель тоже растёт · для реальных % используйте пресет месяца цели" },
  "metas.cumplTip":       { es: "Cumplimiento = Fact / Plan × 100. Fact: {f} de Plan: {p}",
                            en: "Attainment = Actual / Plan × 100. Actual: {f} of Plan: {p}",
                            ru: "Выполнение = Факт / План × 100. Факт: {f} из плана: {p}" },

  // Lineas
  "metas.linea.combTip":  { es: "Taxi + TukTuk sumados vs meta combinada — avance total del partner",
                            en: "Taxi + TukTuk combined vs the combined goal — the partner's total progress",
                            ru: "Такси + ТукТук против общей цели — суммарный результат партнёра" },
  "metas.linea.aggTip":   { es: "Metas Taxi (AD, N+R, Horas)", en: "Taxi goals (AD, N+R, Hours)", ru: "Цели по такси (AD, N+R, часы)" },
  "metas.linea.fleetTip": { es: "Metas de flota (SH/auto, aceptación, utilización)",
                            en: "Fleet goals (SH/car, acceptance, utilization)",
                            ru: "Цели автопарка (часы/авто, принятие, загрузка)" },
  "metas.linea.tkTip":    { es: "Metas TukTuk (AD, N+R, Brandeados)", en: "TukTuk goals (AD, N+R, Branded)", ru: "Цели ТукТук (AD, N+R, брендированные)" },

  // KPIs Fleet
  "metas.kpi.shAuto":     { es: "SH / Auto (interno)", en: "SH / Car (internal)", ru: "Часы / авто (внутр.)" },
  "metas.kpi.aceptacion": { es: "Aceptación",          en: "Acceptance",          ru: "Принятие" },
  "metas.kpi.utilizacion":{ es: "Utilización",         en: "Utilization",         ru: "Загрузка" },
  "metas.pond":           { es: "ponderado",           en: "weighted",            ru: "взвешенно" },
  "metas.pondViajes":     { es: "ponderado por viajes", en: "weighted by trips",  ru: "взвешенно по поездкам" },
  "metas.soloMeta":       { es: "solo meta",           en: "goal only",           ru: "только цель" },
  "metas.sinActual":      { es: "sin actual medible",  en: "no measurable actual", ru: "нет измеримого факта" },
  "metas.sinPlan":        { es: "Sin Plan",            en: "No Plan",             ru: "Нет плана" },
  "metas.sinKam":         { es: "Sin KAM",             en: "No KAM",              ru: "Без KAM" },
  "metas.todas":          { es: "Todas",               en: "All",                 ru: "Все" },
  "metas.acumMes":        { es: "acumulado mes",       en: "month to date",       ru: "накоплено за месяц" },
  "metas.autosPropios":   { es: "Autos propios (último período): {n} · brandeados {b}",
                            en: "Owned cars (last period): {n} · branded {b}",
                            ru: "Собственные авто (посл. период): {n} · брендированных {b}" },

  // Aviso de escala
  "metas.aviso.titulo":  { es: "Los % de cumplimiento no son comparables en esta escala.",
                           en: "Attainment % are not comparable at this scale.",
                           ru: "Проценты выполнения несопоставимы в этом масштабе." },
  "metas.aviso.cuerpo":  { es: "La meta del mes se compara contra <strong>Conductores Activos de {u}</strong>: un conductor que maneja varios días cuenta una sola vez en el mes, pero acá se lo mide en un período mucho más corto. El porcentaje va a verse bajo aunque el mes vaya bien.",
                           en: "The monthly goal is compared against <strong>Active Drivers over {u}</strong>: a driver working several days counts once in the month, but here they are measured over a much shorter period. The percentage will look low even if the month is going well.",
                           ru: "Цель месяца сравнивается с <strong>активными водителями за {u}</strong>: водитель, работавший несколько дней, в месяце считается один раз, а здесь измеряется за куда более короткий период. Процент будет выглядеть низким, даже если месяц идёт хорошо." },
  "metas.aviso.hint":    { es: "Nuevos+Reactivados y Horas sí acumulan, así que esos avanzan normal. Para leer el cumplimiento real, cambiá la escala a <strong>Mensual</strong>.",
                           en: "New+Reactivated and Hours do accumulate, so those progress normally. To read real attainment, switch the scale to <strong>Monthly</strong>.",
                           ru: "Новые+реактивированные и часы накапливаются, поэтому они растут нормально. Чтобы увидеть реальное выполнение, переключите масштаб на <strong>Ежемесячно</strong>." },
  "metas.aviso.unDia":     { es: "un día",     en: "one day",  ru: "один день" },
  "metas.aviso.unaSemana": { es: "una semana", en: "one week", ru: "одну неделю" },

  "metas.err.admin":  { es: "Operación bloqueada: requiere rol admin.", en: "Blocked: admin role required.", ru: "Операция заблокирована: нужна роль admin." },
  "metas.err.pdf":    { es: "Error al generar PDF: ", en: "Error generating PDF: ", ru: "Ошибка при создании PDF: " },

  // Meses. metas.mes viene de la BD como NOMBRE en espanol y en mayusculas
  // ("JULIO"), asi que sin esto el titulo quedaba "Combined Goals — JULIO".
  // mesLabel() hace la traduccion y deja pasar cualquier valor que no reconozca.
  "mes.enero": { es: "Enero", en: "January", ru: "Январь" },
  "mes.febrero": { es: "Febrero", en: "February", ru: "Февраль" },
  "mes.marzo": { es: "Marzo", en: "March", ru: "Март" },
  "mes.abril": { es: "Abril", en: "April", ru: "Апрель" },
  "mes.mayo": { es: "Mayo", en: "May", ru: "Май" },
  "mes.junio": { es: "Junio", en: "June", ru: "Июнь" },
  "mes.julio": { es: "Julio", en: "July", ru: "Июль" },
  "mes.agosto": { es: "Agosto", en: "August", ru: "Август" },
  "mes.septiembre": { es: "Septiembre", en: "September", ru: "Сентябрь" },
  "mes.octubre": { es: "Octubre", en: "October", ru: "Октябрь" },
  "mes.noviembre": { es: "Noviembre", en: "November", ru: "Ноябрь" },
  "mes.diciembre": { es: "Diciembre", en: "December", ru: "Декабрь" },
  "metas.mesLabel": { es: "Mes:", en: "Month:", ru: "Месяц:" },
  "metas.descargarPDF": { es: "⬇ Descargar PDF", en: "⬇ Download PDF", ru: "⬇ Скачать PDF" },
  "metas.generandoPDF": { es: "Generando...", en: "Generating...", ru: "Создание…" },


  // ── Calculadora (fase 2) ───────────────────────────────────────────────
  // NO se traduce aca la tarjeta compartible (CALC_EXPORT_STR / seccion
  // "Vista compartible por partner"): tiene su PROPIO selector ES/EN/ES-EN
  // porque es lo que se le entrega al partner, independiente del idioma de
  // la herramienta (ver la nota grande al inicio de este archivo).
  "calc.titulo": { es: "Calculadora de metas", en: "Goal Calculator", ru: "Калькулятор целей" },
  "calc.sub":    { es: "Define las metas del próximo mes por línea de negocio · navega por pestañas",
                   en: "Set next month's goals by business line · navigate by tabs",
                   ru: "Задайте цели на следующий месяц по направлениям · переключайтесь по вкладкам" },
  "calc.todosKam":   { es: "Todos los KAMs", en: "All KAMs", ru: "Все KAM" },
  "calc.metasPara":  { es: "📅 Metas para {m} · reparto según {r}",
                       en: "📅 Goals for {m} · split based on {r}",
                       ru: "📅 Цели на {m} · распределение по данным {r}" },
  "calc.estadoCuadre": { es: "Estado (cuadre en vivo)", en: "Status (live check)", ru: "Статус (в реальном времени)" },
  "calc.sinMetas":   { es: "sin metas", en: "no goals", ru: "нет целей" },
  "calc.conMeta":    { es: "con meta", en: "with goal", ru: "с целью" },
  "calc.tabRevisar": { es: "Revisar y compartir", en: "Review & Share", ru: "Проверка и публикация" },
  "calc.recalcular": { es: "↻ Recalcular distribución", en: "↻ Recalculate distribution", ru: "↻ Пересчитать распределение" },
  "calc.recalcularPend": { es: "↻ Recalcular distribución (pendiente)", en: "↻ Recalculate distribution (pending)", ru: "↻ Пересчитать распределение (ожидает)" },

  "calc.metasTotales":  { es: "📥 Metas totales · Agregador (Taxi + TukTuk)", en: "📥 Total goals · Aggregator (Taxi + TukTuk)", ru: "📥 Общие цели · Агрегатор (Такси + ТукТук)" },
  "calc.vaAlCsv":       { es: "VA AL CSV", en: "GOES TO CSV", ru: "ИДЁТ В CSV" },
  "calc.vaAlCsvTip":    { es: "Solo estas metas (AD/SH/N+R) se exportan al CSV de metas",
                          en: "Only these goals (AD/SH/N+R) are exported to the goals CSV",
                          ru: "В CSV целей экспортируются только эти цели (AD/SH/N+R)" },
  "calc.metasPctKam":   { es: "Metas % KAM (no se reparten por partner)", en: "% KAM goals (not split by partner)", ru: "% цели KAM (не распределяются по партнёрам)" },
  "calc.metasPctKamSub":{ es: "Metas % a nivel KAM (referencia); no se distribuyen por partner ni van al CSV.",
                          en: "% goals at KAM level (reference only); not split by partner and not exported to CSV.",
                          ru: "% цели на уровне KAM (справочно); не распределяются по партнёрам и не идут в CSV." },
  "calc.activeDrivers": { es: "Active Drivers", en: "Active Drivers", ru: "Активные водители" },
  "calc.supplyHours":   { es: "Supply Hours", en: "Supply Hours", ru: "Часы на линии" },
  "calc.newReact":      { es: "New + Reactivated", en: "New + Reactivated", ru: "Новые + реактивированные" },
  "calc.otherProj":     { es: "Other Projects (%)", en: "Other Projects (%)", ru: "Другие проекты (%)" },
  "calc.fleetA2":       { es: "Fleet drivers A2 (%)", en: "Fleet drivers A2 (%)", ru: "Водители Fleet A2 (%)" },

  "calc.distribPartner":  { es: "Distribución por partner · {m}", en: "Distribution by partner · {m}", ru: "Распределение по партнёрам · {m}" },
  "calc.distribSub":      { es: "Meta KAM × % Cartera (último mes) · editable · Fleet incluido en el reparto",
                            en: "KAM goal × % Portfolio (last month) · editable · Fleet included in the split",
                            ru: "Цель KAM × % портфеля (посл. месяц) · редактируемо · Fleet включён в распределение" },
  "calc.hintSinMetas":    { es: "⚠️ Ingresa tus metas totales arriba y presiona <strong>\"↻ Recalcular distribución\"</strong> para repartirlas aquí.",
                            en: "⚠️ Enter your total goals above and press <strong>\"↻ Recalculate distribution\"</strong> to split them here.",
                            ru: "⚠️ Введите общие цели выше и нажмите <strong>«↻ Пересчитать распределение»</strong>, чтобы распределить их здесь." },
  "calc.hintManual":      { es: "⚠️ {n} partner(s) sin actividad Taxi el último mes (marcados <strong>FIJAR MANUAL</strong>): ponles la meta a mano.",
                            en: "⚠️ {n} partner(s) with no Taxi activity last month (flagged <strong>SET MANUALLY</strong>): set their goal by hand.",
                            ru: "⚠️ {n} партнёр(ов) без активности такси в прошлом месяце (отмечены <strong>ВРУЧНУЮ</strong>): задайте цель вручную." },
  "calc.col.partner":     { es: "Partner", en: "Partner", ru: "Партнёр" },
  "calc.col.ciudad":      { es: "Ciudad", en: "City", ru: "Город" },
  "calc.sinDatos":        { es: "Sin datos.", en: "No data.", ru: "Нет данных." },
  "calc.baseReparto":     { es: "Base del reparto ({m}, Taxi + TukTuk): {ad} AD · {sh} SH · {nr} N+R. El goal que cargues tiene que estar en esta misma base.",
                            en: "Split base ({m}, Taxi + TukTuk): {ad} AD · {sh} SH · {nr} N+R. The goal you enter must use this same base.",
                            ru: "База распределения ({m}, Такси + ТукТук): {ad} AD · {sh} часов · {nr} N+R. Цель, которую вы вводите, должна быть в этой же базе." },
  "calc.sumaDist":        { es: "Suma distribuida (incl. Fleet)", en: "Distributed sum (incl. Fleet)", ru: "Распределённая сумма (вкл. Fleet)" },
  "calc.metaKamCuadre":   { es: "Meta KAM · cuadre", en: "KAM goal · check", ru: "Цель KAM · сверка" },
  "calc.sinMeta":         { es: "sin meta", en: "no goal", ru: "нет цели" },
  "calc.cuadra":          { es: "✓ cuadra", en: "✓ matches", ru: "✓ совпадает" },
  "calc.valorReal":       { es: "Valor real del último mes", en: "Actual value, last month", ru: "Факт за последний месяц" },
  "calc.pesoCiudad":      { es: "Peso en la ciudad (todos los KAMs)", en: "Weight in the city (all KAMs)", ru: "Доля в городе (все KAM)" },
  "calc.pesoCartera":     { es: "Peso en tu cartera KAM", en: "Weight in your KAM portfolio", ru: "Доля в вашем портфеле KAM" },
  "calc.pesoLeyenda":     { es: "% Ciudad = peso real de tu partner en la ciudad (todos los partners Yango) · % Cartera = peso en tu KAM (base del reparto)",
                            en: "% City = your partner's real weight in the city (all Yango partners) · % Portfolio = weight in your KAM (split base)",
                            ru: "% Города = реальная доля партнёра в городе (все партнёры Yango) · % Портфеля = доля в вашем KAM (база распределения)" },

  "calc.metasFleet":     { es: "Metas Fleet (KPIs propios)", en: "Fleet Goals (own KPIs)", ru: "Цели Fleet (собственные KPI)" },
  "calc.metasFleetSub":  { es: "Solo partners marcados Fleet · SH/Auto, Aceptación, Utilización · van a la tarjeta compartible",
                           en: "Fleet-flagged partners only · SH/Car, Acceptance, Utilization · shown on the shareable card",
                           ru: "Только партнёры с меткой Fleet · часы/авто, принятие, загрузка · попадают в карточку" },
  "calc.shAuto3m":       { es: "SH/Auto (3m)", en: "SH/Car (3mo)", ru: "Часы/авто (3мес)" },
  "calc.metaShAuto":     { es: "Meta SH/Auto", en: "SH/Car Goal", ru: "Цель часы/авто" },
  "calc.aceptacion3m":   { es: "Aceptación (3m)", en: "Acceptance (3mo)", ru: "Принятие (3мес)" },
  "calc.metaAceptPct":   { es: "Meta Acept. %", en: "Acceptance Goal %", ru: "Цель принятия %" },
  "calc.metaUtilPct":    { es: "Meta Utiliz. %", en: "Utilization Goal %", ru: "Цель загрузки %" },
  "calc.sinFleet":       { es: "No hay partners marcados como Fleet en este KAM.", en: "No Fleet-flagged partners for this KAM.", ru: "У этого KAM нет партнёров с меткой Fleet." },
  "calc.utilPrellenada": { es: "💡 Utilización viene pre-llenada en <strong>85%</strong> (active cars / total) — ajústala o bórrala donde no aplique. Estos KPIs aparecen en la tarjeta compartible (pestaña <strong>{r}</strong>).",
                           en: "💡 Utilization is pre-filled at <strong>85%</strong> (active cars / total) — adjust or clear it where it doesn't apply. These KPIs appear on the shareable card (<strong>{r}</strong> tab).",
                           ru: "💡 Загрузка предзаполнена <strong>85%</strong> (активные авто / всего) — измените или очистите там, где не применимо. Эти KPI попадают в карточку (вкладка <strong>{r}</strong>)." },

  "calc.actualizarCompartir":    { es: "Actualizar y compartir", en: "Update and share", ru: "Обновить и поделиться" },
  "calc.actualizarCompartirSub": { es: "Guarda las metas del KAM directo en la base de datos, descarga la plantilla o comparte la tarjeta",
                                   en: "Save the KAM's goals directly to the database, download the template, or share the card",
                                   ru: "Сохраните цели KAM в базу данных, скачайте шаблон или поделитесь карточкой" },
  "calc.btnGuardarAdmin": { es: "💾 Actualizar metas (requiere admin)", en: "💾 Update goals (admin required)", ru: "💾 Обновить цели (нужен admin)" },
  "calc.btnGuardar":      { es: "💾 Actualizar metas (guardar en BD)", en: "💾 Update goals (save to DB)", ru: "💾 Обновить цели (сохранить в БД)" },
  "calc.requiereAdmin":   { es: "Requiere permisos de administrador", en: "Requires admin permissions", ru: "Требуются права администратора" },
  "calc.btnDescargarCsv": { es: "📄 Descargar plantilla (CSV)", en: "📄 Download template (CSV)", ru: "📄 Скачать шаблон (CSV)" },
  "calc.btnResetEdits":   { es: "↺ Reset ediciones", en: "↺ Reset edits", ru: "↺ Сбросить правки" },
  "calc.kamNote":         { es: "⚠️ Para <strong>guardar</strong>, elige un KAM específico arriba (no \"Todos los KAMs\").",
                            en: "⚠️ To <strong>save</strong>, pick a specific KAM above (not \"All KAMs\").",
                            ru: "⚠️ Чтобы <strong>сохранить</strong>, выберите конкретного KAM выше (не «Все KAM»)." },
  "calc.actualizarHint":  { es: "💡 <strong>Actualizar metas</strong> guarda Agregador (Taxi + TukTuk) + Fleet del KAM seleccionado para el próximo mes, directo en la BD (requiere admin). <strong>Reemplaza</strong> las metas de ese mes (no se acumulan): si vuelves a guardar el mismo mes, se sobrescriben. La <strong>plantilla CSV</strong> trae las mismas líneas por si prefieres subirla en Configuración → Metas.",
                           en: "💡 <strong>Update goals</strong> saves the selected KAM's Aggregator (Taxi + TukTuk) + Fleet goals for next month, directly to the DB (admin required). It <strong>replaces</strong> that month's goals (they don't accumulate): saving the same month again overwrites it. The <strong>CSV template</strong> has the same rows if you'd rather upload it in Settings → Goals.",
                           ru: "💡 <strong>Обновить цели</strong> сохраняет цели Агрегатора (Такси + ТукТук) + Fleet выбранного KAM на следующий месяц прямо в БД (нужен admin). Это <strong>заменяет</strong> цели этого месяца (они не накапливаются): повторное сохранение того же месяца перезаписывает его. <strong>Шаблон CSV</strong> содержит те же строки, если вы предпочитаете загрузить его в Настройки → Цели." },

  "calc.vistaCompartible":     { es: "Vista compartible por partner", en: "Shareable partner view", ru: "Карточка партнёра для отправки" },
  "calc.sinPartnersFiltro":    { es: "Sin partners en este filtro", en: "No partners in this filter", ru: "Нет партнёров по этому фильтру" },
  "calc.sinPartnersKam":       { es: "No hay partners en el KAM seleccionado con datos.", en: "No partners with data for the selected KAM.", ru: "У выбранного KAM нет партнёров с данными." },

  "calc.generandoImagen":   { es: "Generando imagen...", en: "Generating image...", ru: "Создание изображения…" },
  "calc.imagenDescargada":  { es: "Imagen descargada", en: "Image downloaded", ru: "Изображение скачано" },
  "calc.errorGuardarMetas": { es: "Error al guardar metas: ", en: "Error saving goals: ", ru: "Ошибка сохранения целей: " },
  "calc.error":             { es: "Error: ", en: "Error: ", ru: "Ошибка: " },
  "calc.guardandoMetas":    { es: "Guardando metas...", en: "Saving goals...", ru: "Сохранение целей…" },
  "calc.sinMetasParaGuardar": { es: "No hay metas para guardar en este KAM.", en: "No goals to save for this KAM.", ru: "Нет целей для сохранения у этого KAM." },
  "calc.requiereKamAdmin":  { es: "Guardar metas requiere rol de KAM o administrador.", en: "Saving goals requires the KAM or admin role.", ru: "Для сохранения целей нужна роль KAM или администратора." },
  "calc.elegirKamEspecifico": { es: "Elige un KAM específico (no \"Todos los KAMs\") para guardar sus metas.",
                                en: "Pick a specific KAM (not \"All KAMs\") to save their goals.",
                                ru: "Выберите конкретного KAM (не «Все KAM»), чтобы сохранить его цели." },
  "calc.sinPermisosGuardar": { es: "No tienes permisos para guardar metas (requiere admin).", en: "You don't have permission to save goals (admin required).", ru: "У вас нет прав на сохранение целей (нужен admin)." },
  "calc.errorRed":          { es: "No se guardó nada: falló la conexión con la base de datos.\n\nSe reintentó una vez automáticamente. Revisa tu conexión y vuelve a intentar — como no llegó a escribirse, tus metas actuales están intactas.",
                              en: "Nothing was saved: the connection to the database failed.\n\nOne automatic retry was attempted. Check your connection and try again — since nothing was written, your current goals are untouched.",
                              ru: "Ничего не сохранено: не удалось подключиться к базе данных.\n\nБыла одна автоматическая попытка повтора. Проверьте соединение и попробуйте снова — запись не прошла, ваши текущие цели не тронуты." },


  // ── Data Raw (fase 2) ──────────────────────────────────────────────────
  "raw.titulo":     { es: "Data Raw", en: "Raw Data", ru: "Сырые данные" },
  "raw.sub":        { es: "Todos los registros cargados · {t} total · {d} en dashboard · {e} excluidos",
                      en: "All loaded records · {t} total · {d} in dashboard · {e} excluded",
                      ru: "Все загруженные записи · {t} всего · {d} на дашборде · {e} исключено" },
  "raw.viewData":    { es: "📊 Registros", en: "📊 Records", ru: "📊 Записи" },
  "raw.viewFlotas":  { es: "🚚 Flotas (CLID → Nombre)", en: "🚚 Fleets (CLID → Name)", ru: "🚚 Автопарки (CLID → Имя)" },
  "raw.viewRecon":   { es: "🧾 Conciliación (CLID → db_id)", en: "🧾 Reconciliation (CLID → db_id)", ru: "🧾 Сверка (CLID → db_id)" },
  "raw.buscarPartnerKam":  { es: "Buscar partner o KAM...", en: "Search partner or KAM...", ru: "Поиск партнёра или KAM…" },
  "raw.todasCiudades":     { es: "Todas las ciudades", en: "All cities", ru: "Все города" },
  "raw.exportarCsv":       { es: "⬇ Exportar CSV", en: "⬇ Export CSV", ru: "⬇ Экспорт CSV" },
  "raw.registrosPaginas":  { es: "{n} registro(s) · {p} página(s)", en: "{n} record(s) · {p} page(s)", ru: "{n} запис(ей) · {p} страниц(ы)" },
  "raw.col.fecha":     { es: "Fecha", en: "Date", ru: "Дата" },
  "raw.col.comision":  { es: "Comisión", en: "Commission", ru: "Комиссия" },
  "raw.col.viajes":    { es: "Viajes", en: "Trips", ru: "Поездки" },
  "raw.total":         { es: "TOTAL ({n} filas)", en: "TOTAL ({n} rows)", ru: "ИТОГО ({n} строк)" },
  "raw.mostrandoPrimeros": { es: "Mostrando primeros {n} de {t}. Usá el buscador para filtrar.",
                             en: "Showing the first {n} of {t}. Use the search box to filter.",
                             ru: "Показаны первые {n} из {t}. Используйте поиск для фильтрации." },

  "raw.vistaFlotas":    { es: "Vista Flotas", en: "Fleet View", ru: "Обзор автопарков" },
  "raw.vistaFlotasSub": { es: "{n} CLID(s) · {c} configurados en partners · {s} sin configurar · {i} inactiva(s)",
                          en: "{n} CLID(s) · {c} configured in partners · {s} unconfigured · {i} inactive",
                          ru: "{n} CLID · {c} настроено в partners · {s} без настройки · {i} неактивных" },
  "raw.fuenteVerdad":   { es: "Fuente de verdad: Configuración (tabla <code>partners</code>). El nombre y KAM que ves en el dashboard vienen de allí. Esta vista permite <strong>marcar CLIDs como inactivos</strong> (para excluir flotas de otras unidades de negocio) y anotar la ciudad. El \"Nombre Excel\" es informativo: sirve para detectar tuktuk/cargo/delivery/flotas antiguas. Si necesitás cambiar nombre o KAM, hacelo en <strong>Configuración</strong>.",
                        en: "Source of truth: Settings (<code>partners</code> table). The name and KAM you see on the dashboard come from there. This view lets you <strong>flag CLIDs as inactive</strong> (to exclude fleets from other business units) and note the city. The \"Excel Name\" is informational: it helps spot tuktuk/cargo/delivery/old fleets. To change name or KAM, do it in <strong>Settings</strong>.",
                        ru: "Источник истины: Настройки (таблица <code>partners</code>). Имя и KAM, которые вы видите на дашборде, берутся оттуда. Здесь можно <strong>пометить CLID как неактивный</strong> (чтобы исключить автопарки других направлений) и указать город. \"Имя из Excel\" — справочное: помогает выявить тук-тук/грузовые/доставку/старые автопарки. Чтобы изменить имя или KAM, сделайте это в <strong>Настройках</strong>." },
  "raw.fleetroomNota":  { es: "🛺 Si un CLID trae <strong>fleetrooms</strong> (sub-flotas con <code>db_id</code>), se listan debajo y se marcan <strong>por fleetroom</strong>: <strong>Fleet</strong>, <strong>TukTuk</strong> o <strong>Excluir de Taxi</strong> (ej. delivery). Así solo esa sub-flota entra a TukTuk / sale de Taxi, sin afectar a las demás del mismo CLID.",
                        en: "🛺 If a CLID has <strong>fleetrooms</strong> (sub-fleets with <code>db_id</code>), they're listed below and flagged <strong>per fleetroom</strong>: <strong>Fleet</strong>, <strong>TukTuk</strong>, or <strong>Exclude from Taxi</strong> (e.g. delivery). That way only that sub-fleet enters TukTuk / leaves Taxi, without affecting the others under the same CLID.",
                        ru: "🛺 Если у CLID есть <strong>fleetrooms</strong> (подпарки с <code>db_id</code>), они перечислены ниже и помечаются <strong>по fleetroom</strong>: <strong>Fleet</strong>, <strong>TukTuk</strong> или <strong>Исключить из такси</strong> (напр. доставка). Так только этот подпарк попадает в ТукТук / выходит из такси, не затрагивая остальные под тем же CLID." },
  "raw.buscarCPKC":      { es: "Buscar CLID, partner, KAM, ciudad...", en: "Search CLID, partner, KAM, city...", ru: "Поиск CLID, партнёра, KAM, города…" },
  "raw.buscarCPK":        { es: "Buscar CLID, partner o KAM...", en: "Search CLID, partner or KAM...", ru: "Поиск CLID, партнёра или KAM…" },
  "raw.patronesTuktuk":  { es: "🛺 Patrones TukTuk (sugerencia):", en: "🛺 TukTuk patterns (suggestion):", ru: "🛺 Паттерны ТукТук (подсказка):" },
  "raw.quitar":          { es: "Quitar", en: "Remove", ru: "Убрать" },
  "raw.ejMototaxi":      { es: "ej. mototaxi", en: "e.g. mototaxi", ru: "напр. мототакси" },
  "raw.agregar":         { es: "+ Agregar", en: "+ Add", ru: "+ Добавить" },

  "raw.col.nombreExcel":     { es: "Nombre Excel", en: "Excel Name", ru: "Имя из Excel" },
  "raw.col.nombreEfectivo":  { es: "Nombre", en: "Name", ru: "Имя" },
  "raw.col.efectivo":        { es: "EFECTIVO", en: "EFFECTIVE", ru: "ФАКТИЧЕСКИЙ" },
  "raw.col.excluirTaxi":     { es: "Excluir<br>Taxi", en: "Exclude<br>Taxi", ru: "Искл.<br>Такси" },
  "raw.col.estado":          { es: "Estado", en: "Status", ru: "Статус" },
  "raw.col.accion":          { es: "Acción", en: "Action", ru: "Действие" },
  "raw.fleetTip":            { es: "Fleet", en: "Fleet", ru: "Fleet" },
  "raw.tuktukTip":           { es: "TukTuk", en: "TukTuk", ru: "ТукТук" },
  "raw.excluirTaxiTip":      { es: "Excluir de Taxi solo aplica por fleetroom", en: "Exclude from Taxi only applies per fleetroom", ru: "Исключение из такси применяется только по fleetroom" },
  "raw.nombreSugiereTuktukExcel": { es: "El Nombre Excel sugiere TukTuk", en: "The Excel Name suggests TukTuk", ru: "Имя из Excel предполагает ТукТук" },
  "raw.nombreSugiereTuktuk":      { es: "El nombre sugiere TukTuk", en: "The name suggests TukTuk", ru: "Имя предполагает ТукТук" },
  "raw.sinNombre":           { es: "(sin nombre)", en: "(no name)", ru: "(без имени)" },
  "raw.fleetroomAbbr":       { es: "↓ fleetroom", en: "↓ fleetroom", ru: "↓ fleetroom" },

  "raw.sinCiudad":       { es: "— sin ciudad —", en: "— no city —", ru: "— без города —" },
  "raw.sinKamOpt":       { es: "— sin KAM —", en: "— no KAM —", ru: "— без KAM —" },
  "raw.opcionalFallback":{ es: "opcional — fallback", en: "optional — fallback", ru: "опционально — резерв" },
  "raw.avisoEnPartners": { es: "⚠ Este CLID está configurado en partners como <strong>{n}</strong>. El valor de aquí solo se usaría si lo borrás de Configuración.",
                           en: "⚠ This CLID is configured in partners as <strong>{n}</strong>. The value here would only be used if you remove it from Settings.",
                           ru: "⚠ Этот CLID настроен в partners как <strong>{n}</strong>. Значение здесь будет использовано, только если вы удалите его из Настроек." },
  "raw.avisoNoEnPartners": { es: "✓ Este CLID NO está en partners — este nombre será el que use el dashboard.",
                             en: "✓ This CLID is NOT in partners — this name is the one the dashboard will use.",
                             ru: "✓ Этого CLID нет в partners — дашборд будет использовать это имя." },
  "raw.avisoKamPartners":  { es: "⚠ KAM <strong>{k}</strong> configurado en partners. Este KAM solo se usaría como fallback.",
                             en: "⚠ KAM <strong>{k}</strong> is configured in partners. This KAM would only be used as a fallback.",
                             ru: "⚠ KAM <strong>{k}</strong> настроен в partners. Этот KAM будет использован только как резерв." },
  "raw.activa":     { es: "Activa", en: "Active", ru: "Активна" },
  "raw.inactiva":   { es: "Inactiva", en: "Inactive", ru: "Неактивна" },
  "raw.guardar":    { es: "✓ Guardar", en: "✓ Save", ru: "✓ Сохранить" },
  "raw.inactivaBadge":  { es: "🚫 Inactiva", en: "🚫 Inactive", ru: "🚫 Неактивна" },
  "raw.sinConfig":      { es: "Sin config", en: "No config", ru: "Без настройки" },
  "raw.activaBadge":    { es: "✓ Activa", en: "✓ Active", ru: "✓ Активна" },
  "raw.desdeConfig":    { es: "desde Configuración", en: "from Settings", ru: "из настроек" },
  "raw.fallbackFlotas": { es: "fallback flotas", en: "fleet fallback", ru: "резерв автопарков" },
  "raw.soloExcel":      { es: "solo Excel", en: "Excel only", ru: "только Excel" },
  "raw.editarTip":      { es: "Editar ciudad/activo/fallback", en: "Edit city/active/fallback", ru: "Изменить город/статус/резерв" },
  "raw.marcarInactiva": { es: "Marcar inactiva", en: "Mark inactive", ru: "Пометить неактивной" },
  "raw.reactivar":      { es: "Reactivar", en: "Reactivate", ru: "Восстановить" },
  "raw.marcarInactivaCrear": { es: "Marcar inactiva (crear flota)", en: "Mark inactive (create fleet)", ru: "Пометить неактивной (создать автопарк)" },

  "raw.recon":       { es: "Conciliación (CLID → db_id)", en: "Reconciliation (CLID → db_id)", ru: "Сверка (CLID → db_id)" },
  "raw.sinDatosCargados": { es: "Sin datos cargados.", en: "No data loaded.", ru: "Данные не загружены." },
  "raw.reconSub":    { es: "{n} CLID(s) · {o} sub-flota(s) omitida(s) del dashboard · clic en un CLID para desglosar",
                       en: "{n} CLID(s) · {o} sub-fleet(s) excluded from the dashboard · click a CLID to break it down",
                       ru: "{n} CLID · {o} подпарк(ов) исключено из дашборда · нажмите на CLID для детализации" },
  "raw.reconResumen":  { es: "Resumen por <strong>CLID</strong> con desglose por <strong>db_id</strong> (fleetroom). Números con <strong>K/M y 2 decimales</strong> — el valor exacto está en el <em>hover</em> y en el CSV. Las sub-flotas <strong>🛺 TukTuk</strong> y <strong>⛔ Excluidas</strong> NO entran al dashboard (Taxi) y van resaltadas; <strong>🚗 Fleet</strong> sí entra (es subconjunto de Taxi).",
                       en: "Summary by <strong>CLID</strong> broken down by <strong>db_id</strong> (fleetroom). Numbers with <strong>K/M and 2 decimals</strong> — the exact value is in the <em>hover</em> and the CSV. <strong>🛺 TukTuk</strong> and <strong>⛔ Excluded</strong> sub-fleets do NOT enter the dashboard (Taxi) and are highlighted; <strong>🚗 Fleet</strong> does enter (it's a subset of Taxi).",
                       ru: "Сводка по <strong>CLID</strong> с детализацией по <strong>db_id</strong> (fleetroom). Числа в формате <strong>K/M с 2 знаками</strong> — точное значение при наведении и в CSV. Подпарки <strong>🛺 ТукТук</strong> и <strong>⛔ Исключённые</strong> НЕ попадают в дашборд (такси) и выделены; <strong>🚗 Fleet</strong> попадает (это подмножество такси)." },
  "raw.reconAviso":    { es: "<strong>Ojo:</strong> tenés un rango de varios períodos — AD y autos se <strong>suman</strong> entre ellos. Para cuadrar contra un Excel de un período, poné el mismo período en \"Desde\" y \"Hasta\".",
                         en: "<strong>Heads up:</strong> your range spans several periods — AD and cars get <strong>summed</strong> across them. To match a single-period Excel, set the same period in \"From\" and \"To\".",
                         ru: "<strong>Внимание:</strong> у вас диапазон из нескольких периодов — AD и авто <strong>суммируются</strong> между ними. Чтобы сверить с Excel за один период, укажите один и тот же период в «С» и «По»." },
  "raw.expandirTodo": { es: "Expandir todo", en: "Expand all", ru: "Развернуть всё" },
  "raw.colapsar":     { es: "Colapsar", en: "Collapse", ru: "Свернуть" },
  "raw.col.clidFlota":   { es: "CLID / Flota", en: "CLID / Fleet", ru: "CLID / Автопарк" },
  "raw.col.nuevos":      { es: "Nuevos", en: "New", ru: "Новые" },
  "raw.col.react":       { es: "React", en: "React.", ru: "Реакт." },
  "raw.col.shAutoFleet": { es: "SH/auto<br>fleet", en: "SH/car<br>fleet", ru: "Часы/авто<br>fleet" },
  "raw.col.acept":       { es: "Acept.", en: "Accept.", ru: "Принятие" },
  "raw.col.autosFleet":  { es: "Autos<br>fleet", en: "Cars<br>fleet", ru: "Авто<br>fleet" },
  "raw.sinNombreParen":  { es: "(sin nombre)", en: "(no name)", ru: "(без имени)" },
  "raw.sinKamParen":     { es: "sin KAM", en: "no KAM", ru: "без KAM" },
  "raw.fleetroomsCount": { es: "{n} fleetroom(s)", en: "{n} fleetroom(s)", ru: "{n} fleetroom(ов)" },
  "raw.omite":           { es: "omite {n} · {ad} AD", en: "excludes {n} · {ad} AD", ru: "исключает {n} · {ad} AD" },
  "raw.omiteTip":        { es: "{n} sub-flota(s) fuera del dashboard · AD omitido: {ad}",
                           en: "{n} sub-fleet(s) outside the dashboard · AD excluded: {ad}",
                           ru: "{n} подпарк(ов) вне дашборда · AD исключено: {ad}" },
  "raw.legacySinDbId":   { es: "(legacy s/ db_id)", en: "(legacy, no db_id)", ru: "(устаревшее, без db_id)" },
  "raw.pagina":       { es: "Página {a} de {b}", en: "Page {a} of {b}", ru: "Страница {a} из {b}" },
  "raw.sinFlotas":    { es: "💡 Aún no subiste ninguna flota. Subí un Excel con columnas <code>CLID | CIUDAD | NOMBRE_ASIGNADO | KAM | ACTIVO</code> desde <strong>{r}</strong>.",
                        en: "💡 You haven't uploaded any fleet yet. Upload an Excel with columns <code>CLID | CIUDAD | NOMBRE_ASIGNADO | KAM | ACTIVO</code> from <strong>{r}</strong>.",
                        ru: "💡 Вы ещё не загрузили ни одного автопарка. Загрузите Excel со столбцами <code>CLID | CIUDAD | NOMBRE_ASIGNADO | KAM | ACTIVO</code> в разделе <strong>{r}</strong>." },
  "raw.rutaFlotasUpload": { es: "Actualizar información → Flotas", en: "Update data → Fleets", ru: "Обновить данные → Автопарки" },

  "raw.errFilaEditada": { es: "No se pudo leer la fila editada.", en: "Couldn't read the edited row.", ru: "Не удалось прочитать изменённую строку." },
  "raw.guardando":      { es: "Guardando...", en: "Saving...", ru: "Сохранение…" },
  "raw.flotaActualizada": { es: "Flota actualizada ✓", en: "Fleet updated ✓", ru: "Автопарк обновлён ✓" },
  "raw.errorGuardar":   { es: "Error al guardar: ", en: "Error saving: ", ru: "Ошибка сохранения: " },
  "raw.reactivando":    { es: "Reactivando...", en: "Reactivating...", ru: "Восстановление…" },
  "raw.marcandoInactiva": { es: "Marcando inactiva...", en: "Marking inactive...", ru: "Пометка неактивной…" },
  "raw.flotaReactivada": { es: "Flota reactivada ✓", en: "Fleet reactivated ✓", ru: "Автопарк восстановлен ✓" },
  "raw.flotaInactiva":   { es: "Flota marcada inactiva ✓", en: "Fleet marked inactive ✓", ru: "Автопарк помечен неактивным ✓" },
  "raw.error":           { es: "Error: ", en: "Error: ", ru: "Ошибка: " },
  "raw.actualizado":     { es: "Actualizado ✓", en: "Updated ✓", ru: "Обновлено ✓" },
  "raw.yaEnLista":       { es: '"{w}" ya está en la lista.', en: '"{w}" is already in the list.', ru: '«{w}» уже в списке.' },
  "raw.agregadoTuktuk":  { es: '"{w}" agregado a patrones TukTuk ✓', en: '"{w}" added to TukTuk patterns ✓', ru: '«{w}» добавлен в паттерны ТукТук ✓' },
  "raw.eliminadoTuktuk": { es: '"{w}" eliminado de patrones TukTuk ✓', en: '"{w}" removed from TukTuk patterns ✓', ru: '«{w}» удалён из паттернов ТукТук ✓' },
  "raw.anterior":   { es: "← Anterior", en: "← Previous", ru: "← Назад" },
  "raw.siguiente":  { es: "Siguiente →", en: "Next →", ru: "Далее →" },


  // ── Configuración (fase 2) ─────────────────────────────────────────────
  "cfg.titulo": { es: "Configuración", en: "Settings", ru: "Настройки" },
  "cfg.sub":    { es: "Partners, usuarios y mantenimiento del dashboard",
                  en: "Partners, users, and dashboard maintenance",
                  ru: "Партнёры, пользователи и обслуживание дашборда" },
  "cfg.secPartners":      { es: "Partners", en: "Partners", ru: "Партнёры" },
  "cfg.secUsuarios":      { es: "Usuarios y Accesos", en: "Users & Access", ru: "Пользователи и доступ" },
  "cfg.secMonitoreo":     { es: "Monitoreo", en: "Monitoring", ru: "Мониторинг" },
  "cfg.secMantenimiento": { es: "Mantenimiento", en: "Maintenance", ru: "Обслуживание" },
  "cfg.cargaPartners":    { es: "Carga el archivo <strong>Partners</strong> para configurar CLIDs", en: "Upload the <strong>Partners</strong> file to configure CLIDs", ru: "Загрузите файл <strong>Partners</strong>, чтобы настроить CLID" },
  "cfg.cargaPartnersSub": { es: "Hoja DATOS con columnas: CLID | KAM | PARTNER", en: "DATOS sheet with columns: CLID | KAM | PARTNER", ru: "Лист DATOS со столбцами: CLID | KAM | PARTNER" },

  "cfg.monitoreoTitulo": { es: "📡 Monitoreo de uso", en: "📡 Usage monitoring", ru: "📡 Мониторинг использования" },
  "cfg.monitoreoSub":    { es: "Quién entra al dashboard y cuándo (con foco en las cuentas de partner), y el registro de cambios sobre los datos — lo escriben triggers de Postgres, así que no se puede alterar desde la aplicación.",
                           en: "Who accesses the dashboard and when (with a focus on partner accounts), and the data change log — written by Postgres triggers, so it can't be altered from the app.",
                           ru: "Кто и когда заходит на дашборд (с акцентом на аккаунты партнёров), и журнал изменений данных — его пишут триггеры Postgres, поэтому изменить из приложения нельзя." },
  "cfg.usuariosTitulo":  { es: "👥 Usuarios y Accesos", en: "👥 Users & Access", ru: "👥 Пользователи и доступ" },
  "cfg.usuariosSub":     { es: "Roles (admin / kam / viewer / partner), permisos extra por usuario y —para partners— qué CLIDs puede ver cada uno. Un partner sin CLIDs asignados no ve ningún dato: es el comportamiento seguro por defecto.",
                           en: "Roles (admin / kam / viewer / partner), extra per-user permissions, and — for partners — which CLIDs each one can see. A partner with no assigned CLIDs sees no data: that's the safe default.",
                           ru: "Роли (admin / kam / viewer / partner), дополнительные права по пользователю и — для партнёров — какие CLID видит каждый. Партнёр без назначенных CLID не видит данных: это безопасное поведение по умолчанию." },

  "cfg.declineTitulo":  { es: "🔔 Alerta de Declive Consecutivo", en: "🔔 Consecutive Decline Alert", ru: "🔔 Оповещение о падении подряд" },
  "cfg.metrica":        { es: "Métrica", en: "Metric", ru: "Метрика" },
  "cfg.semanasConsec":  { es: "Semanas consecutivas", en: "Consecutive weeks", ru: "Недель подряд" },
  "cfg.nSemanas":       { es: "{n} semanas", en: "{n} weeks", ru: "{n} недель" },
  "cfg.declineAviso":   { es: "Se mostrará el badge {b} en la tabla cuando un partner tenga <strong>{n}</strong> períodos seguidos de baja en <strong>{m}</strong>.",
                          en: "The {b} badge will show in the table when a partner has <strong>{n}</strong> consecutive periods of decline in <strong>{m}</strong>.",
                          ru: "Значок {b} появится в таблице, когда у партнёра будет <strong>{n}</strong> периодов подряд со снижением по <strong>{m}</strong>." },

  "cfg.eliminarTitulo": { es: "🗑️ Eliminar Datos", en: "🗑️ Delete Data", ru: "🗑️ Удалить данные" },
  "cfg.eliminarSub":    { es: "Borra registros de la base de datos. Útil cuando subiste un Excel con error y quieres re-subir. Si dejas el mes vacío, borra <strong>TODA</strong> la tabla. <strong>Acción irreversible.</strong>",
                          en: "Deletes records from the database. Useful when you uploaded an Excel with an error and want to re-upload. If you leave the month empty, it deletes the <strong>ENTIRE</strong> table. <strong>Irreversible action.</strong>",
                          ru: "Удаляет записи из базы данных. Полезно, если вы загрузили Excel с ошибкой и хотите загрузить заново. Если оставить месяц пустым, удалится <strong>ВСЯ</strong> таблица. <strong>Необратимое действие.</strong>" },
  "cfg.tabla":          { es: "Tabla", en: "Table", ru: "Таблица" },
  "cfg.mesOpcional":    { es: "Mes (opcional)", en: "Month (optional)", ru: "Месяц (опционально)" },
  "cfg.mesVacio":       { es: "2026-04 o vacío", en: "2026-04 or empty", ru: "2026-04 или пусто" },
  "cfg.btnEliminar":    { es: "🗑️ Eliminar", en: "🗑️ Delete", ru: "🗑️ Удалить" },

  "cfg.fleetExtTitulo": { es: "🔄 Fleet Externo — Sincronización", en: "🔄 External Fleet — Sync", ru: "🔄 Внешний автопарк — синхронизация" },
  "cfg.fleetExtSub":    { es: "Copia semanal (lunes) de las tablas de flota externa hacia <code>fleetext_*</code> en este proyecto. Corre en GitHub Actions, no en el navegador — este botón solo la adelanta.",
                          en: "Weekly (Monday) copy of the external fleet tables into <code>fleetext_*</code> on this project. Runs on GitHub Actions, not in the browser — this button only triggers it early.",
                          ru: "Еженедельная (по понедельникам) копия таблиц внешнего автопарка в <code>fleetext_*</code> этого проекта. Выполняется в GitHub Actions, не в браузере — эта кнопка только запускает раньше срока." },
  "cfg.sincronizarAhora": { es: "🔄 Sincronizar ahora", en: "🔄 Sync now", ru: "🔄 Синхронизировать сейчас" },
  "cfg.disparando":       { es: "Disparando...", en: "Triggering...", ru: "Запуск…" },
  "cfg.syncDisparada":    { es: "Sincronización disparada ✓", en: "Sync triggered ✓", ru: "Синхронизация запущена ✓" },
  "cfg.errorSync":        { es: "Error al disparar la sincronización: ", en: "Error triggering sync: ", ru: "Ошибка запуска синхронизации: " },

  "cfg.clidsAsignados":  { es: "CLIDs asignados", en: "assigned CLIDs", ru: "назначено CLID" },
  "cfg.partnersClids":   { es: "👥 Partners & CLIDs", en: "👥 Partners & CLIDs", ru: "👥 Партнёры и CLID" },
  "cfg.buscarCPK":       { es: "Buscar CLID, partner o KAM...", en: "Search CLID, partner or KAM...", ru: "Поиск CLID, партнёра или KAM…" },
  "cfg.col.fleet":       { es: "Fleet", en: "Fleet", ru: "Fleet" },
  "cfg.col.acciones":    { es: "Acciones", en: "Actions", ru: "Действия" },
  "cfg.resultados":      { es: "{n} resultado{s}", en: "{n} result{s}", ru: "{n} результат(ов)" },
  "cfg.editar":          { es: "Editar", en: "Edit", ru: "Изменить" },
  "cfg.eliminarBtn":     { es: "Eliminar", en: "Delete", ru: "Удалить" },
  "cfg.guardar":         { es: "Guardar", en: "Save", ru: "Сохранить" },
  "cfg.cancelar":        { es: "Cancelar", en: "Cancel", ru: "Отмена" },
  "cfg.nombrePartner":   { es: "Nombre del partner", en: "Partner name", ru: "Имя партнёра" },
  "cfg.addKam":          { es: "+ Añadir nuevo KAM...", en: "+ Add new KAM...", ru: "+ Добавить нового KAM…" },
  "cfg.nuevoKam":        { es: "Nuevo nombre de KAM", en: "New KAM name", ru: "Новое имя KAM" },
  "cfg.agregar":         { es: "+ Agregar", en: "+ Add", ru: "+ Добавить" },

  "cfg.completaNombreKam":  { es: "Completa nombre y KAM antes de guardar.", en: "Fill in name and KAM before saving.", ru: "Заполните имя и KAM перед сохранением." },
  "cfg.completaClidKam":    { es: "Completa CLID, partner y KAM para agregar.", en: "Fill in CLID, partner and KAM to add.", ru: "Заполните CLID, партнёра и KAM для добавления." },
  "cfg.clidYaExiste":       { es: 'El CLID "{c}" ya existe: {e}.\n¿Deseas actualizarlo con los nuevos datos?',
                              en: 'CLID "{c}" already exists: {e}.\nDo you want to update it with the new data?',
                              ru: 'CLID «{c}» уже существует: {e}.\nОбновить его новыми данными?' },
  "cfg.clidAgregado":       { es: "CLID agregado correctamente ✓", en: "CLID added successfully ✓", ru: "CLID успешно добавлен ✓" },
  "cfg.confirmEliminarClid":{ es: '¿Eliminar "{p}" (CLID: {c})?\nEsta acción no se puede deshacer.',
                              en: 'Delete "{p}" (CLID: {c})?\nThis action cannot be undone.',
                              ru: 'Удалить «{p}» (CLID: {c})?\nЭто действие нельзя отменить.' },
  "cfg.errorEliminar":      { es: "Error al eliminar: ", en: "Error deleting: ", ru: "Ошибка удаления: " },
  "cfg.eliminadoOk":        { es: '"{p}" eliminado correctamente ✓', en: '"{p}" deleted successfully ✓', ru: '«{p}» успешно удалён ✓' },
  "cfg.errorGuardar":       { es: "Error al guardar: ", en: "Error saving: ", ru: "Ошибка сохранения: " },
  "cfg.guardadoOk":         { es: "Guardado correctamente ✓", en: "Saved successfully ✓", ru: "Успешно сохранено ✓" },
  "cfg.errorAgregar":       { es: "Error al agregar: ", en: "Error adding: ", ru: "Ошибка добавления: " },
  "cfg.guardando":          { es: "Guardando...", en: "Saving...", ru: "Сохранение…" },
  "cfg.eliminando":         { es: "Eliminando...", en: "Deleting...", ru: "Удаление…" },

  "cfg.operacionBloqueada": { es: "Operación bloqueada: requiere rol admin.", en: "Blocked: admin role required.", ru: "Операция заблокирована: нужна роль admin." },
  "cfg.formatoMesInvalido": { es: "Formato de mes inválido. Debe ser YYYY-MM (ej: 2026-04).", en: "Invalid month format. Must be YYYY-MM (e.g. 2026-04).", ru: "Неверный формат месяца. Должен быть YYYY-MM (напр. 2026-04)." },
  "cfg.confirmarBorrado":   { es: "¿Confirmas borrar {s} de {t}?\n\nEsta acción NO se puede deshacer.",
                              en: "Confirm deleting {s} from {t}?\n\nThis action CANNOT be undone.",
                              ru: "Подтвердите удаление {s} из {t}?\n\nЭто действие НЕЛЬЗЯ отменить." },
  "cfg.delMes":             { es: "del mes {m}", en: "the {m} data", ru: "данные за {m}" },
  "cfg.delTodaTabla":       { es: "TODA la tabla", en: "the ENTIRE table", ru: "ВСЮ таблицу" },
  "cfg.eliminandoTabla":    { es: "Eliminando {t}...", en: "Deleting {t}...", ru: "Удаление {t}…" },
  "cfg.eliminadoTabla":     { es: "Eliminado: {t} {m}", en: "Deleted: {t} {m}", ru: "Удалено: {t} {m}" },
  "cfg.todo":               { es: "(todo)", en: "(all)", ru: "(всё)" },


  // ── Usuarios y Accesos (fase 2) ────────────────────────────────────────
  "au.permWritePerf":   { es: "Subir rendimiento",      en: "Upload performance",  ru: "Загрузка показателей" },
  "au.permWriteMetas":  { es: "Editar metas",            en: "Edit goals",          ru: "Редактирование целей" },
  "au.permWriteConfig": { es: "Editar configuración",    en: "Edit settings",       ru: "Редактирование настроек" },
  "au.permWriteSeg":    { es: "Editar seguimiento",      en: "Edit tracking",       ru: "Редактирование отслеживания" },
  "au.permDeleteData":  { es: "Borrado masivo",          en: "Bulk delete",         ru: "Массовое удаление" },
  "au.permManageUsers": { es: "Gestionar usuarios",      en: "Manage users",        ru: "Управление пользователями" },

  "au.errCargarUsuarios": { es: "Error al cargar usuarios.", en: "Error loading users.", ru: "Ошибка загрузки пользователей." },
  "au.errListarUsuarios": { es: "No se pudo listar usuarios (¿Edge Function desplegada?).", en: "Couldn't list users (is the Edge Function deployed?).", ru: "Не удалось получить список пользователей (Edge Function развёрнута?)." },
  "au.errOperacionRechazada": { es: "La operación fue rechazada.", en: "The operation was rejected.", ru: "Операция отклонена." },
  "au.confirmCambiarRol": { es: '¿Cambiar el rol de {e} a "{r}"?\n\nEl rol viaja dentro del token de sesión: recién aplica cuando esa persona vuelve a iniciar sesión.',
                            en: 'Change {e}\'s role to "{r}"?\n\nThe role travels inside the session token: it only applies once that person signs in again.',
                            ru: 'Изменить роль {e} на «{r}»?\n\nРоль передаётся внутри токена сессии: применится только при следующем входе этого пользователя.' },
  "au.cambiandoRol":     { es: "Cambiando rol...", en: "Changing role...", ru: "Смена роли…" },
  "au.rolActualizado":   { es: "Rol actualizado a {r} ✓ — debe volver a iniciar sesión para que aplique.",
                           en: "Role updated to {r} ✓ — they must sign in again for it to apply.",
                           ru: "Роль обновлена на {r} ✓ — для применения нужен повторный вход." },
  "au.ingresaEmail":     { es: "Ingresá un email para invitar.", en: "Enter an email to invite.", ru: "Введите email для приглашения." },
  "au.enviandoInvitacion": { es: "Enviando invitación...", en: "Sending invitation...", ru: "Отправка приглашения…" },
  "au.invitacionEnviada":  { es: "Invitación enviada a {e} (rol {r}) ✓", en: "Invitation sent to {e} (role {r}) ✓", ru: "Приглашение отправлено {e} (роль {r}) ✓" },
  "au.usuarioEliminado":   { es: "Usuario {e} eliminado", en: "User {e} deleted", ru: "Пользователь {e} удалён" },
  "au.noSePudoEliminar":   { es: "No se pudo eliminar: ", en: "Couldn't delete: ", ru: "Не удалось удалить: " },
  "au.confirmCerrarSesiones": { es: "¿Cerrar todas las sesiones de {e}?\n\nSe usa para que un cambio de rol aplique de inmediato.",
                                en: "Close all sessions for {e}?\n\nUse this so a role change applies immediately.",
                                ru: "Закрыть все сессии {e}?\n\nИспользуется, чтобы изменение роли применилось немедленно." },
  "au.cerrandoSesiones":  { es: "Cerrando sesiones...", en: "Closing sessions...", ru: "Закрытие сессий…" },
  "au.sesionesCerradas":  { es: "Sesiones cerradas ✓", en: "Sessions closed ✓", ru: "Сессии закрыты ✓" },
  "au.guardandoPermiso":  { es: "Guardando permiso...", en: "Saving permission...", ru: "Сохранение права…" },
  "au.permisoOtorgado":   { es: "otorgado", en: "granted", ru: "выдано" },
  "au.permisoRevocado":   { es: "revocado", en: "revoked", ru: "отозвано" },
  "au.permisoResultado":  { es: "Permiso {s} ✓", en: "Permission {s} ✓", ru: "Право {s} ✓" },
  "au.error":             { es: "Error: ", en: "Error: ", ru: "Ошибка: " },
  "au.clidNoExiste":      { es: "El CLID {c} no existe en Configuración → Partners.", en: "CLID {c} doesn't exist in Settings → Partners.", ru: "CLID {c} не существует в Настройках → Партнёры." },
  "au.asignandoClid":     { es: "Asignando CLID...", en: "Assigning CLID...", ru: "Назначение CLID…" },
  "au.clidAsignado":      { es: "CLID {c} asignado ✓", en: "CLID {c} assigned ✓", ru: "CLID {c} назначен ✓" },
  "au.quitandoClid":      { es: "Quitando CLID...", en: "Removing CLID...", ru: "Удаление CLID…" },
  "au.clidDesasignado":   { es: "CLID desasignado ✓", en: "CLID unassigned ✓", ru: "CLID отменён ✓" },

  "au.rol.adminLabel":  { es: "Admin",   en: "Admin",   ru: "Admin" },
  "au.rol.adminDesc":   { es: "Todo, incluido borrar datos y gestionar usuarios", en: "Everything, including deleting data and managing users", ru: "Всё, включая удаление данных и управление пользователями" },
  "au.rol.kamLabel":    { es: "KAM",     en: "KAM",     ru: "KAM" },
  "au.rol.kamDesc":     { es: "Sube datos y metas · no borra", en: "Uploads data and goals · can't delete", ru: "Загружает данные и цели · не удаляет" },
  "au.rol.viewerLabel": { es: "Viewer",  en: "Viewer",  ru: "Viewer" },
  "au.rol.viewerDesc":  { es: "Solo lectura", en: "Read only", ru: "Только чтение" },
  "au.rol.partnerLabel":{ es: "Partner", en: "Partner", ru: "Partner" },
  "au.rol.partnerDesc": { es: "Solo SUS CLIDs · portal externo", en: "Only THEIR CLIDs · external portal", ru: "Только СВОИ CLID · внешний портал" },

  "au.nuncaIngreso":   { es: "nunca ingresó", en: "never signed in", ru: "не входил" },
  "au.hoy":            { es: "hoy", en: "today", ru: "сегодня" },
  "au.ayer":           { es: "ayer", en: "yesterday", ru: "вчера" },
  "au.haceDias":       { es: "hace {n} d", en: "{n}d ago", ru: "{n} дн. назад" },
  "au.haceMes":        { es: "hace {n} mes", en: "{n} month ago", ru: "{n} мес. назад" },
  "au.haceMeses":      { es: "hace {n} meses", en: "{n} months ago", ru: "{n} мес. назад" },

  "au.consultanServidor": { es: "Los usuarios se consultan al servidor solo cuando los pedís.", en: "Users are only fetched from the server when you ask for them.", ru: "Пользователи запрашиваются с сервера только по запросу." },
  "au.cargarUsuarios":    { es: "Cargar usuarios", en: "Load users", ru: "Загрузить пользователей" },
  "au.cargandoUsuarios":  { es: "Cargando usuarios…", en: "Loading users…", ru: "Загрузка пользователей…" },
  "au.noSePudoCargar":    { es: "No se pudo cargar", en: "Couldn't load", ru: "Не удалось загрузить" },
  "au.reintentar":        { es: "Reintentar", en: "Retry", ru: "Повторить" },
  "au.buscarPorEmail":    { es: "Buscar por email…", en: "Search by email…", ru: "Поиск по email…" },
  "au.todos":             { es: "Todos", en: "All", ru: "Все" },
  "au.refrescar":         { es: "Refrescar", en: "Refresh", ru: "Обновить" },
  "au.invitarUsuario":    { es: "＋ Invitar usuario", en: "＋ Invite user", ru: "＋ Пригласить пользователя" },
  "au.emailDominio":      { es: "email@dominio.com", en: "email@domain.com", ru: "email@домен.com" },
  "au.enviarInvitacion":  { es: "Enviar invitación", en: "Send invitation", ru: "Отправить приглашение" },
  "au.invitarHint":       { es: "Recibe un mail para <strong>fijar su propia contraseña</strong>. Si elegís <strong>Partner</strong>, acordate de asignarle sus CLIDs después: sin CLIDs no ve ningún dato.",
                            en: "They get an email to <strong>set their own password</strong>. If you pick <strong>Partner</strong>, remember to assign their CLIDs afterward: without CLIDs they see no data.",
                            ru: "Получит письмо для <strong>установки своего пароля</strong>. Если выбрать <strong>Partner</strong>, не забудьте назначить CLID после: без CLID он не увидит данных." },
  "au.ningunoCoincide":   { es: "Ningún usuario coincide con el filtro.", en: "No user matches the filter.", ru: "Ни один пользователь не соответствует фильтру." },
  "au.adminTienePermisos":{ es: "Un admin ya tiene todos los permisos", en: "An admin already has all permissions", ru: "У администратора уже есть все права" },
  "au.clidsAsignados":    { es: "CLIDs asignados", en: "Assigned CLIDs", ru: "Назначенные CLID" },
  "au.quitar":            { es: "Quitar", en: "Remove", ru: "Убрать" },
  "au.sinClidsWarn":      { es: "⚠ Sin CLIDs: esta cuenta no ve ningún dato", en: "⚠ No CLIDs: this account sees no data", ru: "⚠ Нет CLID: этот аккаунт не видит данных" },
  "au.asignar":           { es: "Asignar", en: "Assign", ru: "Назначить" },
  "au.eliminarPermanente":{ es: "Se elimina <strong>{e}</strong> de forma permanente, junto con sus permisos y CLIDs. <strong>No se puede deshacer.</strong> El historial de cambios que haya hecho se conserva.",
                            en: "<strong>{e}</strong> will be permanently deleted, along with their permissions and CLIDs. <strong>This cannot be undone.</strong> Their change history is preserved.",
                            ru: "<strong>{e}</strong> будет удалён навсегда вместе с правами и CLID. <strong>Отменить нельзя.</strong> История его изменений сохранится." },
  "au.siEliminar":        { es: "Sí, eliminar", en: "Yes, delete", ru: "Да, удалить" },
  "au.vos":                { es: "vos", en: "you", ru: "вы" },
  "au.alta":               { es: "alta {f}", en: "joined {f}", ru: "создан {f}" },
  "au.cerrarSesionesTip":  { es: "Cierra sus sesiones para que un cambio de rol aplique ya", en: "Closes their sessions so a role change applies now", ru: "Закрывает сессии, чтобы изменение роли применилось сразу" },
  "au.noPodesEliminarte":  { es: "No podés eliminar tu propia cuenta", en: "You can't delete your own account", ru: "Нельзя удалить собственный аккаунт" },
  "au.eliminarUsuario":    { es: "Eliminar usuario", en: "Delete user", ru: "Удалить пользователя" },
  "au.rolLabel":           { es: "Rol", en: "Role", ru: "Роль" },
  "au.permisosExtra":      { es: "Permisos extra", en: "Extra permissions", ru: "Дополнительные права" },
  "au.footerHint":         { es: "El rol viaja dentro del token de sesión: un cambio recién aplica cuando la persona vuelve a entrar (o si le cerrás la sesión con <b>⎋</b>). Los permisos extra y los CLIDs, en cambio, aplican al instante.",
                             en: "The role travels inside the session token: a change only applies once the person logs back in (or if you close their session with <b>⎋</b>). Extra permissions and CLIDs, however, apply instantly.",
                             ru: "Роль передаётся внутри токена сессии: изменение применится только при повторном входе (или если закрыть сессию через <b>⎋</b>). Дополнительные права и CLID, наоборот, применяются мгновенно." },


  // ── Monitoreo (fase 2) ─────────────────────────────────────────────────
  "mon.nunca":        { es: "nunca", en: "never", ru: "никогда" },
  "mon.haceMinutos":  { es: "hace minutos", en: "minutes ago", ru: "минуты назад" },
  "mon.haceHoras":    { es: "hace {n} h", en: "{n}h ago", ru: "{n} ч. назад" },
  "mon.ayer":         { es: "ayer", en: "yesterday", ru: "вчера" },
  "mon.haceDias":     { es: "hace {n} días", en: "{n} days ago", ru: "{n} дн. назад" },
  "mon.haceMes":      { es: "hace {n} mes", en: "{n} month ago", ru: "{n} мес. назад" },
  "mon.haceMeses":    { es: "hace {n} meses", en: "{n} months ago", ru: "{n} мес. назад" },

  "mon.cargarBtn":    { es: "📡 Cargar monitoreo", en: "📡 Load monitoring", ru: "📡 Загрузить мониторинг" },
  "mon.cargarHint":   { es: "Lee los accesos de las cuentas y el registro de cambios. No se carga solo para no pegarle a la Edge Function en cada render.",
                        en: "Reads account access and the change log. It doesn't load automatically so it doesn't hit the Edge Function on every render.",
                        ru: "Читает доступы аккаунтов и журнал изменений. Не загружается автоматически, чтобы не нагружать Edge Function на каждой отрисовке." },
  "mon.cargando":     { es: "Cargando monitoreo…", en: "Loading monitoring…", ru: "Загрузка мониторинга…" },
  "mon.actualizar":   { es: "🔄 Actualizar", en: "🔄 Refresh", ru: "🔄 Обновить" },
  "mon.errCargarCuentas": { es: "No se pudo leer la lista de cuentas: ", en: "Couldn't read the account list: ", ru: "Не удалось прочитать список аккаунтов: " },
  "mon.motivoDesconocido": { es: "motivo desconocido", en: "unknown reason", ru: "неизвестная причина" },

  "mon.accesosTitulo": { es: "Accesos", en: "Access", ru: "Доступы" },
  "mon.accesosSub":    { es: "Quién entró y cuándo · el color marca la antigüedad del último acceso",
                         en: "Who logged in and when · color marks how stale the last login is",
                         ru: "Кто и когда заходил · цвет показывает давность последнего входа" },
  "mon.kpiCuentas":       { es: "👥 Cuentas", en: "👥 Accounts", ru: "👥 Аккаунты" },
  "mon.kpiCuentasTip":    { es: "Total de cuentas creadas", en: "Total accounts created", ru: "Всего создано аккаунтов" },
  "mon.kpiActivas7":      { es: "✅ Activas (7 días)", en: "✅ Active (7 days)", ru: "✅ Активны (7 дней)" },
  "mon.kpiActivas7Tip":   { es: "Entraron en los últimos 7 días", en: "Signed in over the last 7 days", ru: "Заходили за последние 7 дней" },
  "mon.kpiPartners":      { es: "🤝 Partners", en: "🤝 Partners", ru: "🤝 Партнёры" },
  "mon.kpiPartnersTip":   { es: "Cuentas con rol partner", en: "Accounts with the partner role", ru: "Аккаунты с ролью partner" },
  "mon.kpiNuncaEntraron":    { es: "🚫 Nunca entraron", en: "🚫 Never signed in", ru: "🚫 Никогда не заходили" },
  "mon.kpiNuncaEntraronTip": { es: "Invitadas pero sin ningún acceso — probablemente no recibieron o no abrieron la invitación",
                               en: "Invited but with no access at all — likely didn't receive or open the invitation",
                               ru: "Приглашены, но ни разу не заходили — вероятно, не получили или не открыли приглашение" },
  "mon.tablaPartners":  { es: "🤝 Partners", en: "🤝 Partners", ru: "🤝 Партнёры" },
  "mon.tablaEquipo":    { es: "🏢 Equipo interno", en: "🏢 Internal team", ru: "🏢 Внутренняя команда" },
  "mon.col.cuenta":     { es: "Cuenta", en: "Account", ru: "Аккаунт" },
  "mon.col.rol":        { es: "Rol", en: "Role", ru: "Роль" },
  "mon.col.ultimoAcceso": { es: "Último acceso", en: "Last access", ru: "Последний доступ" },
  "mon.col.fechaExacta":  { es: "Fecha exacta", en: "Exact date", ru: "Точная дата" },
  "mon.col.creada":       { es: "Creada", en: "Created", ru: "Создан" },

  "mon.auditTitulo":  { es: "Registro de cambios", en: "Change log", ru: "Журнал изменений" },
  "mon.auditSub":     { es: "Últimos {n} movimientos · lo escriben triggers de Postgres, no el navegador: no se puede alterar desde la app",
                        en: "Last {n} changes · written by Postgres triggers, not the browser: can't be altered from the app",
                        ru: "Последние {n} изменений · пишут триггеры Postgres, не браузер: изменить из приложения нельзя" },
  "mon.todasTablas":  { es: "Todas las tablas", en: "All tables", ru: "Все таблицы" },
  "mon.sinMovimientos": { es: "Sin movimientos registrados para este filtro.", en: "No changes recorded for this filter.", ru: "Изменений по этому фильтру не найдено." },
  "mon.col.cuando":   { es: "Cuándo", en: "When", ru: "Когда" },
  "mon.col.quien":    { es: "Quién", en: "Who", ru: "Кто" },
  "mon.col.accion":   { es: "Acción", en: "Action", ru: "Действие" },
  "mon.col.tabla":    { es: "Tabla", en: "Table", ru: "Таблица" },
  "mon.col.registro": { es: "Registro", en: "Record", ru: "Запись" },

  "mon.ingestaTitulo":  { es: "Ingesta automática de taxiparks", en: "Automatic taxiparks ingestion", ru: "Автоматическая загрузка taxiparks" },
  "mon.ingestaCarga":   { es: 'Carga de la tarea "Dashboard OPS"', en: 'Load from the "Dashboard OPS" task', ru: 'Загрузка задачи «Dashboard OPS»' },
  "mon.sinIngestasAun": { es: "Todavía no hubo ninguna ingesta automática. Mientras tanto la carga sigue siendo manual (Actualizar información → Rendimiento). Ver <code>docs/ingest-taxiparks.md</code> para conectarla.",
                          en: "There hasn't been an automatic ingestion yet. In the meantime loading stays manual (Update data → Performance). See <code>docs/ingest-taxiparks.md</code> to connect it.",
                          ru: "Автоматической загрузки ещё не было. Пока загрузка остаётся ручной (Обновить данные → Показатели). См. <code>docs/ingest-taxiparks.md</code> для подключения." },
  "mon.filasPeriodos":  { es: "{f} filas · {p} período(s)", en: "{f} rows · {p} period(s)", ru: "{f} строк · {p} период(ов)" },
  "mon.sinIngestas":    { es: "sin ingestas", en: "no ingestions", ru: "нет загрузок" },
  "mon.faltaron":       { es: "Faltaron: {l}", en: "Missing: {l}", ru: "Отсутствуют: {l}" },
  "mon.avisoKpisFaltantes": { es: "⚠️ En la última ingesta faltaron <strong>{n} de {t}</strong> KPIs. Entran como 0 y las gráficas se ven planas sin avisar. Suele ser una measure renombrada en DataLens.",
                              en: "⚠️ The last ingestion was missing <strong>{n} of {t}</strong> KPIs. They come in as 0 and charts look flat without any warning. Usually a renamed measure in DataLens.",
                              ru: "⚠️ В последней загрузке отсутствовали <strong>{n} из {t}</strong> KPI. Они приходят как 0, и графики выглядят плоскими без предупреждения. Обычно это переименованная мера в DataLens." },
  "mon.ultimaCarga":  { es: "Última carga por escala · KPIs recibidos · errores", en: "Last load by scale · KPIs received · errors", ru: "Последняя загрузка по масштабу · полученные KPI · ошибки" },
  "mon.col.filas":    { es: "Filas", en: "Rows", ru: "Строки" },
  "mon.col.kpis":     { es: "KPIs", en: "KPIs", ru: "KPI" },
  "mon.col.kpisTip":  { es: "KPIs con datos (y cuántos faltaron)", en: "KPIs with data (and how many were missing)", ru: "KPI с данными (и сколько отсутствовало)" },
  "mon.col.periodos": { es: "Períodos", en: "Periods", ru: "Периоды" },
  "mon.col.detalle":  { es: "Detalle", en: "Detail", ru: "Детали" },

  "mon.usoTitulo":     { es: "Uso del dashboard", en: "Dashboard usage", ru: "Использование дашборда" },
  "mon.ultimos30d":    { es: "Últimos 30 días", en: "Last 30 days", ru: "Последние 30 дней" },
  "mon.ultimos30dSub": { es: "Últimos 30 días · lo registra el navegador, es telemetría de uso (no auditoría)",
                         en: "Last 30 days · recorded by the browser, usage telemetry (not an audit)",
                         ru: "Последние 30 дней · записывает браузер, телеметрия использования (не аудит)" },
  "mon.sinEventosAun": { es: "Todavía no hay eventos registrados. Se empiezan a acumular a medida que el equipo y los partners usen el dashboard — los eventos anteriores a la activación del registro no existen.",
                         en: "No events recorded yet. They start accumulating as the team and partners use the dashboard — events before logging was enabled don't exist.",
                         ru: "Событий пока нет. Они начнут накапливаться по мере использования дашборда командой и партнёрами — события до включения журнала не существуют." },
  "mon.kpiIngresos":     { es: "🔓 Ingresos", en: "🔓 Sign-ins", ru: "🔓 Входы" },
  "mon.kpiIngresosTip":  { es: "Eventos de login en los últimos 30 días", en: "Login events over the last 30 days", ru: "События входа за последние 30 дней" },
  "mon.kpiPersonas":     { es: "🙋 Personas activas", en: "🙋 Active people", ru: "🙋 Активные люди" },
  "mon.kpiPersonasTip":  { es: "Cuentas distintas con algún evento", en: "Distinct accounts with at least one event", ru: "Уникальные аккаунты хотя бы с одним событием" },
  "mon.kpiDescargas":    { es: "⬇️ Descargas", en: "⬇️ Downloads", ru: "⬇️ Скачивания" },
  "mon.kpiDescargasTip": { es: "PDFs y CSVs exportados", en: "PDFs and CSVs exported", ru: "Экспортировано PDF и CSV" },
  "mon.seccionesMasAbiertas": { es: "Secciones más abiertas", en: "Most opened sections", ru: "Самые открываемые разделы" },
  "mon.seccionesTip":         { es: "Cuenta la PRIMERA visita de cada sesión a cada sección, no cada click",
                                en: "Counts each session's FIRST visit to each section, not every click",
                                ru: "Считает ПЕРВОЕ посещение раздела за сессию, а не каждый клик" },
  "mon.queDescarga":  { es: "Qué se descarga", en: "What gets downloaded", ru: "Что скачивают" },
  "mon.sinDatos":     { es: "Sin datos", en: "No data", ru: "Нет данных" },

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

/**
 * Traduce un nombre de mes que viene de la BD ("JULIO", "julio", "Julio").
 * Si no lo reconoce devuelve el valor tal cual — un mes raro se muestra crudo,
 * que es mucho mejor que perderlo.
 */
export function mesLabel(mes: string): string {
  if (!mes) return mes;
  const k = "mes." + String(mes).toLowerCase().trim();
  return I18N[k] ? t(k) : mes;
}
