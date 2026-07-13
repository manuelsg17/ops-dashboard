// partnerView.js — Vista detallada de un partner individual
// Pensado para reuniones semanales/mensuales con el partner.
// Estructura: header, KPIs globales, sección por ciudad con charts.

const PARTNER_VIEW_STATE = {
  partner: null,
  period:  "auto",   // auto | 3m | 6m | 12m | custom
  lang:    "es",     // "es" | "en"  — afecta panel ejecutivo, headers y PDF
  shareMode: false,  // "Solo tendencias": oculta valores en los charts de comparación (para compartir)
  showLegend: false, // Leyenda de cohortes (integrantes + cifras): OFF por defecto → no va al PDF del partner
  charts:  []        // ApexCharts instances
};

// ── i18n (español / inglés) ───────────────────────────────────────────────────
// Diccionario centralizado de todos los textos visibles que se exportan al PDF.
// Usar _t("key") para resolverlos segun PARTNER_VIEW_STATE.lang.
const PV_I18N = {
  // Controles
  partner:        { es: "Partner",                 en: "Partner" },
  searchPartner:  { es: "Buscar partner...",       en: "Search partner..." },
  noMatch:        { es: "Sin coincidencias",       en: "No matches" },
  period:         { es: "Período",                 en: "Period" },
  downloadPDF:    { es: "📤 Descargar PDF",        en: "📤 Download PDF" },
  language:       { es: "Idioma",                  en: "Language" },
  // Header del partner
  cities:         { es: "Ciudades",                en: "Cities" },
  receivesLeads:  { es: "★ Recibe leads Yango",    en: "★ Receives Yango leads" },
  periodPrefix:   { es: "Período:",                en: "Period:" },
  scalePrefix:    { es: "Escala:",                 en: "Scale:" },
  scaleWeekly:    { es: "semanal",                 en: "weekly" },
  scaleMonthly:   { es: "mensual",                 en: "monthly" },
  scaleDaily:     { es: "diaria",                  en: "daily" },
  // Secciones
  execSummary:    { es: "Resumen Ejecutivo",       en: "Executive Summary" },
  execSummarySub: { es: "Principales hallazgos del período y recomendaciones",
                    en: "Key findings for the period and recommendations" },
  kpisTitle:      { es: "KPIs del último período", en: "Latest period KPIs" },
  cityDetail:     { es: "Detalle por Ciudad",      en: "City breakdown" },
  cityCount:      { es: "ciudad",                  en: "city" },
  cityCountPlural:{ es: "ciudades",                en: "cities" },
  // KPIs
  activeDrivers:  { es: "Conductores Activos",     en: "Active Drivers" },
  newReact:       { es: "Nuevos + Reactivados",    en: "New + Reactivated" },
  newReactShort:  { es: "Nuevos+React",            en: "New+React" },
  supplyHours:    { es: "Horas de Conexión",       en: "Supply Hours" },
  trips:          { es: "Viajes",                  en: "Trips" },
  commission:     { es: "Comisión",                en: "Commission" },
  // Periodos (palabras sueltas)
  week:           { es: "semana",                  en: "week" },
  month:          { es: "mes",                     en: "month" },
  day:            { es: "día",                     en: "day" },
  weeks:          { es: "semanas",                 en: "weeks" },
  months:         { es: "meses",                   en: "months" },
  days:           { es: "días",                    en: "days" },
  // Análisis ejecutivo — encabezados y fallback
  findingsOne:    { es: "hallazgo",                en: "finding" },
  findingsMany:   { es: "hallazgos",               en: "findings" },
  actionLabel:    { es: "Recomendación:",          en: "Recommendation:" },
  // Bullets — titulos
  declineTitle:           { es: "Tendencia a la baja en {city}",
                            en: "Downward trend in {city}" },
  declineBody:            { es: "{metric} acumula {n} {periods} consecutivos en descenso.",
                            en: "{metric} has dropped for {n} consecutive {periods}." },
  declineAction:          { es: "Sugerimos coordinar una revisión esta {period} para analizar la base activa frente a la registrada, identificar incidencias recientes y reforzar incentivos a sus conductores.",
                            en: "We suggest scheduling a review this {period} to analyze your active vs registered base, identify recent incidents and strengthen incentives for your drivers." },
  adDropSharpTitle:       { es: "Caída fuerte en Conductores Activos",
                            en: "Sharp drop in Active Drivers" },
  adDropSharpBody:        { es: "Bajó {prev} → {cur} ({pct}% vs {period} anterior).",
                            en: "Down {prev} → {cur} ({pct}% vs previous {period})." },
  adDropSharpAction:      { es: "Recomendamos identificar a los conductores que se desconectaron en el período y considerar una campaña de reactivación. Verificar también si hay aspectos operativos (uso de la app, comisión, pagos) que puedan estar influyendo.",
                            en: "We recommend identifying drivers who disconnected during the period and considering a re-activation campaign. Also worth checking if any operational aspects (app usage, commission, payments) may be influencing." },
  adDropModTitle:         { es: "Caída moderada en AD ({pct}%)",
                            en: "Moderate drop in AD ({pct}%)" },
  adDropModBody:          { es: "Tendencia negativa de {prev} → {cur}.",
                            en: "Negative trend {prev} → {cur}." },
  adDropModAction:        { es: "Sugerimos hacer seguimiento durante las próximas 2 {periods} y revisar el mix de turnos junto con las desconexiones recientes para identificar la causa.",
                            en: "We suggest tracking the next 2 {periods} and reviewing the shift mix together with recent disconnections to identify the cause." },
  adGrowTitle:            { es: "Crecimiento fuerte en AD (+{pct}%)",
                            en: "Strong AD growth (+{pct}%)" },
  adGrowBody:             { es: "Aumentó {prev} → {cur}.",
                            en: "Up {prev} → {cur}." },
  adGrowAction:           { es: "Excelente momentum. Es un buen período para validar la capacidad operativa, evaluar aumentar la asignación de leads Yango y proyectar objetivos más ambiciosos para el próximo {period}.",
                            en: "Great momentum. A good period to validate operational capacity, evaluate increasing Yango lead allocation and plan more ambitious objectives for next {period}." },
  nrZeroTitle:            { es: "Cero ingresos de conductores este {period}",
                            en: "No new drivers this {period}" },
  nrZeroBody:             { es: "Había {prev} nuevos/reactivados el {period} anterior — esta vez 0.",
                            en: "Last {period} had {prev} new/reactivated — this time 0." },
  nrZeroAction:           { es: "Recomendamos revisar el flujo de incorporación de nuevos conductores: verificar si el proceso de documentación está al día y si todos los CLIDs siguen activos cargando drivers.",
                            en: "We recommend reviewing the new-driver intake flow: verify documentation is up to date and that all CLIDs are still actively loading drivers." },
  nrDropTitle:            { es: "Ingresos N+R bajaron fuerte ({cur} vs {prev})",
                            en: "New+React income dropped sharply ({cur} vs {prev})" },
  nrDropBody:             { es: "Reducción de más del 60% en nuevos drivers.",
                            en: "More than 60% drop in new drivers." },
  nrDropAction:           { es: "Sugerimos analizar si la caída responde a estacionalidad o a algún ajuste operativo. Vale la pena revisar la capacidad de su equipo para procesar nuevas incorporaciones.",
                            en: "We suggest analyzing whether the drop responds to seasonality or some operational adjustment. Worth reviewing your team's capacity to process new sign-ups." },
  leadsTitle:             { es: "{leads} leads Yango pendientes de conversión",
                            en: "{leads} Yango leads pending conversion" },
  leadsBody:              { es: "Se están recibiendo leads pero la base de conductores activos no crece al mismo ritmo.",
                            en: "Leads are being received but the active driver base is not growing at the same pace." },
  leadsAction:            { es: "Recomendamos revisar el tiempo y la tasa de conversión de lead a conductor activo. Suele ayudar acortar el proceso de documentación y la capacitación inicial. Quedamos atentos para apoyar con buenas prácticas.",
                            en: "We recommend reviewing the lead-to-active-driver conversion time and rate. Shortening the documentation process and initial onboarding usually helps. We're here to share best practices." },
  // (Las keys de metas se removieron: la logica ya no las renderiza)
  cityGapTitle:           { es: "Diferencia significativa entre ciudades",
                            en: "Significant gap across cities" },
  cityGapBody:            { es: "{best}: {bestAd} AD vs {worst}: {worstAd} AD ({ratio}x de diferencia).",
                            en: "{best}: {bestAd} AD vs {worst}: {worstAd} AD ({ratio}x difference)." },
  cityGapAction:          { es: "Las prácticas que están funcionando en {best} podrían trasladarse a la operación en {worst}. Sería valioso identificar qué se está haciendo diferente en su ciudad de mejor desempeño y aplicar esos aprendizajes.",
                            en: "The practices working in {best} could be transferred to operations in {worst}. It would be valuable to identify what's being done differently in your best-performing city and apply those learnings." },
  commTitle:              { es: "Comisión a la baja sin caída en viajes",
                            en: "Commission declining without trips dropping" },
  commBody:               { es: "Viajes {trPct}%, comisión {coPct}%.",
                            en: "Trips {trPct}%, commission {coPct}%." },
  commAction:             { es: "Probablemente cambió la tarifa promedio o el mix de servicios. Recomendamos revisar los tipos de viaje predominantes en el período y las promociones que estuvieron activas.",
                            en: "Likely a change in average fare or service mix. We recommend reviewing predominant trip types in the period and any promotions that were active." },
  noAlertsTitle:          { es: "Operación estable en el período",
                            en: "Stable operation in the period" },
  noAlertsBody:           { es: "Las métricas se mantuvieron dentro de parámetros normales.",
                            en: "Metrics stayed within normal range." },
  noAlertsAction:         { es: "Buen momento para alinear objetivos del próximo {period} y proyectar próximos pasos juntos.",
                            en: "A good moment to align next {period}'s objectives and plan next steps together." },
  // Decline metric labels
  metricActiveDrivers:    { es: "Conductores Activos",      en: "Active Drivers" },
  metricSupplyHours:      { es: "Horas de Conexión",        en: "Supply Hours" },
  metricNR:               { es: "Nuevos+Reactivados",       en: "New+Reactivated" },

  // ── Hallazgos basados en metricas puras (sin metas) ──────────────────────
  trendDownTitle:         { es: "Tendencia a la baja sostenida en AD",
                            en: "Sustained downward AD trend" },
  trendDownBody:          { es: "El promedio de los últimos 3 {periods} cayó {pct}% respecto a los 3 {periods} anteriores ({prevAvg} → {curAvg} AD).",
                            en: "The average of the last 3 {periods} dropped {pct}% vs the previous 3 {periods} ({prevAvg} → {curAvg} AD)." },
  trendDownAction:        { es: "Este patrón sugiere una caída estructural más que un evento puntual. Recomendamos revisar en conjunto incentivos vigentes, calidad del servicio y la rotación de conductores para identificar la causa de fondo.",
                            en: "This pattern points to a structural decline rather than a one-off event. We recommend reviewing together current incentives, service quality and driver turnover to identify the root cause." },
  trendUpTitle:           { es: "Crecimiento sostenido en AD",
                            en: "Sustained AD growth" },
  trendUpBody:            { es: "El promedio de los últimos 3 {periods} subió {pct}% respecto a los 3 {periods} anteriores ({prevAvg} → {curAvg} AD).",
                            en: "The average of the last 3 {periods} grew {pct}% vs the previous 3 {periods} ({prevAvg} → {curAvg} AD)." },
  trendUpAction:          { es: "Felicitaciones, es tracción real y no un rebote puntual. Sugerimos validar la capacidad operativa para sostener el ritmo y conversar próximos pasos de expansión.",
                            en: "Congratulations, this is real traction rather than a one-off bounce. We suggest validating operational capacity to sustain the pace and discussing next expansion steps." },
  // ── Señal mixta AD: corto plazo (MoM) y mediano plazo (3m) en conflicto ──
  // Evita mostrar "caída fuerte" (rojo) y "crecimiento sostenido" (verde) a la
  // vez sobre el mismo KPI; se fusionan en un solo hallazgo coherente.
  adMixDownUpTitle:       { es: "Conductores Activos: bajón reciente, tendencia aún positiva",
                            en: "Active Drivers: recent dip, trend still positive" },
  adMixDownUpBody:        { es: "El último {period} cayó {momAbs}% ({prev} → {cur}), pero el promedio de los últimos 3 {periods} sigue +{trendAbs}% sobre el de los 3 {periods} previos ({prevAvg} → {curAvg} AD).",
                            en: "This {period} fell {momAbs}% ({prev} → {cur}), but the last-3-{periods} average is still +{trendAbs}% above the previous 3 {periods} ({prevAvg} → {curAvg} AD)." },
  adMixDownUpAction:      { es: "Vigilar el próximo {period}: si se recupera, fue un bajón puntual; si sigue cayendo, conviene activar reactivación y revisar la operativa (uso de la app, comisión, pagos).",
                            en: "Watch next {period}: if it recovers it was a one-off dip; if it keeps falling, activate re-activation and review operations (app usage, commission, payments)." },
  adMixUpDownTitle:       { es: "Conductores Activos: rebote reciente, pero tendencia a la baja",
                            en: "Active Drivers: recent rebound, but downward trend" },
  adMixUpDownBody:        { es: "El último {period} subió {momAbs}% ({prev} → {cur}), pero el promedio de los últimos 3 {periods} cayó {trendAbs}% vs los 3 {periods} previos ({prevAvg} → {curAvg} AD).",
                            en: "This {period} rose {momAbs}% ({prev} → {cur}), but the last-3-{periods} average fell {trendAbs}% vs the previous 3 {periods} ({prevAvg} → {curAvg} AD)." },
  adMixUpDownAction:      { es: "El repunte es buena señal, pero la tendencia de fondo aún baja. Sugerimos confirmar que la mejora se sostenga 1-2 {periods} más antes de darla por consolidada, y revisar qué frenó el trimestre.",
                            en: "The uptick is encouraging, but the underlying trend is still down. We suggest confirming the improvement holds 1-2 more {periods} before considering it consolidated, and reviewing what slowed the quarter." },
  prodLowTitle:           { es: "Productividad por conductor por debajo del promedio",
                            en: "Below-average productivity per driver" },
  prodLowBody:            { es: "Promedio de {hours}h semanales por conductor. El referente esperado es superior a 20h.",
                            en: "Average of {hours}h weekly per driver. The expected benchmark is above 20h." },
  prodLowAction:          { es: "La base está activa pero podría estar siendo subutilizada. Recomendamos revisar el mix de turnos, las ofertas en hora pico y la calidad del despacho. Estamos a disposición para acompañar.",
                            en: "The base is active but may be underutilized. We recommend reviewing shift mix, peak-hour offers and dispatch quality. We're here to support." },
  prodHighTitle:           { es: "Productividad por conductor sobresaliente",
                            en: "Outstanding productivity per driver" },
  prodHighBody:            { es: "Promedio de {hours}h semanales por conductor, muy por encima del referente (>35h).",
                            en: "Average of {hours}h weekly per driver, well above the benchmark (>35h)." },
  prodHighAction:          { es: "Excelente trabajo aprovechando la base de conductores. Sería muy valioso compartir qué prácticas (turnos, incentivos, comunicación) están haciendo la diferencia para sostener este nivel.",
                            en: "Excellent work leveraging the driver base. It would be very valuable to share which practices (shifts, incentives, communication) are making the difference to sustain this level." },
  volatilityTitle:         { es: "Alta volatilidad en AD",
                            en: "High AD volatility" },
  volatilityBody:          { es: "El número de conductores activos oscila más del 25% entre {periods} consecutivos.",
                            en: "Active drivers swing by more than 25% between consecutive {periods}." },
  volatilityAction:        { es: "Sugerimos identificar qué eventos generan los picos y valles (turnos, ingresos o desconexiones masivas, factores estacionales). Estabilizar la operación facilita pronosticar y planear con anticipación.",
                            en: "We suggest identifying what events drive peaks and valleys (shifts, mass joins/disconnections, seasonal factors). Stabilizing operations makes forecasting and planning much easier." },
  commPerTripTitle:        { es: "Comisión promedio por viaje a la baja",
                            en: "Average commission per trip declining" },
  commPerTripBody:         { es: "El ratio comisión por viaje pasó de {prev} a {cur} (-{pct}%).",
                            en: "Commission-per-trip ratio went from {prev} to {cur} (-{pct}%)." },
  commPerTripAction:       { es: "Probablemente cambió el mix de tarifas o el tipo de servicio. Recomendamos revisar la proporción de viajes cortos vs largos y las promociones activas, ya que de sostenerse impactará los ingresos.",
                            en: "Likely a change in fare mix or service type. We recommend reviewing the share of short vs long trips and active promotions, as a sustained drop will impact revenue." },
  peakBestTitle:           { es: "En el mejor nivel histórico",
                            en: "At the highest historical level" },
  peakBestBody:            { es: "Los conductores activos actuales ({cur}) están al {pct}% del mejor registro histórico ({peak}).",
                            en: "Current active drivers ({cur}) are at {pct}% of the historical best ({peak})." },
  peakBestAction:          { es: "Es un momento ideal para proyectar próximos pasos: ampliar zonas de operación, sumar más conductores y consolidar el crecimiento. Estamos para acompañar este impulso.",
                            en: "An ideal moment to plan next steps: expand operating zones, add more drivers and consolidate the growth. We're here to support this momentum." },
  peakLowTitle:            { es: "Operando por debajo del potencial demostrado",
                            en: "Operating below proven potential" },
  peakLowBody:             { es: "Los conductores activos actuales ({cur}) representan el {pct}% del mejor registro histórico ({peak}).",
                            en: "Current active drivers ({cur}) represent {pct}% of the historical best ({peak})." },
  peakLowAction:           { es: "Ya se demostró capacidad para alcanzar {peak} conductores activos. Sugerimos analizar qué cambió desde aquel período (rotación, competencia, calidad del servicio o comisión) para diseñar un plan de recuperación.",
                            en: "Capacity to reach {peak} active drivers has been demonstrated before. We suggest analyzing what changed since then (turnover, competition, service quality or commission) to design a recovery plan." },
  leadDepTitle:            { es: "Alta proporción de ingresos vía leads Yango",
                            en: "High share of intake via Yango leads" },
  leadDepBody:             { es: "El {pct}% de las nuevas incorporaciones proviene de leads Yango ({yango} de {total}).",
                            en: "{pct}% of new sign-ups come from Yango leads ({yango} of {total})." },
  leadDepAction:           { es: "Sería positivo complementar con un pipeline propio de captación (referidos, redes sociales, alianzas locales) para diversificar fuentes y reducir dependencia. Compartimos buenas prácticas si resulta útil.",
                            en: "It would be positive to complement this with your own acquisition pipeline (referrals, social media, local partnerships) to diversify sources and reduce dependency. We can share best practices if helpful." },

  // ── Embudo de conversión (funnel por CLID, solo top-10) ──────────────────
  convTitle:      { es: "Embudo de Conversión",  en: "Conversion Funnel" },
  convSub:        { es: "Conversión de nuevos drivers por hitos de viajes",
                    en: "New-driver conversion by trip milestones" },
  convRank:       { es: "Ranking nacional por Active Drivers: #{rank} de {total}",
                    en: "National ranking by Active Drivers: #{rank} of {total}" },
  convClid:       { es: "CLID",          en: "CLID" },
  convAD:         { es: "Active Drivers", en: "Active Drivers" },
  convND:         { es: "New Drivers",    en: "New Drivers" },
  convFirstOrder: { es: "1er viaje",     en: "First order" },
  convN5:         { es: "5 viajes",      en: "5 trips" },
  convN10:        { es: "10 viajes",     en: "10 trips" },
  convN25:        { es: "25 viajes",     en: "25 trips" },
  convN50:        { es: "50 viajes",     en: "50 trips" },
  convN100:       { es: "100 viajes",    en: "100 trips" },
  convBenchmark:  { es: "Benchmark (percentiles del set filtrado)", en: "Benchmark (filtered-set percentiles)" },
  convADRange:    { es: "Active Drivers (mín–máx)", en: "Active Drivers (min–max)" },
  convNDMin:      { es: "New Drivers (mín)",        en: "New Drivers (min)" },
  convP25:        { es: "P25",             en: "P25" },
  convP50:        { es: "Mediana (P50)",   en: "Median (P50)" },
  convP75:        { es: "P75",             en: "P75" },
  convCmpTitle:   { es: "Comparar contra", en: "Compare against" },
  convTop5Btn:    { es: "Top 5",  en: "Top 5" },
  convTop10Btn:   { es: "Top 10", en: "Top 10" },
  convAvgTop:     { es: "Promedio Top {n}", en: "Top {n} average" },
  convPeers:      { es: "Pares elegibles", en: "Eligible peers" },
  convNoPartner:  { es: "Este partner no tiene datos de conversión en el período.",
                    en: "This partner has no conversion data for the period." },
  convPrivacyNote:{ es: "Solo se muestra tu desempeño frente al promedio del grupo; no se exponen datos de partners individuales.",
                    en: "Only your performance vs the group average is shown; individual partners' data is not exposed." },
  chanTitle:      { es: "Adquisición por canal", en: "Acquisition by channel" },
  chanSub:        { es: "Nuevos drivers por canal · tú vs promedio del grupo",
                    en: "New drivers by channel · you vs group average" },
  chanToggleHint: { es: "Usa el botón Top 5 / Top 10 del Embudo de Conversión (arriba) para cambiar la comparación.",
                    en: "Use the Top 5 / Top 10 button in the Conversion Funnel (above) to switch the comparison." },
  shPerCar:       { es: "SH por Auto Activo", en: "SH per Active Car" },
  acceptRate:     { es: "Tasa de Aceptación", en: "Acceptance Rate" },

  // ── Perú (General) + comparación cohortes ────────────────────────────────
  peruGeneral:    { es: "Perú (General)",  en: "Peru (Overall)" },
  peruGeneralSub: { es: "El partner combinando sus 3 ciudades · crecimiento/decrecimiento + comparación vs cohortes",
                    en: "The partner across its cities · growth/decline + comparison vs cohorts" },
  compareWith:    { es: "Comparar con",    en: "Compare with" },
  cohortTop5:     { es: "Prom. Top 5",     en: "Avg Top 5" },
  cohortTop610:   { es: "Prom. Top 6-10",  en: "Avg Top 6-10" },
  shareBtn:       { es: "Solo tendencias", en: "Trends only" },
  shareHint:      { es: "Oculta solo los valores de las líneas de promedio (Top 5 / Top 6-10); tus datos siguen visibles. Para compartir sin exponer las cifras del cohorte.",
                    en: "Hides only the average lines' values (Top 5 / Top 6-10); your own data stays visible. To share without exposing cohort figures." },
  legendBtn:      { es: "Leyenda", en: "Legend" },
  legendHint:     { es: "Muestra quiénes integran cada cohorte y las cifras del promedio. Apagado por defecto: dejalo APAGADO al enviar el PDF a los partners.",
                    en: "Shows who is in each cohort and the figures behind the average. Off by default: keep it OFF when sending the PDF to partners." }
};

// Resolver i18n: devuelve string en el lang actual.
// Soporta interpolacion estilo "{name}" -> opts.name.
function _t(key, opts) {
  const lang = PARTNER_VIEW_STATE.lang || "es";
  const entry = PV_I18N[key];
  if (!entry) return key;
  let s = entry[lang] || entry.es || key;
  if (opts) Object.keys(opts).forEach(k => { s = s.split(`{${k}}`).join(opts[k]); });
  return s;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function _pvDestroyCharts() {
  PARTNER_VIEW_STATE.charts.forEach(c => { try { c.destroy(); } catch(e){} });
  PARTNER_VIEW_STATE.charts = [];
  const sc = PARTNER_VIEW_STATE.scopeCharts || {};
  Object.keys(sc).forEach(id => { try { sc[id].destroy(); } catch(e){} });
  PARTNER_VIEW_STATE.scopeCharts = {};
}

// Monta (o re-monta) un chart keyed por elId. En el toggle de cohortes el div
// sigue en el DOM: destruimos la instancia previa y creamos una nueva EN EL MISMO
// div, sin reconstruir todo renderPartnerView (resumen ejecutivo, conversión,
// KPIs, innerHTML). Los animations:false ya hacen barato el render.
function _pvMountChart(elId, el, opts) {
  const reg = PARTNER_VIEW_STATE.scopeCharts || (PARTNER_VIEW_STATE.scopeCharts = {});
  const prev = reg[elId];
  if (prev) { try { prev.destroy(); } catch (e) {} }
  const ch = new ApexCharts(el, opts);
  ch.render();
  reg[elId] = ch;
}

// Cuántos puntos mostrar según escala
function _pvDefaultPoints(mode) {
  if (mode === "mensual") return 12;
  if (mode === "diario")  return 30;
  return 13; // semanal
}

// Devuelve las últimas N fechas disponibles (subset de STATE.allDates)
function _pvLastNDates(n) {
  const all = STATE.allDates || [];
  return all.slice(-n);
}

// Agrega rawData filtrado por partner + ciudad, devuelve array { date, ad, nr, sh,
// trips, commission, npPartner (newPartner only), npService (newService only), reactivated }
function _pvSeriesByPartnerCity(partner, city, dates) {
  const datesSet = new Set(dates);
  const byDate = {};
  // Solo rows de este partner y esta ciudad y dentro del rango
  const rows = (STATE._byPartner?.get(partner) || STATE.rawData.filter(r => r.partner === partner))
    .filter(r => r.city === city && datesSet.has(r.date));
  const _blank = (d, present) => ({
    date: d, _present: present, ad: 0, nr: 0, sh: 0,
    trips: 0, commission: 0, gmv: 0,
    npPartner: 0, npService: 0, reactivated: 0,
    activeCars: 0, _shCarW: 0, _acceptW: 0, shCar: 0, accept: 0
  });
  rows.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = _blank(r.date, true);
    const e = byDate[r.date];
    // AD es snapshot A NIVEL FLEETROOM: el total del partner+ciudad es la SUMA de sus
    // sub-flotas (db_id), NO el máximo. Con el split de fleetrooms (2026-03+) el MAX se
    // quedaba con la sub-flota más grande y sub-contaba (Lima 2,072 vs 4,057 real → total
    // 2,420 vs 3,430). Suma = misma agregación que Presentación 2.0 (p2Vals); las filas
    // legacy ya se descartaron en dropLegacyAggregateRows, así que no hay doble conteo.
    e.ad += r.activeDrivers || 0;
    e.npPartner   += r.newPartner;
    e.npService   += r.newService;
    e.reactivated += r.reactivated;
    e.nr = e.npPartner + e.npService + e.reactivated;
    e.sh += r.supplyHours;
    e.trips      += r.trips || 0;
    e.commission += r.commission || 0;
    e.gmv        += r.gmv || 0;
    // Tasas (NO se suman): sh_per_active_car es dato del export (no se recalcula
    // sh/cars: usa otro denominador), se pondera por active cars; acceptance (0-1)
    // se pondera por viajes. Se derivan abajo a partir de los acumuladores.
    e.activeCars += r.activeCars || 0;
    e._shCarW    += (r.shPerActiveCar || 0) * (r.activeCars || 0);
    e._acceptW   += (r.acceptanceRate || 0) * (r.trips || 0);
  });
  Object.values(byDate).forEach(e => {
    e.shCar  = e.activeCars > 0 ? e._shCarW / e.activeCars : 0;
    e.accept = e.trips > 0 ? e._acceptW / e.trips : 0;
  });
  return dates.map(d => byDate[d] || _blank(d, false));
}

// ── RENDER PRINCIPAL ──────────────────────────────────────────────────────────
function renderPartnerView() {
  const el = document.getElementById("partnerViewContent");
  if (!el) return;
  ensureIndexes();
  _pvDestroyCharts();
  // Carga diferida del funnel de conversion (re-render cuando llegue).
  if (!STATE._conversionLoaded) {
    loadConversionIfNeeded().then(() => { if (STATE.curTab === "partnerview") renderPartnerView(); });
  }
  // Reset _seriesCache: la siguiente seccion lo repuebla solo para el render
  // actual. Evita acumulacion sin limite si el usuario navega muchos partners.
  PARTNER_VIEW_STATE._seriesCache = {};
  PARTNER_VIEW_STATE._scopeCache  = {};   // memo de _pvScopeSeries para este render

  if (!STATE.rawData.length) {
    el.innerHTML = `<div class="empty"><p>Carga datos de <strong>Rendimiento</strong> para usar Vista Partner.</p></div>`;
    return;
  }

  const partners = STATE.allPartners || [];
  if (!partners.length) {
    el.innerHTML = `<div class="empty"><p>No hay partners cargados.</p></div>`;
    return;
  }

  // Estado: partner seleccionado (default = primero)
  if (!PARTNER_VIEW_STATE.partner || !partners.includes(PARTNER_VIEW_STATE.partner)) {
    PARTNER_VIEW_STATE.partner = partners[0];
  }
  const partner = PARTNER_VIEW_STATE.partner;

  // Período auto-detect por escala
  const period = PARTNER_VIEW_STATE.period;
  const nPoints = period === "auto"
    ? _pvDefaultPoints(STATE.curMode)
    : (period === "3m" ? 3 : period === "6m" ? 6 : period === "12m" ? 12 : 13);
  const dates = _pvLastNDates(nPoints);
  if (!dates.length) {
    el.innerHTML = `<div class="empty"><p>Sin fechas disponibles en este modo.</p></div>`;
    return;
  }

  // Ciudades donde opera este partner (>= 1 row con datos)
  const partnerRows = STATE._byPartner?.get(partner) || STATE.rawData.filter(r => r.partner === partner);
  const citiesOf = [...new Set(partnerRows.map(r => r.city).filter(Boolean))].sort();
  const kam = getKAMForPartner(partner) || partnerRows[0]?.kam || "Sin KAM";

  // Detectar si recibe leads Yango (algún new_from_service > 0 históricamente)
  const recibeLeads = partnerRows.some(r => r.newService > 0);

  // KPIs globales del partner: último período del rango
  const lastDate = dates[dates.length - 1];
  const prevDate = dates.length > 1 ? dates[dates.length - 2] : null;
  const lastRows = partnerRows.filter(r => r.date === lastDate);
  const prevRows = prevDate ? partnerRows.filter(r => r.date === prevDate) : [];
  // AD global del último período = suma por ciudad (cada ciudad ya suma sus sub-flotas).
  const adByCityLast = {};
  lastRows.forEach(r => { adByCityLast[r.city] = (adByCityLast[r.city] || 0) + r.activeDrivers; });
  const tADsum = Object.values(adByCityLast).reduce((s, v) => s + v, 0);
  const tNR = lastRows.reduce((s, r) => s + r.newPartner + r.newService + r.reactivated, 0);
  const tSH = lastRows.reduce((s, r) => s + r.supplyHours, 0);
  const tTr = lastRows.reduce((s, r) => s + (r.trips || 0), 0);
  const tCo = lastRows.reduce((s, r) => s + (r.commission || 0), 0);
  const pAD = prevRows.reduce((acc, r) => { acc[r.city] = (acc[r.city] || 0) + r.activeDrivers; return acc; }, {});
  const pADsum = Object.values(pAD).reduce((s, v) => s + v, 0);
  const pNR = prevRows.reduce((s, r) => s + r.newPartner + r.newService + r.reactivated, 0);
  const pSH = prevRows.reduce((s, r) => s + r.supplyHours, 0);

  // Building HTML
  const partnerColor = STATE.partnerColors[partner] || "#FF0000";
  const unitKey = STATE.curMode === "mensual" ? "months"
                : STATE.curMode === "diario"  ? "days"
                : "weeks";
  const periodLabel = `${nPoints} ${_t(unitKey)}`;
  const scaleLabel  = STATE.curMode === "mensual" ? _t("scaleMonthly")
                    : STATE.curMode === "diario"  ? _t("scaleDaily")
                    : _t("scaleWeekly");
  const isEN = PARTNER_VIEW_STATE.lang === "en";
  const langBtnStyle = on => `padding:6px 11px;font-size:.74rem;font-weight:700;border:1px solid #ddd;cursor:pointer;background:${on?'#0ea5e9':'#fff'};color:${on?'#fff':'#555'};border-radius:6px`;

  let html = `
    <div style="padding:0 8px 16px">
      <!-- Controles -->
      <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin:8px 0 16px">
        <div style="position:relative">
          <label style="font-size:.68rem;color:#666;font-weight:700;display:block;margin-bottom:3px;text-transform:uppercase;letter-spacing:.5px">${_t("partner")}</label>
          <input type="text" id="pvSearch" class="sb-inp" placeholder="${_t("searchPartner")}" style="width:240px" autocomplete="off"
            value="${escapeHTML(partner)}"
            oninput="pvFilterPartners(this.value)"
            onfocus="pvShowPartnerList()"
            onblur="setTimeout(pvHidePartnerList, 200)"
            onkeydown="pvSearchKeydown(event)"/>
          <div id="pvPartnerList" style="display:none;position:absolute;top:100%;left:0;width:240px;max-height:280px;overflow-y:auto;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.12);z-index:100;margin-top:2px"></div>
        </div>
        <div>
          <label style="font-size:.68rem;color:#666;font-weight:700;display:block;margin-bottom:3px;text-transform:uppercase;letter-spacing:.5px">${_t("period")}</label>
          <select id="pvPeriodSel" class="sb-sel" style="width:200px" onchange="pvOnPeriodChange(this.value)">
            ${_pvPeriodOptions(period, periodLabel)}
          </select>
        </div>
        <div>
          <label style="font-size:.68rem;color:#666;font-weight:700;display:block;margin-bottom:3px;text-transform:uppercase;letter-spacing:.5px">${_t("language")}</label>
          <div style="display:flex;gap:4px">
            <button onclick="pvSetLang('es')" style="${langBtnStyle(!isEN)}">ES</button>
            <button onclick="pvSetLang('en')" style="${langBtnStyle(isEN)}">EN</button>
          </div>
        </div>
        <button style="padding:8px 16px;margin-left:auto;background:#FF0000;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:.85rem" onclick="pvDownloadPDF()">
          ${_t("downloadPDF")}
        </button>
      </div>

      <!-- Header partner -->
      <div style="background:linear-gradient(135deg,${partnerColor}10 0%,#fff 100%);border-left:4px solid ${partnerColor};border-radius:10px;padding:14px 18px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <span style="width:12px;height:12px;border-radius:50%;background:${partnerColor}"></span>
          <span style="font-size:1.25rem;font-weight:900;color:#111">${escapeHTML(partner)}</span>
          <span style="background:${KAM_COLORS[kam]||"#888"};color:#fff;font-size:.7rem;font-weight:700;padding:3px 8px;border-radius:12px;margin-left:8px">${escapeHTML(kam)}</span>
        </div>
        <div style="font-size:.78rem;color:#666">
          ${_t("cities")}: <strong>${citiesOf.map(escapeHTML).join(" · ")}</strong>
          ${recibeLeads ? ` <span style="margin-left:10px;font-size:.7rem;background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:8px">${_t("receivesLeads")}</span>` : ""}
          <br>${_t("periodPrefix")} ${d2s(dates[0])} → ${d2s(lastDate)} · ${_t("scalePrefix")} <strong>${scaleLabel}</strong>
        </div>
      </div>

      <!-- Análisis Ejecutivo (KAM Senior) -->
      ${_pvExecutiveSummary({
        partner, citiesOf, dates, recibeLeads, lastDate, prevDate,
        partnerRows, lastRows, prevRows,
        tADsum, pADsum, tNR, pNR, tSH, pSH, tTr, tCo
      })}

      <!-- KPIs globales (partner a nivel Perú = combinado de sus ciudades) -->
      ${_secH("⚡", "#FF0000", _t("kpisTitle"), `${d2s(lastDate)}`)}
      ${_pvScopeKpiRow(partner, null, dates)}

      <!-- Perú (General): el partner combinando sus 3 ciudades -->
      ${_secH("🇵🇪", "#FF0000", _t("peruGeneral"), _t("peruGeneralSub"))}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 10px">
        <span style="font-size:.72rem;color:#666;font-weight:700">${_t("compareWith")}:</span>
        <span id="pvCohortBar" style="display:flex;gap:8px;flex-wrap:wrap">${PV_COHORT_BANDS.map(b => _pvCohortBtn(b)).join("")}</span>
        ${_pvLegendBtnHtml()}
        ${_pvShareBtnHtml()}
      </div>
      <div class="section">${_pvScopeBlock(null, "peru")}</div>
      ${_pvConversionSection(partner)}
      ${_pvChannelSection(partner)}

      <!-- Detalle por provincia (mismos KPIs + misma comparación) -->
      ${_secH("🏙️", "#06b6d4", _t("cityDetail"), `${citiesOf.length} ${citiesOf.length>1?_t("cityCountPlural"):_t("cityCount")} · ${periodLabel}`)}
      ${citiesOf.map(city => `
        <div class="section" style="margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <span style="width:12px;height:12px;border-radius:50%;background:${CITY_COLORS[city] || "#888"}"></span>
            <span style="font-size:1rem;font-weight:800;color:#111">${escapeHTML(cityLabel(city))}</span>
          </div>
          ${_pvScopeKpiRow(partner, city, dates)}
          ${_pvScopeBlock(city, _pvCityId(city))}
        </div>`).join("")}
    </div>`;

  // Banner: sección en revisión → recomendar Presentación 2.0 (fuente 100% precisa).
  const _pvEs = (PARTNER_VIEW_STATE.lang || "es") === "es";
  const pvBanner = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-left:5px solid #FF0000;border-radius:10px;padding:11px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
      <span style="font-size:1.3rem;line-height:1">🚧</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;color:#b91c1c;font-size:.9rem">${_pvEs ? "Estamos afinando esta sección" : "We're refining this section"}</div>
        <div style="font-size:.8rem;color:#7f1d1d;line-height:1.35">${_pvEs
          ? "Para métricas 100% precisas usá <b>Presentación 2.0</b> mientras terminamos de validar Vista Partner."
          : "For 100% accurate metrics use <b>Presentation 2.0</b> while we finish validating Partner View."}</div>
      </div>
      <button onclick="switchTab('present2')" style="flex:0 0 auto;background:#FF0000;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:.82rem;font-weight:700;cursor:pointer;white-space:nowrap">${_pvEs ? "Ir a Presentación 2.0 →" : "Go to Presentation 2.0 →"}</button>
    </div>`;

  // Marca de render unica para evitar race conditions de setTimeout
  const renderId = (PARTNER_VIEW_STATE._renderId = (PARTNER_VIEW_STATE._renderId || 0) + 1);
  el.innerHTML = pvBanner + html;

  // Construir charts despues de innerHTML. Si llega otro render antes,
  // el renderId cambia y el setTimeout previo se ignora.
  // Closure para reconstruir los charts de todos los scopes (Perú + provincias)
  // con el estado de cohortes actual. La usa el toggle para no re-renderizar todo.
  PARTNER_VIEW_STATE._rebuildScopes = () => {
    _pvBuildScopeCharts(partner, null, "peru", dates, recibeLeads);
    citiesOf.forEach(city => _pvBuildScopeCharts(partner, city, _pvCityId(city), dates, recibeLeads));
  };
  setTimeout(() => {
    if (renderId !== PARTNER_VIEW_STATE._renderId) return;
    PARTNER_VIEW_STATE._rebuildScopes();
    _pvConvMountChart(partner);
    _pvChannelMountChart(partner);
  }, 100);
}

// ── ANALISIS EJECUTIVO (KAM SENIOR) ───────────────────────────────────────────
// Detecta señales relevantes y produce bullets accionables. Pensado para que el
// KAM tenga un "primer vistazo" de qué pasa con el partner y qué hacer esta
// semana. No es IA — son reglas determinísticas basadas en thresholds que un
// KAM senior aplicaria mentalmente. Severidad: red > yellow > green > info.
function _pvExecutiveSummary(ctx) {
  const {
    partner, citiesOf, dates, recibeLeads, lastDate, prevDate,
    partnerRows, lastRows, prevRows,
    tADsum, pADsum, tNR, pNR, tSH, pSH, tTr, tCo
  } = ctx;

  const findings = [];
  const periodKey = STATE.curMode === "mensual" ? "month"
                  : STATE.curMode === "diario"  ? "day"
                  : "week";
  const periodsKey = STATE.curMode === "mensual" ? "months"
                   : STATE.curMode === "diario"  ? "days"
                   : "weeks";
  const period  = _t(periodKey);
  const periods = _t(periodsKey);

  // ── 1. Declive consecutivo por ciudad (rojo) ──────────────────────────────
  if (STATE.curMode !== "diario") {
    citiesOf.forEach(city => {
      const cityRows = partnerRows.filter(r => r.city === city);
      const apdMap = new Map();
      const dedup = new Map();
      cityRows.forEach(r => {
        const k = `${r.date}`;
        const ex = dedup.get(k) || { partner, date: r.date, activeDrivers: 0, newPartner: 0, newService: 0, reactivated: 0, supplyHours: 0 };
        ex.activeDrivers += r.activeDrivers || 0;   // AD = suma de sub-flotas (fleetroom), no MAX
        ex.newPartner   += r.newPartner;
        ex.newService   += r.newService;
        ex.reactivated  += r.reactivated;
        ex.supplyHours  += r.supplyHours;
        dedup.set(k, ex);
      });
      apdMap.set(partner, [...dedup.values()]);
      if (hasConsecutiveDecline(apdMap, partner)) {
        const n = STATE.declineThreshold || 3;
        const metricKey = { activeDrivers: "metricActiveDrivers", supplyHours: "metricSupplyHours", nr: "metricNR" }[STATE.declineMetric] || "metricActiveDrivers";
        const metric = _t(metricKey);
        findings.push({
          sev: "red", icon: "🔴",
          title:  _t("declineTitle",  { city: cityLabel(city) }),
          body:   _t("declineBody",   { metric, n, periods }),
          action: _t("declineAction", { period })
        });
      }
    });
  }

  // ── 2. Variacion AD global (MoM) — se CALCULA aquí; se EMITE en el bloque
  //       unificado de AD (#5b), combinada con la tendencia 3m, para no
  //       contradecirse (antes salían "Caída fuerte" y "Crecimiento" a la vez).
  const wowAD = pADsum > 0 ? ((tADsum - pADsum) / pADsum) * 100 : null;

  // ── 3. N+R: caída a cero ──────────────────────────────────────────────────
  if (tNR === 0 && pNR > 0) {
    findings.push({
      sev: "red", icon: "🔴",
      title:  _t("nrZeroTitle",  { period }),
      body:   _t("nrZeroBody",   { period, prev: pNR }),
      action: _t("nrZeroAction")
    });
  } else if (pNR > 0 && tNR / pNR < 0.4 && pNR >= 5) {
    findings.push({
      sev: "yellow", icon: "🟡",
      title:  _t("nrDropTitle",  { cur: tNR, prev: pNR }),
      body:   _t("nrDropBody"),
      action: _t("nrDropAction")
    });
  }

  // ── 4. Recibe leads Yango pero AD no crece ────────────────────────────────
  if (recibeLeads) {
    const leadsLast = lastRows.reduce((s, r) => s + (r.newService || 0), 0);
    if (leadsLast >= 5 && wowAD !== null && wowAD < 3 && wowAD > -5) {
      findings.push({
        sev: "yellow", icon: "🟡",
        title:  _t("leadsTitle",  { leads: leadsLast }),
        body:   _t("leadsBody"),
        action: _t("leadsAction")
      });
    }
  }

  // ── 5. Tendencia AD mediano plazo (avg 3 ultimos vs 3 anteriores) ────────
  // Serie del partner por fecha = SUMA de todas sus filas (sub-flotas fleetroom + ciudades).
  // Antes deduplicaba por clid|city|date quedándose con la PRIMERA fila → sub-contaba el AD
  // desde el split de fleetrooms (2026-03), inflando volatilidad y el % de pico y disparando
  // falsas señales de caída (contradecía el MoM que sí suma). dropLegacyAggregateRows ya quitó
  // los agregados legacy, así que sumar = total correcto (igual que _pvSeriesByPartnerCity).
  // NO emite card aquí: alimenta adTrend, que el bloque unificado (#5b) combina con wowAD.
  let adTrend = null;  // { chg, avgL, avgP } cuando hay >= 6 periodos
  if (dates.length >= 6) {
    const adByDate = {};
    partnerRows.forEach(r => { adByDate[r.date] = (adByDate[r.date] || 0) + (r.activeDrivers || 0); });
    const serieAD = dates.map(d => adByDate[d] || 0);
    const last3 = serieAD.slice(-3);
    const prev3 = serieAD.slice(-6, -3);
    const sumL = last3.reduce((s, x) => s + x, 0);
    const sumP = prev3.reduce((s, x) => s + x, 0);
    if (sumP > 0) {
      adTrend = { chg: ((sumL - sumP) / sumP) * 100, avgL: Math.round(sumL / 3), avgP: Math.round(sumP / 3) };
    }

    // ── 6. Volatilidad: coeficiente de variacion en AD ────────────────────
    const filtered = serieAD.filter(x => x > 0);
    if (filtered.length >= 4) {
      const mean = filtered.reduce((s, x) => s + x, 0) / filtered.length;
      const variance = filtered.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / filtered.length;
      const stdev = Math.sqrt(variance);
      const cv = mean > 0 ? stdev / mean : 0;
      if (cv >= 0.25) {
        findings.push({
          sev: "yellow", icon: "🟡",
          title:  _t("volatilityTitle"),
          body:   _t("volatilityBody", { periods }),
          action: _t("volatilityAction")
        });
      }
    }

    // ── 7. Pico histórico vs actual ────────────────────────────────────────
    // Pico sobre TODO el historial cargado del partner (todas las fechas, no solo
    // la ventana visible) para que "mejor registro histórico" sea literal. adByDate
    // ya agrega la suma de sub-flotas por fecha en todo el rango del dataset.
    const allAdByDate = Object.values(adByDate);
    const peak = allAdByDate.length ? Math.max(...allAdByDate) : 0;
    if (peak > 0 && tADsum > 0) {
      const ratio = (tADsum / peak) * 100;
      if (ratio >= 95) {
        findings.push({
          sev: "green", icon: "🟢",
          title:  _t("peakBestTitle"),
          body:   _t("peakBestBody", { cur: tADsum.toLocaleString(), pct: ratio.toFixed(0), peak: peak.toLocaleString() }),
          action: _t("peakBestAction")
        });
      } else if (ratio < 60) {
        findings.push({
          sev: "yellow", icon: "🟡",
          title:  _t("peakLowTitle"),
          body:   _t("peakLowBody",  { cur: tADsum.toLocaleString(), pct: ratio.toFixed(0), peak: peak.toLocaleString() }),
          action: _t("peakLowAction", { peak: peak.toLocaleString() })
        });
      }
    }
  }

  // ── 5b. AD UNIFICADO: reconcilia MoM (wowAD) con tendencia 3m (adTrend) ───
  // Un solo hallazgo de Conductores Activos. Antes #2 y #5 emitían cards por
  // separado y podían contradecirse ("Caída fuerte" rojo + "Crecimiento
  // sostenido" verde a la vez). Mismos umbrales de siempre (MoM ±5/±15, 3m ±5).
  if (wowAD !== null) {
    const momPct   = (wowAD >= 0 ? "+" : "") + wowAD.toFixed(1);   // p.ej. "-28.3"
    const momAbs   = Math.abs(wowAD).toFixed(1);
    const trendAbs = adTrend ? Math.abs(adTrend.chg).toFixed(1) : null;
    const mom = { prev: pADsum.toLocaleString(), cur: tADsum.toLocaleString(), pct: momPct, period };
    const tr  = adTrend
      ? { periods, pct: trendAbs, prevAvg: adTrend.avgP.toLocaleString(), curAvg: adTrend.avgL.toLocaleString() }
      : null;
    const mix = { period, periods, momAbs, prev: mom.prev, cur: mom.cur, trendAbs,
                  prevAvg: tr ? tr.prevAvg : "", curAvg: tr ? tr.curAvg : "" };

    const momDown  = wowAD <= -5;
    const momSharp = wowAD <= -15;
    const momUp    = wowAD >= 15;
    const trUp     = adTrend && adTrend.chg >= 5;
    const trDown   = adTrend && adTrend.chg <= -5;

    if (momDown && trUp) {
      // señal mixta: bajón reciente pero la tendencia 3m sigue positiva
      findings.push({ sev: "yellow", icon: "🟡",
        title: _t("adMixDownUpTitle"), body: _t("adMixDownUpBody", mix), action: _t("adMixDownUpAction", mix) });
    } else if (momUp && trDown) {
      // señal mixta: rebote reciente pero la tendencia 3m viene a la baja
      findings.push({ sev: "yellow", icon: "🟡",
        title: _t("adMixUpDownTitle"), body: _t("adMixUpDownBody", mix), action: _t("adMixUpDownAction", mix) });
    } else if (momSharp) {
      findings.push({ sev: "red", icon: "🔴",
        title: _t("adDropSharpTitle"), body: _t("adDropSharpBody", mom), action: _t("adDropSharpAction") });
    } else if (momDown) {
      findings.push({ sev: "yellow", icon: "🟡",
        title: _t("adDropModTitle", { pct: wowAD.toFixed(1) }), body: _t("adDropModBody", { prev: pADsum, cur: tADsum }), action: _t("adDropModAction", { periods }) });
    } else if (trDown) {
      findings.push({ sev: "red", icon: "🔴",
        title: _t("trendDownTitle"), body: _t("trendDownBody", tr), action: _t("trendDownAction") });
    } else if (momUp) {
      findings.push({ sev: "green", icon: "🟢",
        title: _t("adGrowTitle", { pct: wowAD.toFixed(1) }), body: _t("adGrowBody", { prev: pADsum.toLocaleString(), cur: tADsum.toLocaleString() }), action: _t("adGrowAction", { period }) });
    } else if (trUp) {
      findings.push({ sev: "green", icon: "🟢",
        title: _t("trendUpTitle"), body: _t("trendUpBody", tr), action: _t("trendUpAction") });
    }
  }

  // ── 8. Productividad SH/AD (normalizada a horas SEMANALES por conductor) ───
  // tSH es el TOTAL del período (semana/mes/día). Se normaliza a equivalente
  // semanal para que el referente (20h/35h por conductor·semana) signifique lo
  // mismo en cualquier escala. Antes el umbral fijo se comparaba contra el total
  // del período → en mensual TODOS superaban 35h ("sobresaliente" falso) y en
  // diario ninguno llegaba a 20h ("baja" falso).
  if (tADsum > 0 && tSH > 0) {
    const weeksPerPeriod = STATE.curMode === "mensual" ? 365.25 / 12 / 7   // ≈4.35 semanas/mes
                         : STATE.curMode === "diario"  ? 1 / 7             // 1 día = 1/7 de semana
                         : 1;                                              // semanal: tal cual
    const ratio = (tSH / tADsum) / weeksPerPeriod;  // horas semanales por conductor
    if (ratio < 20) {
      findings.push({
        sev: "yellow", icon: "🟡",
        title:  _t("prodLowTitle"),
        body:   _t("prodLowBody",  { hours: ratio.toFixed(1) }),
        action: _t("prodLowAction")
      });
    } else if (ratio > 35) {
      findings.push({
        sev: "green", icon: "🟢",
        title:  _t("prodHighTitle"),
        body:   _t("prodHighBody", { hours: ratio.toFixed(1) }),
        action: _t("prodHighAction")
      });
    }
  }

  // ── 9. Comision por viaje (commission/trips) ────────────────────────────
  const pTr0 = prevRows.reduce((s, r) => s + (r.trips || 0), 0);
  const pCo0 = prevRows.reduce((s, r) => s + (r.commission || 0), 0);
  if (pTr0 > 0 && pCo0 > 0 && tTr > 0 && tCo > 0) {
    const cpPrev = pCo0 / pTr0;
    const cpCur  = tCo  / tTr;
    if (cpPrev > 0) {
      const drop = ((cpPrev - cpCur) / cpPrev) * 100;
      if (drop >= 10) {
        findings.push({
          sev: "yellow", icon: "🟡",
          title:  _t("commPerTripTitle"),
          body:   _t("commPerTripBody", { prev: "$" + cpPrev.toFixed(2), cur: "$" + cpCur.toFixed(2), pct: drop.toFixed(1) }),
          action: _t("commPerTripAction")
        });
      }
    }
  }

  // ── 10. Dependencia de leads Yango ───────────────────────────────────────
  if (recibeLeads) {
    const totalNew = lastRows.reduce((s, r) => s + (r.newPartner || 0) + (r.newService || 0) + (r.reactivated || 0), 0);
    const yangoNew = lastRows.reduce((s, r) => s + (r.newService || 0), 0);
    if (totalNew >= 5 && yangoNew / totalNew >= 0.5) {
      findings.push({
        sev: "yellow", icon: "🟡",
        title:  _t("leadDepTitle"),
        body:   _t("leadDepBody", { pct: ((yangoNew / totalNew) * 100).toFixed(0), yango: yangoNew, total: totalNew }),
        action: _t("leadDepAction")
      });
    }
  }

  // ── 11. Brecha entre ciudades (multi-ciudad) ─────────────────────────────
  if (citiesOf.length >= 2) {
    const cityPerf = citiesOf.map(c => {
      const last = lastRows.filter(r => r.city === c);
      const ad = last.reduce((s, r) => s + r.activeDrivers, 0);
      return { city: c, ad };
    }).filter(x => x.ad > 0).sort((a, b) => b.ad - a.ad);
    if (cityPerf.length >= 2) {
      const best = cityPerf[0];
      const worst = cityPerf[cityPerf.length - 1];
      const ratio = best.ad / worst.ad;
      if (ratio >= 2.5) {
        const opts = { best: cityLabel(best.city), bestAd: best.ad, worst: cityLabel(worst.city), worstAd: worst.ad, ratio: ratio.toFixed(1) };
        findings.push({
          sev: "yellow", icon: "🟡",
          title:  _t("cityGapTitle"),
          body:   _t("cityGapBody", opts),
          action: _t("cityGapAction", opts)
        });
      }
    }
  }

  // ── 7. Comisión baja sin caída en viajes ─────────────────────────────────
  const pTr = prevRows.reduce((s, r) => s + (r.trips || 0), 0);
  const pCo = prevRows.reduce((s, r) => s + (r.commission || 0), 0);
  if (pTr > 0 && pCo > 0) {
    const wowTr = ((tTr - pTr) / pTr) * 100;
    const wowCo = ((tCo - pCo) / pCo) * 100;
    if (wowCo < -10 && wowTr > -3) {
      findings.push({
        sev: "yellow", icon: "🟡",
        title:  _t("commTitle"),
        body:   _t("commBody",   { trPct: (wowTr >= 0 ? "+" : "") + wowTr.toFixed(1), coPct: wowCo.toFixed(1) }),
        action: _t("commAction")
      });
    }
  }

  // ── 8. Si no hay alertas, mostrar mensaje positivo ────────────────────────
  if (!findings.length && pADsum > 0) {
    findings.push({
      sev: "green", icon: "✅",
      title:  _t("noAlertsTitle"),
      body:   _t("noAlertsBody"),
      action: _t("noAlertsAction", { period })
    });
  }

  // ── Ordenar y limitar a 6 hallazgos máximo ────────────────────────────────
  const sevOrder = { red: 0, yellow: 1, info: 2, green: 3 };
  findings.sort((a, b) => sevOrder[a.sev] - sevOrder[b.sev]);
  const top = findings.slice(0, 6);

  // ── Render ────────────────────────────────────────────────────────────────
  const sevStyle = {
    red:    { bg:"#fff5f5", bd:"#fecaca", tc:"#991b1b" },
    yellow: { bg:"#fffbeb", bd:"#fde68a", tc:"#92400e" },
    green:  { bg:"#f0fdf4", bd:"#86efac", tc:"#166534" },
    info:   { bg:"#f0f9ff", bd:"#bae6fd", tc:"#075985" }
  };

  const items = top.map(f => {
    const s = sevStyle[f.sev] || sevStyle.info;
    return `
      <div style="background:${s.bg};border:1px solid ${s.bd};border-left:4px solid ${s.tc};border-radius:8px;padding:12px 14px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:1rem">${f.icon}</span>
          <span style="font-weight:800;color:${s.tc};font-size:.88rem">${escapeHTML(f.title)}</span>
        </div>
        <div style="font-size:.78rem;color:#333;margin-bottom:6px;line-height:1.4">${escapeHTML(f.body)}</div>
        <div style="font-size:.76rem;color:#555;line-height:1.45">
          <strong style="color:${s.tc}">${_t("actionLabel")}</strong> ${escapeHTML(f.action)}
        </div>
      </div>`;
  }).join("");

  const findingsWord = top.length === 1 ? _t("findingsOne") : _t("findingsMany");
  const headerSub = `${top.length} ${findingsWord} · ${_t("execSummarySub")}`;
  return `
    ${_secH("💼", "#0ea5e9", _t("execSummary"), headerSub)}
    <div class="section" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px">
      ${items}
    </div>`;
}

function _pvKpiCard(label, cur, prev, color, opts = {}) {
  // opts: { isMoney, useK }
  // - isMoney: prefijo $ en el valor
  // - useK: usar fmtSmart (X.XK / X.XM con 1 decimal) en vez de fmt
  const isMoney = opts === true || (opts && opts.isMoney);  // compat con llamada legacy
  const useK    = opts && opts.useK;
  const formatN = useK ? fmtSmart : fmt;
  const value = isMoney ? `$${formatN(cur)}` : formatN(cur);
  const bdgHtml = prev !== null ? bdgMode(cur, prev, "mb-badge") : "";
  return `
    <div style="background:#fff;border:1px solid #eee;border-top:3px solid ${color};border-radius:10px;padding:10px 12px">
      <div style="font-size:.66rem;color:#666;font-weight:700;text-transform:uppercase;letter-spacing:.4px">${escapeHTML(label)}</div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-top:2px">
        <span style="font-size:1.15rem;font-weight:900;color:#111">${value}</span>
        ${bdgHtml}
      </div>
    </div>`;
}

// Fila de 6 tarjetas KPI de un scope (Perú-General si scopeCity=null, o una
// ciudad) con badge WoW/MoM. El badge lo resuelve bdgMode(), que respeta el
// filtro de escala (STATE.curMode): semanal→WoW, mensual→MoM, diario→sin badge.
// Usa _pvScopeSeries — la MISMA serie que alimenta los charts de abajo — para que
// cada tarjeta coincida con el último punto de su gráfico. El período previo solo
// genera badge si está presente (si no, sin comparación, no "NEW" engañoso).
function _pvScopeKpiRow(partner, scopeCity, dates) {
  const series = _pvScopeSeries(partner, scopeCity, dates);
  if (!series.length) return "";
  const last  = series[series.length - 1];
  const prevE = series.length > 1 ? series[series.length - 2] : null;
  const prev  = (prevE && prevE._present) ? prevE : null;
  const pv = k => prev ? (prev[k] || 0) : null;
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px">
    ${_pvKpiCard(_t("activeDrivers"), last.ad,         pv("ad"),         METRICS.ad.color)}
    ${_pvKpiCard(_t("newReact"),      last.nr,         pv("nr"),         METRICS.nr.color)}
    ${_pvKpiCard(_t("supplyHours"),   last.sh,         pv("sh"),         METRICS.sh.color, { useK: true })}
    ${_pvKpiCard(_t("trips"),         last.trips,      pv("trips"),      "#10b981",        { useK: true })}
    ${_pvKpiCard(_t("commission"),    last.commission, pv("commission"), "#06b6d4",        { isMoney: true, useK: true })}
    ${_pvKpiCard("GMV",               last.gmv,        pv("gmv"),        "#f59e0b",        { isMoney: true, useK: true })}
  </div>`;
}

function _pvCitySection(partner, city, dates, recibeLeads, seriesCached) {
  const cityColor = CITY_COLORS[city] || "#888";
  const series = seriesCached || _pvSeriesByPartnerCity(partner, city, dates);
  // Tendencia: comparar promedio últimos 3 vs anteriores 3 (si hay datos)
  let trendTxt = "—", trendCol = "#888";
  if (series.length >= 6) {
    const last3 = series.slice(-3);
    const prev3 = series.slice(-6, -3);
    const avgL = last3.reduce((s, x) => s + x.ad, 0) / 3;
    const avgP = prev3.reduce((s, x) => s + x.ad, 0) / 3;
    if (avgP > 0) {
      const chg = ((avgL - avgP) / avgP) * 100;
      const trendSuffix = PARTNER_VIEW_STATE.lang === "en"
        ? "AD (last 3 vs prev 3)"
        : "AD (últ. 3 vs ant. 3)";
      trendTxt = `${chg >= 0 ? "↑" : "↓"} ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% ${trendSuffix}`;
      trendCol = chg >= 0 ? "#10b981" : "#FF0000";
    }
  }

  const id = city.toLowerCase().replace(/[^a-z0-9]/g, "");
  const isEN = PARTNER_VIEW_STATE.lang === "en";
  const breakdownLabel = isEN ? "(breakdown)" : "(desglose)";
  const tripsCommLabel = isEN ? "Trips & Commission" : "Viajes & Comisión";
  const tblTotalLabel  = isEN ? "Total" : "Total";
  const tblNewPartner  = isEN ? "New (Partner)" : "Nuevos (Partner)";
  const tblNewYango    = isEN ? "New (Yango)"   : "Nuevos (Yango)";
  const tblReact       = isEN ? "Reactivated"   : "Reactivados";

  // Mini-tabla de desglose N+R por fecha. Garantiza que el detalle completo
  // (incluidos los segmentos chicos que no muestran numero en la barra) este
  // visible al exportar a PDF.
  const headerCells = [`<th style="text-align:left;padding:4px 6px;border-bottom:1px solid #eee;background:#f9f9f9">${isEN?"Date":"Fecha"}</th>`]
    .concat(dates.map(d => `<th style="text-align:right;padding:4px 6px;border-bottom:1px solid #eee;background:#f9f9f9;font-size:.65rem">${d2s(d)}</th>`))
    .join("");
  const _row = (label, getter, color) => {
    const cells = series.map(s => `<td style="text-align:right;padding:3px 6px;border-bottom:1px solid #f5f5f5">${fmt(getter(s))}</td>`).join("");
    return `<tr>
      <td style="padding:3px 6px;border-bottom:1px solid #f5f5f5;font-weight:600;color:${color}">
        <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};margin-right:4px"></span>${label}
      </td>${cells}
    </tr>`;
  };
  const nrTableRows = [
    _row(tblNewPartner, s => s.npPartner, "#3b82f6"),
    recibeLeads ? _row(tblNewYango, s => s.npService, "#f59e0b") : "",
    _row(tblReact, s => s.reactivated, "#10b981"),
    _row(tblTotalLabel, s => s.nr, "#111")
  ].filter(Boolean).join("");

  const nrTable = `
    <div style="margin-top:8px;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:.68rem;background:#fff;border:1px solid #f0f0f0;border-radius:6px">
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${nrTableRows}</tbody>
      </table>
    </div>`;

  return `
    <div style="border:1px solid #eee;border-top:3px solid ${cityColor};border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:12px;height:12px;border-radius:50%;background:${cityColor}"></span>
          <span style="font-size:1rem;font-weight:800;color:#111">${escapeHTML(cityLabel(city))}</span>
        </div>
        <span style="font-size:.72rem;color:${trendCol};font-weight:700">${trendTxt}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">
        <div class="chart-card"><div class="chart-head"><span class="chart-title">${escapeHTML(_t("activeDrivers"))}</span></div><div id="pv_${id}_ad"></div></div>
        <div class="chart-card"><div class="chart-head"><span class="chart-title">${escapeHTML(_t("supplyHours"))}</span></div><div id="pv_${id}_sh"></div></div>
        <div class="chart-card" style="grid-column:span 2"><div class="chart-head"><span class="chart-title">${escapeHTML(_t("newReact"))} ${recibeLeads ? breakdownLabel : ""}</span></div><div id="pv_${id}_nr"></div>${nrTable}</div>
        <div class="chart-card" style="grid-column:span 2"><div class="chart-head"><span class="chart-title">${escapeHTML(tripsCommLabel)}</span></div><div id="pv_${id}_tc"></div></div>
      </div>
    </div>`;
}

function _pvBuildCityCharts(partner, city, dates, recibeLeads, seriesCached) {
  const id = city.toLowerCase().replace(/[^a-z0-9]/g, "");
  const cityColor = CITY_COLORS[city] || "#888";
  const series = seriesCached || _pvSeriesByPartnerCity(partner, city, dates);
  const labels = dates.map(d2s);

  // Chart 1: AD (línea simple) — siempre numero exacto (sin K)
  _pvSimpleLine(`pv_${id}_ad`, labels, [{ name: "AD", data: series.map(s => s.ad) }], [cityColor]);

  // Chart 2: SH (línea simple) — formato K (1 decimal fijo) para no saturar
  _pvSimpleLine(`pv_${id}_sh`, labels, [{ name: "SH", data: series.map(s => s.sh) }], ["#8b5cf6"], fmtSmart);

  // Chart 3: N+R desglosado o agregado
  const isEN = PARTNER_VIEW_STATE.lang === "en";
  const lblNewPartner = isEN ? "New (Partner)" : "Nuevos (Partner)";
  const lblNewYango   = isEN ? "New (Yango)"   : "Nuevos (Yango)";
  const lblReact      = isEN ? "Reactivated"   : "Reactivados";
  const nrSeries = recibeLeads
    ? [
        { name: lblNewPartner, data: series.map(s => s.npPartner) },
        { name: lblNewYango,   data: series.map(s => s.npService) },
        { name: lblReact,      data: series.map(s => s.reactivated) }
      ]
    : [
        { name: lblNewPartner, data: series.map(s => s.npPartner) },
        { name: lblReact,      data: series.map(s => s.reactivated) }
      ];
  const nrColors = recibeLeads ? ["#3b82f6", "#f59e0b", "#10b981"] : ["#3b82f6", "#10b981"];
  _pvStackedColumn(`pv_${id}_nr`, labels, nrSeries, nrColors);

  // Chart 4: Trips & Commission (mixed)
  _pvDualLine(`pv_${id}_tc`, labels,
    [{ name: _t("trips"),      data: series.map(s => s.trips) },
     { name: _t("commission"), data: series.map(s => s.commission) }],
    ["#10b981", "#06b6d4"]);
}

function _pvSimpleLine(elId, labels, series, colors, formatter) {
  const el = document.getElementById(elId);
  if (!el || typeof ApexCharts === "undefined") return;
  // Marcar el contenedor con clase para que las reglas CSS de fondo claro
  // (styles.css .pv-chart .apexcharts-datalabel-background) apliquen.
  el.classList.add("pv-chart");
  const fmtFn = formatter || (v => fmt(v));
  // Headroom + padding para que los dataLabels (pico y extremos) no se corten.
  const _vals = series.flatMap(s => (s.data || []).filter(v => v != null && !isNaN(v)));
  const _mx = _vals.length ? Math.max(..._vals) : 0;
  const _mn = _vals.length ? Math.min(..._vals) : 0;
  const yAxis = { labels: { formatter: v => fmtFn(v), style: { fontSize: "10px" } } };
  if (_mx > 0) { yAxis.max = _mx * 1.15; yAxis.min = Math.max(0, _mn * 0.94); yAxis.forceNiceScale = true; }
  const ch = new ApexCharts(el, {
    series,
    chart: { type: "line", height: 180, toolbar: { show: false }, animations: { enabled: false }, fontFamily: "inherit" },
    stroke: { curve: "smooth", width: 2.5 },
    colors,
    markers: { size: 3 },
    // dataLabels: numeros visibles sobre la linea SIN background (el background
    // de ApexCharts hereda el color de la serie y queda negro). Usamos un halo
    // blanco grueso via CSS (paint-order: stroke) para garantizar legibilidad.
    dataLabels: {
      enabled: true,
      formatter: v => fmtFn(v),
      style: { fontSize: "10px", colors: ["#111"], fontWeight: 700 },
      background: { enabled: false },
      offsetY: -10
    },
    xaxis: { categories: labels, labels: { style: { fontSize: "9px" }, rotate: -30 }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: yAxis,
    grid: { borderColor: "#f0f0f0", strokeDashArray: 4, padding: { top: 16, right: 22, left: 12, bottom: 0 } },
    tooltip: { y: { formatter: v => fmt(v) } },
    legend: { show: false }
  });
  ch.render();
  PARTNER_VIEW_STATE.charts.push(ch);
}

function _pvStackedColumn(elId, labels, series, colors) {
  const el = document.getElementById(elId);
  if (!el || typeof ApexCharts === "undefined") return;
  el.classList.add("pv-chart");
  // Headroom sobre el total de la barra mas alta para que su etiqueta no se corte.
  const _totals = labels.map((_, i) => series.reduce((s, ser) => s + (ser.data[i] || 0), 0));
  const _bmax = Math.max(0, ..._totals);
  const yAxis = { labels: { formatter: v => fmt(v), style: { fontSize: "10px" } } };
  if (_bmax > 0) { yAxis.max = _bmax * 1.18; yAxis.forceNiceScale = true; }
  const ch = new ApexCharts(el, {
    series,
    chart: { type: "bar", height: 200, stacked: true, toolbar: { show: false }, animations: { enabled: false }, fontFamily: "inherit" },
    plotOptions: {
      bar: {
        columnWidth: "60%",
        dataLabels: {
          position: "center",
          // Mostrar el TOTAL del stack arriba de cada barra (numero principal)
          total: {
            enabled: true,
            offsetY: -4,
            style: { fontSize: "11px", fontWeight: 800, color: "#111" },
            formatter: v => fmt(v)
          }
        }
      }
    },
    colors,
    // Etiqueta dentro del segmento: solo si el segmento >= 20% del total de su
    // barra (evita superposicion). Los segmentos chicos se ven por color pero
    // sin numero; el detalle queda en el tooltip y en la mini-tabla debajo.
    dataLabels: {
      enabled: true,
      formatter: function(val, opts) {
        if (!val || val <= 0) return "";
        const series = opts.w.config.series;
        const total = series.reduce((s, ser) => s + (ser.data[opts.dataPointIndex] || 0), 0);
        if (total === 0) return "";
        if (val / total < 0.20) return "";
        return fmt(val);
      },
      style: { fontSize: "9px", colors: ["#fff"], fontWeight: 800 },
      dropShadow: { enabled: true, top: 1, left: 1, blur: 1, opacity: .45 }
    },
    xaxis: { categories: labels, labels: { style: { fontSize: "9px" }, rotate: -30 } },
    yaxis: yAxis,
    grid: { borderColor: "#f0f0f0", strokeDashArray: 4, padding: { top: 16, right: 14, left: 12, bottom: 0 } },
    tooltip: { y: { formatter: v => fmt(v) } },
    legend: { position: "bottom", fontSize: "10px", itemMargin: { horizontal: 6 } }
  });
  ch.render();
  PARTNER_VIEW_STATE.charts.push(ch);
}

function _pvDualLine(elId, labels, series, colors) {
  const el = document.getElementById(elId);
  if (!el || typeof ApexCharts === "undefined") return;
  el.classList.add("pv-chart");
  // Ambas series usan fmtSmart (Viajes y Comision suelen ser numeros grandes).
  // seriesIndex 0 = Viajes (sin $), seriesIndex 1 = Comision (con $).
  const _dl = arr => { const v = (arr || []).filter(x => x != null && !isNaN(x)); return { mx: v.length ? Math.max(...v) : 0, mn: v.length ? Math.min(...v) : 0 }; };
  const _a0 = _dl(series[0] && series[0].data), _a1 = _dl(series[1] && series[1].data);
  const ch = new ApexCharts(el, {
    series,
    chart: { type: "line", height: 180, toolbar: { show: false }, animations: { enabled: false }, fontFamily: "inherit" },
    stroke: { curve: "smooth", width: [2.5, 2.5] },
    colors,
    markers: { size: 3 },
    dataLabels: {
      enabled: true,
      enabledOnSeries: [0, 1],
      formatter: (v, opts) => opts.seriesIndex === 1 ? "$" + fmtSmart(v) : fmtSmart(v),
      style: { fontSize: "10px", colors: ["#111"], fontWeight: 700 },
      background: { enabled: false },
      offsetY: -10
    },
    xaxis: { categories: labels, labels: { style: { fontSize: "9px" }, rotate: -30 } },
    yaxis: [
      { seriesName: (series[0] && series[0].name) || "Viajes",
        ...(_a0.mx > 0 ? { max: _a0.mx * 1.15, min: Math.max(0, _a0.mn * 0.9), forceNiceScale: true } : {}),
        labels: { formatter: v => fmtSmart(v), style: { fontSize: "10px" } } },
      { opposite: true, seriesName: (series[1] && series[1].name) || "Comisión",
        ...(_a1.mx > 0 ? { max: _a1.mx * 1.15, min: Math.max(0, _a1.mn * 0.9), forceNiceScale: true } : {}),
        labels: { formatter: v => "$" + fmtSmart(v), style: { fontSize: "10px" } } }
    ],
    grid: { borderColor: "#f0f0f0", strokeDashArray: 4, padding: { top: 16, right: 18, left: 12, bottom: 0 } },
    tooltip: { y: { formatter: (v, { seriesIndex }) => seriesIndex === 1 ? "$" + fmtSmart(v) : fmtSmart(v) } },
    legend: { position: "bottom", fontSize: "10px" }
  });
  ch.render();
  PARTNER_VIEW_STATE.charts.push(ch);
}

// ── INTERACCIONES ─────────────────────────────────────────────────────────────
function pvOnPartnerChange(p) {
  PARTNER_VIEW_STATE.partner = p;
  renderPartnerView();
}

function pvOnPeriodChange(p) {
  PARTNER_VIEW_STATE.period = p;
  renderPartnerView();
}

// Cambia el idioma de la Vista Partner (afecta panel ejecutivo, headers y PDF)
function pvSetLang(lang) {
  if (lang !== "es" && lang !== "en") return;
  if (PARTNER_VIEW_STATE.lang === lang) return;
  PARTNER_VIEW_STATE.lang = lang;
  renderPartnerView();
}

// ── COMBOBOX FLOTANTE DE PARTNERS ─────────────────────────────────────────────
// Reemplaza el <select> nativo que se cerraba en cada keystroke. La lista es
// un <div> flotante que NO se re-renderiza (solo cambian items visibles),
// asi que el input nunca pierde focus y se puede hacer click en una opcion.
function pvFilterPartners(q) {
  pvShowPartnerList();
  _pvPaintPartnerList(q);
}

function pvShowPartnerList() {
  const list = document.getElementById("pvPartnerList");
  if (!list) return;
  list.style.display = "block";
  if (!list.innerHTML) {
    const inp = document.getElementById("pvSearch");
    _pvPaintPartnerList(inp ? inp.value : "");
  }
}

function pvHidePartnerList() {
  const list = document.getElementById("pvPartnerList");
  if (list) list.style.display = "none";
}

function _pvPaintPartnerList(q) {
  const list = document.getElementById("pvPartnerList");
  if (!list) return;
  const lower = (q || "").toLowerCase().trim();
  const filtered = lower
    ? STATE.allPartners.filter(p => p.toLowerCase().includes(lower))
    : STATE.allPartners;
  if (!filtered.length) {
    list.innerHTML = `<div style="padding:8px 12px;font-size:.78rem;color:#aaa">Sin coincidencias</div>`;
    return;
  }
  list.innerHTML = filtered.slice(0, 100).map(p => {
    const c = STATE.partnerColors[p] || "#888";
    const sel = p === PARTNER_VIEW_STATE.partner;
    return `<div class="pv-opt" onmousedown="pvSelectPartner('${p.replace(/'/g,"\\'")}')"
      style="padding:7px 12px;font-size:.78rem;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid #f3f3f3;${sel?'background:#fff0f0;font-weight:700':''}">
      <span style="width:7px;height:7px;border-radius:50%;background:${c};flex-shrink:0"></span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(p)}</span>
    </div>`;
  }).join("");
}

function pvSelectPartner(p) {
  // onmousedown asegura que esto corra ANTES del onblur del input (que oculta la lista)
  const inp = document.getElementById("pvSearch");
  if (inp) inp.value = p;
  pvHidePartnerList();
  pvOnPartnerChange(p);
}

function pvSearchKeydown(e) {
  if (e.key === "Enter") {
    const list = document.getElementById("pvPartnerList");
    const first = list && list.querySelector(".pv-opt");
    if (first) {
      // Reusar el handler del onmousedown
      first.dispatchEvent(new MouseEvent("mousedown"));
    }
    e.preventDefault();
  } else if (e.key === "Escape") {
    pvHidePartnerList();
  }
}

// ── OPCIONES DINAMICAS DE PERIODO ─────────────────────────────────────────────
// Etiquetas claras segun el modo actual (semanal/mensual/diario). Antes decian
// "Ultimos 3 (cortos)", "Ultimos 6" sin unidad — confuso.
function _pvPeriodOptions(period, periodLabel) {
  const mode = STATE.curMode;
  const unit = mode === "mensual" ? "meses" : mode === "diario" ? "días" : "semanas";
  return `
    <option value="auto" ${period==="auto"?"selected":""}>Auto (${periodLabel})</option>
    <option value="3m"   ${period==="3m" ?"selected":""}>Últim${unit==="meses"?"os 3":unit==="días"?"os 3":"as 3"} ${unit}</option>
    <option value="6m"   ${period==="6m" ?"selected":""}>Últim${unit==="meses"?"os 6":unit==="días"?"os 6":"as 6"} ${unit}</option>
    <option value="12m"  ${period==="12m"?"selected":""}>Últim${unit==="meses"?"os 12":unit==="días"?"os 12":"as 12"} ${unit}</option>`;
}

// ── EXPORT PDF ────────────────────────────────────────────────────────────────
async function pvDownloadPDF() {
  const partner = PARTNER_VIEW_STATE.partner;
  if (!partner) { alert("Selecciona un partner primero."); return; }
  if (!window.jspdf || !window.html2canvas) { alert("Librerias PDF no disponibles."); return; }

  showLoad(true, "Generando PDF...");
  await new Promise(r => setTimeout(r, 200));
  try {
    const content = document.getElementById("partnerViewContent");
    // Fondo del PDF = fondo del dashboard (no blanco), para que las tarjetas y
    // gráficas blancas contrasten igual que en pantalla. Se lee del body en vivo
    // (cae a #F2F2F2 si está transparente).
    let pageBg = getComputedStyle(document.body).backgroundColor;
    if (!pageBg || pageBg === "transparent" || pageBg === "rgba(0, 0, 0, 0)") pageBg = "#F2F2F2";
    const canvas = await html2canvas(content, { scale: 2, useCORS: true, logging: false, backgroundColor: pageBg });
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [canvas.width, canvas.height] });
    pdf.addImage(imgData, "JPEG", 0, 0, canvas.width, canvas.height);
    const langSfx = (PARTNER_VIEW_STATE.lang || "es").toUpperCase();
    pdf.save(`${partner}_${STATE.curMode}_${(new Date()).toISOString().slice(0,10)}_${langSfx}.pdf`);
    showBanner(true, "PDF descargado");
  } catch (err) {
    alert("Error al generar PDF: " + err.message);
    console.error(err);
  } finally {
    showLoad(false);
  }
}

// ── EMBUDO DE CONVERSIÓN (funnel por CLID, solo top-10 por tamaño) ─────────────
// Percentil lineal (interpolado) de un array numerico. Ignora null/NaN.
function _pvPercentile(arr, p) {
  const s = (arr || []).filter(v => v !== null && v !== undefined && !isNaN(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

// Heatmap rojo→verde de una celda segun su posicion vs percentiles de la columna.
function _pvConvColor(v, p25, p50, p75) {
  if (v === null || v === undefined || p50 === null) return "#fff";
  if (v >= p75) return "#bbf7d0";
  if (v >= p50) return "#dcfce7";
  if (v >= p25) return "#fef9c3";
  return "#fee2e2";
}

// Relee los filtros de pares elegibles y re-renderiza SOLO la sección de conversión.
function pvConvFilter() {
  const adMin = +document.getElementById("pvConvAdMin")?.value;
  const adMax = +document.getElementById("pvConvAdMax")?.value;
  const ndMin = +document.getElementById("pvConvNdMin")?.value;
  PARTNER_VIEW_STATE.convFilter = {
    adMin: isNaN(adMin) ? 0 : adMin,
    adMax: isNaN(adMax) ? 999999 : adMax,
    ndMin: isNaN(ndMin) ? 0 : ndMin
  };
  _pvConvRefresh();
}

// Alterna el cohorte de comparación (Top 5 / Top 10) sin re-render completo.
function pvConvCohort(which) {
  PARTNER_VIEW_STATE.convCohort = which === "top5" ? "top5" : "top10";
  _pvConvRefresh();
}

// Reconstruye conversión Y adquisición por canal (comparten el toggle Top5/Top10
// y los filtros) + re-monta ambos gráficos. Mantiene los dos charts en sincronía.
function _pvConvRefresh() {
  const p = PARTNER_VIEW_STATE.partner;
  const box = document.getElementById("pvConvBox");
  const chBox = document.getElementById("pvChannelBox");
  if (box) { box.innerHTML = _pvConvInner(p); _pvConvMountChart(p); }
  if (chBox) { chBox.innerHTML = _pvChannelInner(p); _pvChannelMountChart(p); }
  if (!box && !chBox) renderPartnerView();
}

// Embudo de conversión: SOLO el partner seleccionado vs el PROMEDIO del cohorte
// (Top 5 / Top 10 por Active Drivers). NO expone la conversión de partners
// individuales — pensado para presentárselo al propio partner.
function _pvConvData(selectedPartner) {
  const data = STATE.conversionData || [];
  const months = [...new Set(data.map(r => r.mes))].sort();
  const latest = months[months.length - 1];
  // Default amplio: el cohorte = verdaderos Top 5/10 por Active Drivers (sin
  // recortar a los mas grandes). El usuario puede angostar el rango si quiere
  // comparar contra pares de tamaño similar. ndMin filtra ruido de flotas chicas.
  const F = PARTNER_VIEW_STATE.convFilter || (PARTNER_VIEW_STATE.convFilter = { adMin: 0, adMax: 999999, ndMin: 50 });
  const cur = data.filter(r => r.mes === latest);
  // Pares elegibles para el ranking (filtros AD/ND), ordenados por Active Drivers.
  const pop = cur
    .filter(r => (r.activeDrivers || 0) >= F.adMin && (r.activeDrivers || 0) <= F.adMax && (r.newDrivers || 0) >= F.ndMin)
    .slice().sort((a, b) => (b.activeDrivers || 0) - (a.activeDrivers || 0));
  const cols = ["firstOrder", "n5", "n10", "n25", "n50", "n100"];
  // Cohorte = promedio SIMPLE de la tasa de conversión de cada partner (cada uno pesa igual).
  const avgOf = (rows, k) => { const v = rows.map(r => r[k]).filter(x => x != null && !isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const cohortAvg = rows => { const o = {}; cols.forEach(k => o[k] = avgOf(rows, k)); return o; };
  const top5  = cohortAvg(pop.slice(0, 5));
  const top10 = cohortAvg(pop.slice(0, 10));
  // Partner: promedio ponderado por New Drivers entre sus CLIDs (mes actual).
  const pRows = cur.filter(r => r.partner === selectedPartner);
  const partnerVals = {};
  cols.forEach(k => {
    let num = 0, den = 0, ss = 0, sn = 0;
    pRows.forEach(r => { const v = r[k]; if (v != null && !isNaN(v)) { const w = r.newDrivers || 0; num += v * w; den += w; ss += v; sn++; } });
    partnerVals[k] = den > 0 ? num / den : (sn > 0 ? ss / sn : null);
  });
  return { latest, F, cols, top5, top10, partnerVals, hasPartner: pRows.length > 0, nPop: pop.length };
}

function _pvConversionSection(selectedPartner) {
  if (!(STATE.conversionData || []).length) {
    const msg = PARTNER_VIEW_STATE.lang === "en"
      ? "Upload the Conversion (country) Excel to populate this benchmark."
      : "Sube el Excel de Conversión (país) para poblar este benchmark.";
    return `${_secH("🎯", "#8b5cf6", _t("convTitle"), _t("convSub"))}
      <div class="section"><div style="font-size:.8rem;color:#aaa;padding:6px">${msg}</div></div>`;
  }
  return `${_secH("🎯", "#8b5cf6", _t("convTitle"), _t("convSub"))}
    <div class="section"><div id="pvConvBox">${_pvConvInner(selectedPartner)}</div></div>`;
}

// Cuerpo de la sección: filtros + toggle Top5/Top10 + gráfico de barras + tabla
// (solo partner y promedios de cohorte). Re-render aislado vía _pvConvRefresh.
function _pvConvInner(selectedPartner) {
  const d = _pvConvData(selectedPartner);
  const which = PARTNER_VIEW_STATE.convCohort === "top5" ? "top5" : "top10";
  const F = d.F;
  const fpct = v => (v == null || isNaN(v)) ? "—" : (+v).toFixed(1) + "%";
  const tkey = { firstOrder: "convFirstOrder", n5: "convN5", n10: "convN10", n25: "convN25", n50: "convN50", n100: "convN100" };
  const th = (s, left) => `<th style="text-align:${left ? "left" : "right"};padding:6px 8px;border-bottom:2px solid #eee;font-size:.7rem;background:#fafafa;white-space:nowrap">${escapeHTML(s)}</th>`;
  const rowHtml = (label, vals, color, hl) => `<tr style="${hl ? "background:#fff5f5" : ""}">
      <td style="padding:6px 8px;border-bottom:1px solid #f3f3f3;font-weight:${hl ? 800 : 600};color:${color};white-space:nowrap">
        <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${color};margin-right:6px"></span>${escapeHTML(label)}</td>
      ${d.cols.map(c => `<td style="text-align:right;padding:6px 8px;border-bottom:1px solid #f3f3f3;font-weight:${hl ? 800 : 600}">${fpct(vals[c])}</td>`).join("")}</tr>`;
  const toggleBtn = (key, label) => `<button onclick="pvConvCohort('${key}')" class="preset-btn${which === key ? " active" : ""}" style="${which === key ? "background:#3b82f6;color:#fff;border-color:#3b82f6" : ""}">${escapeHTML(label)}</button>`;

  return `
    <div style="display:flex;gap:14px;align-items:end;flex-wrap:wrap;margin-bottom:10px">
      <div><label style="font-size:.66rem;color:#666;font-weight:700;display:block;margin-bottom:3px">${_t("convADRange")}</label>
        <div style="display:flex;gap:4px">
          <input id="pvConvAdMin" class="crud-input" type="number" value="${F.adMin}" style="width:80px" onchange="pvConvFilter()"/>
          <input id="pvConvAdMax" class="crud-input" type="number" value="${F.adMax}" style="width:90px" onchange="pvConvFilter()"/>
        </div></div>
      <div><label style="font-size:.66rem;color:#666;font-weight:700;display:block;margin-bottom:3px">${_t("convNDMin")}</label>
        <input id="pvConvNdMin" class="crud-input" type="number" value="${F.ndMin}" style="width:90px" onchange="pvConvFilter()"/></div>
      <div><label style="font-size:.66rem;color:#666;font-weight:700;display:block;margin-bottom:3px">${_t("convCmpTitle")}</label>
        <div style="display:flex;gap:6px">${toggleBtn("top5", _t("convTop5Btn"))}${toggleBtn("top10", _t("convTop10Btn"))}</div></div>
      <span style="font-size:.72rem;color:#aaa">${_t("convPeers")}: n=${d.nPop}</span>
    </div>
    ${d.hasPartner ? "" : `<div style="font-size:.76rem;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:6px 10px;margin-bottom:8px">${_t("convNoPartner")}</div>`}
    <div id="pvConvChart" style="min-height:280px"></div>
    <div style="overflow-x:auto;margin-top:6px">
      <table style="width:100%;border-collapse:collapse;font-size:.78rem">
        <thead><tr>${th("", true)}${d.cols.map(c => th(_t(tkey[c]))).join("")}</tr></thead>
        <tbody>
          ${rowHtml(selectedPartner, d.partnerVals, "#ef4444", true)}
          ${rowHtml(_t("convAvgTop", { n: 5 }),  d.top5,  "#3b82f6", false)}
          ${rowHtml(_t("convAvgTop", { n: 10 }), d.top10, "#1e40af", false)}
        </tbody>
      </table>
    </div>
    <div style="font-size:.7rem;color:#999;font-style:italic;margin-top:8px">${_t("convPrivacyNote")}</div>`;
}

// Gráfico de barras agrupadas: partner vs promedio del cohorte seleccionado.
// Omite "1er viaje" (≈100% para todos). Misma técnica de headroom + padding.
function _pvConvMountChart(selectedPartner) {
  const el = document.getElementById("pvConvChart");
  if (!el || typeof ApexCharts === "undefined") return;
  el.classList.add("pv-chart");
  const d = _pvConvData(selectedPartner);
  const which = PARTNER_VIEW_STATE.convCohort === "top5" ? "top5" : "top10";
  const cohort = which === "top5" ? d.top5 : d.top10;
  const chartCols = ["n5", "n10", "n25", "n50", "n100"];
  const tkey = { n5: "convN5", n10: "convN10", n25: "convN25", n50: "convN50", n100: "convN100" };
  const r1 = v => (v == null || isNaN(v)) ? null : +(+v).toFixed(1);
  const partnerData = chartCols.map(k => r1(d.partnerVals[k]));
  const cohortData  = chartCols.map(k => r1(cohort[k]));
  const cohortLabel = _t("convAvgTop", { n: which === "top5" ? 5 : 10 });
  const allv = [...partnerData, ...cohortData].filter(v => v != null);
  const ymax = allv.length ? Math.min(100, Math.ceil(Math.max(...allv) * 1.2)) : 100;
  _pvMountChart("pvConvChart", el, {
    series: [{ name: cohortLabel, data: cohortData }, { name: selectedPartner, data: partnerData }],
    chart: { type: "bar", height: 280, toolbar: { show: false }, animations: { enabled: false }, fontFamily: "inherit" },
    colors: ["#3b82f6", "#ef4444"],
    plotOptions: { bar: { columnWidth: "62%", borderRadius: 3, dataLabels: { position: "top" } } },
    dataLabels: {
      enabled: true,
      formatter: v => (v == null) ? "" : (+v).toFixed(1) + "%",
      offsetY: -16,
      style: { fontSize: "10px", colors: ["#1d4ed8", "#b91c1c"], fontWeight: 800 },
      background: { enabled: false }
    },
    xaxis: { categories: chartCols.map(k => _t(tkey[k])), labels: { style: { fontSize: "10px" } }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { min: 0, max: ymax, forceNiceScale: true, labels: { formatter: v => (+v).toFixed(0) + "%", style: { fontSize: "10px" } } },
    grid: { borderColor: "#f0f0f0", strokeDashArray: 4, padding: { top: 22, right: 16, left: 8, bottom: 0 } },
    legend: { position: "top", fontSize: "11px", fontWeight: 700, markers: { radius: 3 } },
    tooltip: { shared: true, intersect: false, y: { formatter: v => (v == null) ? "—" : (+v).toFixed(1) + "%" } }
  });
}

// ── PERÚ (GENERAL) + COMPARACIÓN POR COHORTES ─────────────────────────────────
function _pvCityId(city) { return city.toLowerCase().replace(/[^a-z0-9]/g, ""); }

// Bandas de cohorte por ranking de Active Drivers. range = [inicio, fin) sobre `ranked`.
// Permiten comparar al partner contra tiers específicos (líder, peers cercanos, grupo
// medio) en vez de un único promedio que se diluye al comparar partners grandes.
const PV_COHORT_BANDS = [
  { key: "t1",   range: [0, 1],  color: "#ef4444", es: "Top 1",       en: "Top 1" },
  { key: "t23",  range: [1, 3],  color: "#f59e0b", es: "Top 2-3",     en: "Top 2-3" },
  { key: "t45",  range: [3, 5],  color: "#0ea5e9", es: "Top 4-5",     en: "Top 4-5" },
  { key: "t610", range: [5, 10], color: "#a855f7", es: "Top 6-10",    en: "Top 6-10" },
  { key: "t5",   range: [0, 5],  color: "#10b981", es: "Prom. Top 5", en: "Avg Top 5" }
];

// Toggle de comparacion (aplica a Perú-General y a todas las provincias).
function pvCohortToggle(which) {
  PARTNER_VIEW_STATE.cohort = PARTNER_VIEW_STATE.cohort || {};
  PARTNER_VIEW_STATE.cohort[which] = !PARTNER_VIEW_STATE.cohort[which];
  // Solo actualizar los botones + reconstruir los charts en sitio (los divs siguen
  // en el DOM). Evita re-render completo de Vista Partner en cada toggle.
  const bar = document.getElementById("pvCohortBar");
  if (bar) bar.innerHTML = PV_COHORT_BANDS.map(b => _pvCohortBtn(b)).join("");
  if (typeof PARTNER_VIEW_STATE._rebuildScopes === "function") PARTNER_VIEW_STATE._rebuildScopes();
  else renderPartnerView();
}

function _pvCohortBtn(band) {
  const on = (PARTNER_VIEW_STATE.cohort || {})[band.key];
  const label = PARTNER_VIEW_STATE.lang === "en" ? band.en : band.es;
  return `<button onclick="pvCohortToggle('${band.key}')" class="preset-btn${on ? " active" : ""}" style="${on ? `background:${band.color};color:#fff;border-color:${band.color}` : ""}">+ ${escapeHTML(label)}</button>`;
}

// Botón "Solo tendencias" (modo compartir): oculta los valores en los charts de
// comparación (etiquetas, eje Y y tabla N+R) y fuerza mostrar Top 5 y Top 6-10,
// para compartir la forma de la tendencia sin exponer cifras. margin-left:auto lo
// empuja al extremo derecho de la barra de cohortes.
function _pvShareBtnHtml() {
  const on = !!PARTNER_VIEW_STATE.shareMode;
  // flex:0 0 auto — .preset-btn trae flex:1 y, como hijo directo de la barra,
  // estiraba a todo el ancho. Lo dejamos compacto y alineado a la derecha.
  return `<button id="pvShareBtn" onclick="pvShareToggle()" class="preset-btn${on ? " active" : ""}" title="${escapeHTML(_t("shareHint"))}" style="flex:0 0 auto;margin-left:auto;white-space:nowrap;padding:4px 10px;${on ? "background:#111;color:#fff;border-color:#111" : ""}">${on ? "🔒" : "🔓"} ${escapeHTML(_t("shareBtn"))}</button>`;
}

// Alterna el modo compartir. Al activarlo guarda la selección de cohorte actual y
// fuerza Top 5 + Top 6-10; al desactivarlo la restaura. Reconstruye los charts en
// sitio (sin re-render completo) para aplicar/quitar el ocultado de valores.
function pvShareToggle() {
  const S = PARTNER_VIEW_STATE;
  S.shareMode = !S.shareMode;
  if (S.shareMode) {
    S._cohortBeforeShare = Object.assign({}, S.cohort || {});
    S.cohort = { t5: true, t610: true };
  } else {
    S.cohort = S._cohortBeforeShare || {};
    S._cohortBeforeShare = null;
  }
  const bar = document.getElementById("pvCohortBar");
  if (bar) bar.innerHTML = PV_COHORT_BANDS.map(b => _pvCohortBtn(b)).join("");
  const btn = document.getElementById("pvShareBtn");
  if (btn) btn.outerHTML = _pvShareBtnHtml();
  if (typeof S._rebuildScopes === "function") S._rebuildScopes();
  else renderPartnerView();
}

// Botón "Leyenda": muestra/oculta el panel de integrantes + cifras del cohorte.
// OFF por defecto para que el PDF que se envía al partner no lo incluya; el KAM lo
// enciende solo para su análisis. Reconstruye los scopes en sitio (sin re-render total).
function _pvLegendBtnHtml() {
  const on = !!PARTNER_VIEW_STATE.showLegend;
  return `<button id="pvLegendBtn" onclick="pvLegendToggle()" class="preset-btn${on ? " active" : ""}" title="${escapeHTML(_t("legendHint"))}" style="flex:0 0 auto;white-space:nowrap;padding:4px 10px;${on ? "background:#0ea5e9;color:#fff;border-color:#0ea5e9" : ""}">📋 ${escapeHTML(_t("legendBtn"))}</button>`;
}

function pvLegendToggle() {
  PARTNER_VIEW_STATE.showLegend = !PARTNER_VIEW_STATE.showLegend;
  const btn = document.getElementById("pvLegendBtn");
  if (btn) btn.outerHTML = _pvLegendBtnHtml();
  if (typeof PARTNER_VIEW_STATE._rebuildScopes === "function") PARTNER_VIEW_STATE._rebuildScopes();
  else renderPartnerView();
}

// Serie del partner para un scope: scopeCity=null => combinado de TODAS sus
// ciudades (Perú-General); scopeCity="LIMA" => solo esa ciudad.
function _pvScopeSeries(partner, scopeCity, dates) {
  // Memo por render (reseteado en renderPartnerView): un cohorte puede pedir la
  // misma serie de un partner varias veces (varias bandas se solapan).
  const cache = PARTNER_VIEW_STATE._scopeCache || (PARTNER_VIEW_STATE._scopeCache = {});
  const ck = `${partner}|||${scopeCity || "_PE_"}`;
  if (cache[ck]) return cache[ck];
  let out;
  if (scopeCity) {
    out = _pvSeriesByPartnerCity(partner, scopeCity, dates);
  } else {
    const rows = (STATE._byPartner && STATE._byPartner.get(partner)) || STATE.rawData.filter(r => r.partner === partner);
    const cities = [...new Set(rows.map(r => r.city).filter(Boolean))];
    const per = cities.map(c => _pvSeriesByPartnerCity(partner, c, dates));
    out = dates.map((d, i) => {
      const o = { date: d, ad: 0, nr: 0, sh: 0, trips: 0, commission: 0, gmv: 0, npPartner: 0, npService: 0, reactivated: 0, activeCars: 0, _shCarW: 0, _acceptW: 0, shCar: 0, accept: 0 };
      per.forEach(ser => {
        const e = ser[i]; if (!e) return;
        o.ad += e.ad; o.sh += e.sh; o.trips += e.trips; o.commission += e.commission; o.gmv += e.gmv || 0;
        o.npPartner += e.npPartner; o.npService += e.npService; o.reactivated += e.reactivated;
        o.activeCars += e.activeCars || 0; o._shCarW += e._shCarW || 0; o._acceptW += e._acceptW || 0;
      });
      o.nr = o.npPartner + o.npService + o.reactivated;
      o.shCar  = o.activeCars > 0 ? o._shCarW / o.activeCars : 0;
      o.accept = o.trips > 0 ? o._acceptW / o.trips : 0;
      o._present = per.some(ser => ser[i] && ser[i]._present);
      return o;
    });
  }
  cache[ck] = out;
  return out;
}

// Cohortes top-5 / top-6-10 por Active Drivers del último periodo, dentro del scope.
function _pvScopeCohorts(scopeCity, dates) {
  const lastDate = dates[dates.length - 1];
  const rows = ((STATE._byDate && STATE._byDate.get(lastDate)) || STATE.rawData.filter(r => r.date === lastDate))
    .filter(r => !scopeCity || r.city === scopeCity);
  const byPC = {};   // partner|city -> AD total (suma de sub-flotas fleetroom)
  rows.forEach(r => { const k = `${r.partner}|||${r.city}`; byPC[k] = (byPC[k] || 0) + (r.activeDrivers || 0); });
  const adByPartner = {};
  Object.entries(byPC).forEach(([k, v]) => { const p = k.split("|||")[0]; adByPartner[p] = (adByPartner[p] || 0) + v; });
  const ranked = Object.entries(adByPartner).sort((a, b) => b[1] - a[1]).map(e => e[0]);
  return { ranked, top5: ranked.slice(0, 5), top610: ranked.slice(5, 10) };
}

// Leyenda + resumen de cohortes: por cada banda ACTIVA (Top 1 / Top 2-3 / Top 4-5 /
// Top 6-10 / Top 5) lista sus partners integrantes (resaltando al seleccionado) y los
// números del último período usados para el promedio — así el KAM sabe QUIÉNES entran
// y CÓMO se calcula la línea de comparación. El promedio es la media SIMPLE de los
// integrantes (coincide con el último punto de las líneas de cohorte). Respeta "Solo
// tendencias": en modo compartir oculta integrantes y cifras (no expone al cohorte).
function _pvCohortLegend(scopeCity, dates) {
  if (!PARTNER_VIEW_STATE.showLegend) return "";        // OFF por defecto (no va al PDF del partner)
  const tog = PARTNER_VIEW_STATE.cohort || {};
  const activeBands = PV_COHORT_BANDS.filter(b => tog[b.key]);
  if (!activeBands.length) return "";
  const cohorts = _pvScopeCohorts(scopeCity, dates);
  const share   = !!PARTNER_VIEW_STATE.shareMode;
  const isEN    = PARTNER_VIEW_STATE.lang === "en";
  const sel     = PARTNER_VIEW_STATE.partner;
  const lastDate = dates[dates.length - 1];
  const youTag   = isEN ? "you" : "tú";
  const avgWord  = isEN ? "Average" : "Promedio";
  const pWord    = "partners";
  const hidden   = isEN ? "members and figures hidden in sharing mode"
                        : "integrantes y cifras ocultos en modo compartir";
  // Valores del último período por partner (misma agregación que los charts).
  const lastVals = p => {
    const s = _pvScopeSeries(p, scopeCity, dates);
    const e = s[s.length - 1] || {};
    return { ad: e.ad || 0, nr: e.nr || 0, sh: e.sh || 0, trips: e.trips || 0, commission: e.commission || 0, gmv: e.gmv || 0 };
  };
  const cols = [
    { key: "ad",         label: _t("activeDrivers"), fn: v => fmt(v) },
    { key: "nr",         label: _t("newReactShort"), fn: v => fmt(v) },
    { key: "sh",         label: _t("supplyHours"),   fn: v => fmtSmart(v) },
    { key: "trips",      label: _t("trips"),         fn: v => fmtSmart(v) },
    { key: "commission", label: _t("commission"),    fn: v => "$" + fmtSmart(v) },
    { key: "gmv",        label: "GMV",               fn: v => "$" + fmtSmart(v) }
  ];
  const th = (s, left) => `<th style="text-align:${left ? "left" : "right"};padding:4px 7px;border-bottom:1px solid #eee;background:#fafafa;font-size:.62rem;white-space:nowrap">${escapeHTML(s)}</th>`;

  const blocks = activeBands.map(b => {
    const members = cohorts.ranked.slice(b.range[0], b.range[1]);
    if (!members.length) return "";
    const label = isEN ? b.en : b.es;
    const head = `<div style="display:flex;align-items:center;gap:7px;margin:10px 0 5px">
      <span style="width:11px;height:11px;border-radius:2px;background:${b.color};flex:0 0 auto"></span>
      <span style="font-weight:800;font-size:.8rem;color:#222">${escapeHTML(label)}</span>
      <span style="font-size:.68rem;color:#999">· ${members.length} ${pWord}${scopeCity ? " · " + escapeHTML(cityLabel(scopeCity)) : ""}</span>
    </div>`;
    // En modo compartir: NO exponer integrantes ni cifras del cohorte.
    if (share) {
      return head + `<div style="font-size:.7rem;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:5px 9px">🔒 ${hidden}</div>`;
    }
    const vals = members.map(lastVals);
    const avg = {};
    cols.forEach(c => avg[c.key] = members.length ? vals.reduce((s, v) => s + v[c.key], 0) / members.length : 0);
    const headerRow = `<tr>${th("#", true)}${th(_t("partner"), true)}${cols.map(c => th(c.label)).join("")}</tr>`;
    const memberRows = members.map((p, i) => {
      const isSel = p === sel, v = vals[i];
      const cells = cols.map(c => `<td style="text-align:right;padding:3px 7px;border-bottom:1px solid #f5f5f5;font-weight:${isSel ? 800 : 500}">${c.fn(v[c.key])}</td>`).join("");
      return `<tr style="${isSel ? "background:#fff5f5" : ""}">
        <td style="padding:3px 7px;border-bottom:1px solid #f5f5f5;color:#999;font-size:.66rem">${b.range[0] + i + 1}</td>
        <td style="padding:3px 7px;border-bottom:1px solid #f5f5f5;font-weight:${isSel ? 800 : 600};color:${isSel ? "#b91c1c" : "#333"};white-space:nowrap">${escapeHTML(p)}${isSel ? ` <span style="font-size:.58rem;background:#ef4444;color:#fff;padding:1px 5px;border-radius:6px;margin-left:3px">${youTag}</span>` : ""}</td>
        ${cells}</tr>`;
    }).join("");
    const avgRow = `<tr style="border-top:2px solid #e5e5e5">
      <td style="padding:4px 7px"></td>
      <td style="padding:4px 7px;font-weight:800;color:${b.color};white-space:nowrap">${escapeHTML(avgWord)}</td>
      ${cols.map(c => `<td style="text-align:right;padding:4px 7px;font-weight:800;color:${b.color}">${c.fn(avg[c.key])}</td>`).join("")}</tr>`;
    return head + `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.72rem;background:#fff;border:1px solid #f0f0f0;border-radius:6px">
      <thead>${headerRow}</thead><tbody>${memberRows}${avgRow}</tbody></table></div>`;
  }).join("");

  const title = isEN ? "Cohort members &amp; figures used" : "Integrantes y cifras del cohorte";
  const sub = isEN
    ? `Latest-period values (${d2s(lastDate)}); ranked by Active Drivers. The <b>Average</b> is the simple mean of the members — the value plotted in the comparison lines.`
    : `Valores del último período (${d2s(lastDate)}); ranking por Conductores Activos. El <b>Promedio</b> es la media simple de los integrantes — el valor que grafican las líneas de comparación.`;
  return `<div style="border:1px dashed #d4d4d4;border-radius:8px;padding:10px 12px;margin:0 0 12px;background:#fcfcfc">
    <div style="font-weight:800;font-size:.78rem;color:#333;margin-bottom:2px">📋 ${title}</div>
    <div style="font-size:.68rem;color:#888;margin-bottom:2px">${sub}</div>
    ${blocks}
  </div>`;
}

// Promedio por fecha de una métrica (getter) sobre un conjunto de partners, en el scope.
function _pvCohortAvg(cohortPartners, scopeCity, dates, getter) {
  if (!cohortPartners.length) return dates.map(() => 0);
  const seriesArr = cohortPartners.map(p => _pvScopeSeries(p, scopeCity, dates));
  // Promedio solo sobre los miembros del cohorte que TIENEN dato esa fecha
  // (_present). Evita sesgar a la baja contando como 0 a los ausentes; un miembro
  // presente con valor 0 SÍ cuenta (no se confunde "sin dato" con "valor 0").
  return dates.map((d, i) => {
    let s = 0, count = 0;
    seriesArr.forEach(ser => {
      const e = ser[i];
      if (e && e._present) { s += getter(e) || 0; count++; }
    });
    return count > 0 ? s / count : null;   // sin miembros con dato esa fecha → hueco (no punto 0 falso)
  });
}

// Línea: serie del partner + (opcional) líneas de promedio de cohortes.
function _pvCmpLine(elId, labels, partnerSeries, cohortLines, color, fmtFn, money) {
  const el = document.getElementById(elId);
  if (!el || typeof ApexCharts === "undefined") return;
  el.classList.add("pv-chart");
  const share = !!PARTNER_VIEW_STATE.shareMode;   // modo compartir: sin valores
  // Si ni el partner ni los cohortes tienen dato (p.ej. KPI fleet en un partner
  // no-fleet), no montar una línea plana en 0: mostrar "Sin datos".
  const _has = (partnerSeries.data || []).some(v => v) || cohortLines.some(l => (l.data || []).some(v => v));
  if (!_has) {
    const reg = PARTNER_VIEW_STATE.scopeCharts;
    if (reg && reg[elId]) { try { reg[elId].destroy(); } catch (e) {} delete reg[elId]; }
    el.innerHTML = `<div style="font-size:.75rem;color:#bbb;padding:34px 8px;text-align:center">Sin datos para este KPI</div>`;
    return;
  }
  const fn = fmtFn || (v => fmt(v));
  const pref = money ? "$" : "";
  const series = [partnerSeries, ...cohortLines.map(l => ({ name: l.name, data: l.data }))];
  const colors = [color, ...cohortLines.map(l => l.color)];
  // Headroom vertical: deja espacio sobre el pico para que su dataLabel no se
  // corte contra el borde superior. Piso un poco bajo el minimo (sin aplanar).
  const allVals = series.flatMap(s => (s.data || []).filter(v => v != null && !isNaN(v)));
  const dMax = allVals.length ? Math.max(...allVals) : 0;
  const dMin = allVals.length ? Math.min(...allVals) : 0;
  const yAxis = { labels: { formatter: v => pref + fn(v), style: { fontSize: "10px" } } };
  if (dMax > 0) { yAxis.max = dMax * 1.15; yAxis.min = Math.max(0, dMin * 0.94); yAxis.forceNiceScale = true; }
  _pvMountChart(elId, el, {
    series,
    chart: { type: "line", height: 210, toolbar: { show: false }, animations: { enabled: false }, fontFamily: "inherit" },
    stroke: { curve: "smooth", width: [2.5, ...cohortLines.map(() => 2)], dashArray: [0, ...cohortLines.map(() => 5)] },
    colors, markers: { size: 3 },
    // Etiquetas SOLO en la línea del partner (seriesIndex 0). Las etiquetas de las líneas de
    // cohorte se encimaban con las del partner y entre sí (ilegible, sobre todo cuando el partner
    // va cerca del promedio). El valor del cohorte sigue disponible en el tooltip y la leyenda.
    dataLabels: { enabled: true, formatter: (v, opts) => (opts && opts.seriesIndex > 0) ? "" : pref + fn(v), style: { fontSize: "10px", colors: ["#111", ...cohortLines.map(l => l.color)], fontWeight: 700 }, background: { enabled: false }, offsetY: -10 },
    xaxis: { categories: labels, labels: { style: { fontSize: "9px" }, rotate: -30 }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: yAxis,
    // padding.left amplio: separa el primer dataLabel de los números del eje Y;
    // padding.right: deja respirar el último punto. top: espacio para el pico.
    grid: { borderColor: "#f0f0f0", strokeDashArray: 4, padding: { top: 18, right: 30, left: 26, bottom: 0 } },
    tooltip: { shared: true, y: { formatter: v => pref + fn(v) } },
    legend: { show: cohortLines.length > 0, position: "bottom", fontSize: "10px" }
  });
}

// N+R: columnas apiladas (partner/yango/react) + (opcional) líneas de total de cohortes.
function _pvCmpNR(elId, labels, series, recibeLeads, cohortLines) {
  const el = document.getElementById(elId);
  if (!el || typeof ApexCharts === "undefined") return;
  el.classList.add("pv-chart");
  const share = !!PARTNER_VIEW_STATE.shareMode;   // modo compartir: sin valores
  const isEN = PARTNER_VIEW_STATE.lang === "en";
  const colSeries = recibeLeads
    ? [{ name: isEN ? "New (Partner)" : "Nuevos (Partner)", type: "column", data: series.map(s => s.npPartner) },
       { name: isEN ? "New (Yango)" : "Nuevos (Yango)", type: "column", data: series.map(s => s.npService) },
       { name: isEN ? "Reactivated" : "Reactivados", type: "column", data: series.map(s => s.reactivated) }]
    : [{ name: isEN ? "New (Partner)" : "Nuevos (Partner)", type: "column", data: series.map(s => s.npPartner) },
       { name: isEN ? "Reactivated" : "Reactivados", type: "column", data: series.map(s => s.reactivated) }];
  const colColors = recibeLeads ? ["#3b82f6", "#f59e0b", "#10b981"] : ["#3b82f6", "#10b981"];
  const lineSeries = cohortLines.map(l => ({ name: l.name, type: "line", data: l.data }));
  const lineColors = cohortLines.map(l => l.color);
  const hasLines = lineSeries.length > 0;
  // Headroom: por encima de la barra apilada mas alta (o de la linea de cohorte
  // mas alta) para que la etiqueta del total no se corte arriba.
  const totals = labels.map((_, i) => colSeries.reduce((s, cs) => s + (cs.data[i] || 0), 0));
  const lineVals = lineSeries.flatMap(l => (l.data || []).filter(v => v != null && !isNaN(v)));
  const barMax = Math.max(0, ...totals, ...lineVals);
  const yAxis = { labels: { formatter: v => fmt(v), style: { fontSize: "10px" } } };
  if (barMax > 0) { yAxis.max = barMax * 1.18; yAxis.forceNiceScale = true; }
  _pvMountChart(elId, el, {
    series: [...colSeries, ...lineSeries],
    chart: { type: "line", height: 200, stacked: true, toolbar: { show: false }, animations: { enabled: false }, fontFamily: "inherit" },
    colors: [...colColors, ...lineColors],
    stroke: { width: [...colSeries.map(() => 0), ...lineSeries.map(() => 2)], dashArray: [...colSeries.map(() => 0), ...lineSeries.map(() => 5)], curve: "smooth" },
    plotOptions: { bar: { columnWidth: "60%", dataLabels: { total: { enabled: !hasLines, offsetY: -4, style: { fontSize: "11px", fontWeight: 800, color: "#111" }, formatter: v => fmt(v) } } } },
    dataLabels: {
      // Columnas (segmentos) + lineas de cohorte: el total del promedio tambien
      // se etiqueta (legible en PDF). Color: segmentos en blanco, lineas en su color.
      // En modo compartir se ocultan SOLO las etiquetas de las líneas de cohorte;
      // las columnas del partner (su propia data) siguen visibles.
      enabled: true,
      enabledOnSeries: [...colSeries.map((_, i) => i), ...lineSeries.map((_, i) => colSeries.length + i)],
      formatter: (val, opts) => {
        // Serie de linea (cohorte): muestra su total con su color. Se oculta en modo
        // compartir Y para bandas sensibles (<3 partners: Top 1 / Top 2-3), donde
        // imprimir el "promedio" expondría la cifra de 1-2 competidores individuales.
        if (opts.seriesIndex >= colSeries.length) {
          const line = cohortLines[opts.seriesIndex - colSeries.length];
          if (share || (line && line.sensitive)) return "";
          return val ? fmt(val) : "";
        }
        // Segmento de columna: solo si pesa >= 20% del total de su barra.
        if (!val || val <= 0) return "";
        const all = opts.w.config.series;
        let tot = 0; for (let i = 0; i < colSeries.length; i++) tot += all[i].data[opts.dataPointIndex] || 0;
        if (!tot || val / tot < 0.20) return "";
        return fmt(val);
      },
      style: { fontSize: "9px", colors: [...colSeries.map(() => "#fff"), ...lineColors], fontWeight: 800 },
      dropShadow: { enabled: true, top: 1, left: 1, blur: 1, opacity: .45 }
    },
    xaxis: { categories: labels, labels: { style: { fontSize: "9px" }, rotate: -30 } },
    yaxis: yAxis,
    grid: { borderColor: "#f0f0f0", strokeDashArray: 4, padding: { top: 16, right: 14, left: 12, bottom: 0 } },
    tooltip: { shared: true, y: { formatter: v => fmt(v) } },
    legend: { position: "bottom", fontSize: "10px", itemMargin: { horizontal: 6 } }
  });
}

// Mini-tabla de desglose N+R por fecha (para que el detalle se vea también en PDF).
function _pvNRTable(series, dates, recibeLeads) {
  const isEN = PARTNER_VIEW_STATE.lang === "en";
  const head = [`<th style="text-align:left;padding:4px 6px;border-bottom:1px solid #eee;background:#f9f9f9">${isEN ? "Date" : "Fecha"}</th>`]
    .concat(dates.map(d => `<th style="text-align:right;padding:4px 6px;border-bottom:1px solid #eee;background:#f9f9f9;font-size:.65rem">${d2s(d)}</th>`)).join("");
  const row = (label, getter, color) => `<tr>
    <td style="padding:3px 6px;border-bottom:1px solid #f5f5f5;font-weight:600;color:${color}">
      <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};margin-right:4px"></span>${label}</td>
    ${series.map(s => `<td style="text-align:right;padding:3px 6px;border-bottom:1px solid #f5f5f5">${fmt(getter(s))}</td>`).join("")}
  </tr>`;
  const rows = [
    row(isEN ? "New (Partner)" : "Nuevos (Partner)", s => s.npPartner, "#3b82f6"),
    recibeLeads ? row(isEN ? "New (Yango)" : "Nuevos (Yango)", s => s.npService, "#f59e0b") : "",
    row(isEN ? "Reactivated" : "Reactivados", s => s.reactivated, "#10b981"),
    row("Total", s => s.nr, "#111")
  ].filter(Boolean).join("");
  return `<div style="margin-top:8px;overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:.68rem;background:#fff;border:1px solid #f0f0f0;border-radius:6px">
      <thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// Bloque de un scope (Perú-General si scopeCity=null, o una provincia): 6 charts
// (AD, SH, N+R, Trips, Commission, GMV) con comparación top-5/top-6-10.
function _pvScopeBlock(scopeCity, idPrefix) {
  // 2 columnas fijas: cada línea ocupa media fila (≈ el doble de ancho que con el
  // auto-fit anterior, que dejaba 1-2 celdas vacías a la derecha). N+R y GMV a
  // ancho completo → sin celdas vacías y con espacio para que las etiquetas no
  // se enciman ni se corten contra el borde.
  const grid = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px";
  const card = (id, label, span) => `<div class="chart-card" style="${span ? "grid-column:1/-1" : ""}">
    <div class="chart-head"><span class="chart-title">${escapeHTML(label)}</span></div>
    <div id="pvs_${idPrefix}_${id}"></div><div id="pvs_${idPrefix}_${id}_tbl"></div></div>`;
  return `<div id="pvs_${idPrefix}_legend"></div>
  <div style="${grid}">
    ${card("ad", _t("activeDrivers"))}
    ${card("sh", _t("supplyHours"))}
    ${card("nr", _t("newReact"), true)}
    ${card("trips", _t("trips"))}
    ${card("commission", _t("commission"))}
    ${card("gmv", "GMV", true)}
    ${card("shcar", _t("shPerCar"))}
    ${card("accept", _t("acceptRate"))}
  </div>`;
}

function _pvBuildScopeCharts(partner, scopeCity, idPrefix, dates, recibeLeads) {
  const series = _pvScopeSeries(partner, scopeCity, dates);
  const labels = dates.map(d2s);
  const accent = scopeCity ? (CITY_COLORS[scopeCity] || "#888") : "#FF0000";
  const tog = PARTNER_VIEW_STATE.cohort || {};
  const anyOn = PV_COHORT_BANDS.some(b => tog[b.key]);
  const cohorts = anyOn ? _pvScopeCohorts(scopeCity, dates) : null;
  // El cohorte INCLUYE al partner seleccionado (ej. viendo Lizzo, Lizzo cuenta dentro de su
  // Top 5): "Prom Top N" = promedio del grupo del que el partner forma parte. La superposición
  // de líneas se resuelve mostrando etiquetas SOLO en la línea del partner (ver _pvCmpLine),
  // no excluyéndolo del promedio.
  const lines = getter => {
    if (!cohorts) return [];
    const arr = [];
    PV_COHORT_BANDS.forEach(b => {
      if (!tog[b.key]) return;
      const members = cohorts.ranked.slice(b.range[0], b.range[1]);
      if (!members.length) return;
      const label = PARTNER_VIEW_STATE.lang === "en" ? b.en : b.es;
      // Promedio SIMPLE de los partners del cohorte (cada uno pesa igual), tanto para
      // métricas aditivas como para tasas (s.shCar/s.accept = tasa ya ponderada del partner).
      // sensitive: bandas de <3 partners (Top 1 / Top 2-3) → el "promedio" equivale a
      // exponer las cifras de 1-2 competidores individuales; no se imprime su valor.
      arr.push({ name: label, data: _pvCohortAvg(members, scopeCity, dates, getter), color: b.color, sensitive: members.length < 3 });
    });
    return arr;
  };
  _pvCmpLine(`pvs_${idPrefix}_ad`, labels, { name: _t("activeDrivers"), data: series.map(s => s.ad) }, lines(s => s.ad), accent, fmt);
  _pvCmpLine(`pvs_${idPrefix}_sh`, labels, { name: _t("supplyHours"), data: series.map(s => s.sh) }, lines(s => s.sh), "#8b5cf6", fmtSmart);
  _pvCmpNR(`pvs_${idPrefix}_nr`, labels, series, recibeLeads, lines(s => s.nr));
  _pvCmpLine(`pvs_${idPrefix}_trips`, labels, { name: _t("trips"), data: series.map(s => s.trips) }, lines(s => s.trips), "#10b981", fmtSmart);
  _pvCmpLine(`pvs_${idPrefix}_commission`, labels, { name: _t("commission"), data: series.map(s => s.commission) }, lines(s => s.commission), "#06b6d4", fmtSmart, true);
  _pvCmpLine(`pvs_${idPrefix}_gmv`, labels, { name: "GMV", data: series.map(s => s.gmv) }, lines(s => s.gmv), "#f59e0b", fmtSmart, true);
  // SH por auto activo (horas, 1 decimal) y Tasa de aceptación (fracción 0-1 → %). Cohorte =
  // promedio SIMPLE de la tasa de cada partner (s.shCar/s.accept), no ponderado (decisión del KAM).
  _pvCmpLine(`pvs_${idPrefix}_shcar`, labels, { name: _t("shPerCar"), data: series.map(s => s.shCar) }, lines(s => s.shCar), "#0891b2", v => (v || 0).toFixed(1));
  _pvCmpLine(`pvs_${idPrefix}_accept`, labels, { name: _t("acceptRate"), data: series.map(s => s.accept) }, lines(s => s.accept), "#db2777", v => ((v || 0) * 100).toFixed(1) + "%");
  const tbl = document.getElementById(`pvs_${idPrefix}_nr_tbl`);
  if (tbl) tbl.innerHTML = _pvNRTable(series, dates, recibeLeads);
  const leg = document.getElementById(`pvs_${idPrefix}_legend`);
  if (leg) leg.innerHTML = _pvCohortLegend(scopeCity, dates);
}

// Placeholder de canal de adquisición (formato de datos pendiente).
// Canales de adquisición (orden de la pestaña del Excel). key = campo camelCase
// en STATE.conversionData; label = nombre mostrado (igual ES/EN, son internos).
const PV_CHANNELS = [
  { key: "agencyScouts",    label: "Agency Scouts" },
  { key: "organicPartner",  label: "Organic Partner" },
  { key: "organicScouts",   label: "Organic Scouts" },
  { key: "organicYango",    label: "Organic Yango" },
  { key: "paidYango",       label: "Paid Yango" },
  { key: "partnerScouts",   label: "Partner Scouts" },
  { key: "referralPartner", label: "Referral Partner" },
  { key: "referralYango",   label: "Referral Yango" }
];

// Conteos por canal: partner (suma de sus CLIDs) + promedio del cohorte Top 5/10
// por Active Drivers. Mismos filtros y mes que la conversión.
function _pvChannelData(selectedPartner) {
  const data = STATE.conversionData || [];
  const months = [...new Set(data.map(r => r.mes))].sort();
  const latest = months[months.length - 1];
  const F = PARTNER_VIEW_STATE.convFilter || { adMin: 0, adMax: 999999, ndMin: 50 };
  const cur = data.filter(r => r.mes === latest);
  const pop = cur
    .filter(r => (r.activeDrivers || 0) >= F.adMin && (r.activeDrivers || 0) <= F.adMax && (r.newDrivers || 0) >= F.ndMin)
    .slice().sort((a, b) => (b.activeDrivers || 0) - (a.activeDrivers || 0));
  const chans = PV_CHANNELS.map(c => c.key);
  const avgOf = (rows, k) => rows.length ? rows.reduce((s, r) => s + (r[k] || 0), 0) / rows.length : 0;
  const cohortAvg = rows => { const o = {}; chans.forEach(k => o[k] = avgOf(rows, k)); return o; };
  const top5  = cohortAvg(pop.slice(0, 5));
  const top10 = cohortAvg(pop.slice(0, 10));
  const pRows = cur.filter(r => r.partner === selectedPartner);
  const partnerVals = {};
  chans.forEach(k => partnerVals[k] = pRows.reduce((s, r) => s + (r[k] || 0), 0));
  const anyData = cur.some(r => chans.some(k => (r[k] || 0) > 0));
  const hasPartner = pRows.length > 0 && chans.some(k => partnerVals[k] > 0);
  return { top5, top10, partnerVals, anyData, hasPartner, nPop: pop.length };
}

function _pvChannelSection(selectedPartner) {
  const d = _pvChannelData(selectedPartner);
  if (!(STATE.conversionData || []).length || !d.anyData) {
    const msg = PARTNER_VIEW_STATE.lang === "en"
      ? "Upload the 'Adquisition by channel' tab in the Conversion Excel to populate this."
      : "Sube la pestaña 'Adquisition by channel' del Excel de Conversión para poblar esto.";
    return `${_secH("🔌", "#64748b", _t("chanTitle"), _t("chanSub"))}
      <div class="section"><div style="font-size:.8rem;color:#aaa;padding:6px">${msg}</div></div>`;
  }
  return `${_secH("🔌", "#64748b", _t("chanTitle"), _t("chanSub"))}
    <div class="section"><div id="pvChannelBox">${_pvChannelInner(selectedPartner)}</div></div>`;
}

function _pvChannelInner(selectedPartner) {
  const d = _pvChannelData(selectedPartner);
  const fmtN = v => fmt(Math.round(v || 0));
  const th = (s, left) => `<th style="text-align:${left ? "left" : "right"};padding:6px 8px;border-bottom:2px solid #eee;font-size:.66rem;background:#fafafa;white-space:nowrap">${escapeHTML(s)}</th>`;
  const rowHtml = (label, vals, color, hl) => `<tr style="${hl ? "background:#fff5f5" : ""}">
      <td style="padding:6px 8px;border-bottom:1px solid #f3f3f3;font-weight:${hl ? 800 : 600};color:${color};white-space:nowrap">
        <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${color};margin-right:6px"></span>${escapeHTML(label)}</td>
      ${PV_CHANNELS.map(c => `<td style="text-align:right;padding:6px 8px;border-bottom:1px solid #f3f3f3;font-weight:${hl ? 800 : 600}">${fmtN(vals[c.key])}</td>`).join("")}</tr>`;
  return `
    <div style="font-size:.72rem;color:#888;margin-bottom:8px">${_t("chanToggleHint")}</div>
    ${d.hasPartner ? "" : `<div style="font-size:.76rem;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:6px 10px;margin-bottom:8px">${_t("convNoPartner")}</div>`}
    <div id="pvChannelChart" style="min-height:300px"></div>
    <div style="overflow-x:auto;margin-top:6px">
      <table style="width:100%;border-collapse:collapse;font-size:.74rem">
        <thead><tr>${th("", true)}${PV_CHANNELS.map(c => th(c.label)).join("")}</tr></thead>
        <tbody>
          ${rowHtml(selectedPartner, d.partnerVals, "#ef4444", true)}
          ${rowHtml(_t("convAvgTop", { n: 5 }),  d.top5,  "#3b82f6", false)}
          ${rowHtml(_t("convAvgTop", { n: 10 }), d.top10, "#1e40af", false)}
        </tbody>
      </table>
    </div>
    <div style="font-size:.7rem;color:#999;font-style:italic;margin-top:8px">${_t("convPrivacyNote")}</div>`;
}

// Barras agrupadas por canal: partner vs promedio del cohorte (Top 5/10 según el
// toggle compartido con la conversión). Conteos (no %). Headroom + padding.
function _pvChannelMountChart(selectedPartner) {
  const el = document.getElementById("pvChannelChart");
  if (!el || typeof ApexCharts === "undefined") return;
  el.classList.add("pv-chart");
  const d = _pvChannelData(selectedPartner);
  const which = PARTNER_VIEW_STATE.convCohort === "top5" ? "top5" : "top10";
  const cohort = which === "top5" ? d.top5 : d.top10;
  const r1 = v => +(+(v || 0)).toFixed(1);
  const partnerData = PV_CHANNELS.map(c => r1(d.partnerVals[c.key]));
  const cohortData  = PV_CHANNELS.map(c => r1(cohort[c.key]));
  const cohortLabel = _t("convAvgTop", { n: which === "top5" ? 5 : 10 });
  const ymax = Math.max(1, Math.ceil(Math.max(...partnerData, ...cohortData) * 1.18));
  _pvMountChart("pvChannelChart", el, {
    series: [{ name: cohortLabel, data: cohortData }, { name: selectedPartner, data: partnerData }],
    chart: { type: "bar", height: 320, toolbar: { show: false }, animations: { enabled: false }, fontFamily: "inherit" },
    colors: ["#3b82f6", "#ef4444"],
    plotOptions: { bar: { columnWidth: "68%", borderRadius: 3, dataLabels: { position: "top" } } },
    dataLabels: {
      enabled: true,
      formatter: v => (v == null) ? "" : fmt(Math.round(v)),
      offsetY: -14,
      style: { fontSize: "9px", colors: ["#1d4ed8", "#b91c1c"], fontWeight: 800 },
      background: { enabled: false }
    },
    xaxis: { categories: PV_CHANNELS.map(c => c.label), labels: { style: { fontSize: "9px" }, rotate: -30, trim: false }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { min: 0, max: ymax, forceNiceScale: true, labels: { formatter: v => fmt(Math.round(v)), style: { fontSize: "10px" } } },
    grid: { borderColor: "#f0f0f0", strokeDashArray: 4, padding: { top: 22, right: 14, left: 8, bottom: 0 } },
    legend: { position: "top", fontSize: "11px", fontWeight: 700, markers: { radius: 3 } },
    tooltip: { shared: true, intersect: false, y: { formatter: v => fmt(Math.round(v || 0)) } }
  });
}
