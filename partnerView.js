// partnerView.js — Vista detallada de un partner individual
// Pensado para reuniones semanales/mensuales con el partner.
// Estructura: header, KPIs globales, sección por ciudad con charts.

const PARTNER_VIEW_STATE = {
  partner: null,
  period:  "auto",   // auto | 3m | 6m | 12m | custom
  lang:    "es",     // "es" | "en"  — afecta panel ejecutivo, headers y PDF
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
  execSummary:    { es: "Análisis Ejecutivo",      en: "Executive Summary" },
  execSummarySub: { es: "Mirada de KAM senior sobre el partner",
                    en: "Senior KAM perspective on this partner" },
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
  findingsOne:    { es: "hallazgo priorizado",     en: "priority finding" },
  findingsMany:   { es: "hallazgos priorizados",   en: "priority findings" },
  actionLabel:    { es: "Acción:",                 en: "Action:" },
  // Bullets — titulos
  declineTitle:           { es: "Declive consecutivo en {city}",
                            en: "Consecutive decline in {city}" },
  declineBody:            { es: "{metric} cayó {n} {periods} seguidos.",
                            en: "{metric} dropped {n} {periods} in a row." },
  declineAction:          { es: "Visitar al partner esta {period}. Auditar conductores activos vs registrados, revisar incidencias recientes y plan de incentivos.",
                            en: "Visit the partner this {period}. Audit active vs registered drivers, review recent incidents and the incentives plan." },
  adDropSharpTitle:       { es: "Caída fuerte en Conductores Activos",
                            en: "Sharp drop in Active Drivers" },
  adDropSharpBody:        { es: "Bajó {prev} → {cur} ({pct}% vs {period} anterior).",
                            en: "Down {prev} → {cur} ({pct}% vs previous {period})." },
  adDropSharpAction:      { es: "Acción inmediata: cruzar lista de conductores desconectados y lanzar campaña de reactivación. Confirmar si hay problemas operativos (app, comisión, pago).",
                            en: "Immediate action: cross-reference disconnected drivers and launch a re-activation campaign. Confirm there are no operational issues (app, commission, payments)." },
  adDropModTitle:         { es: "Caída moderada en AD ({pct}%)",
                            en: "Moderate drop in AD ({pct}%)" },
  adDropModBody:          { es: "Tendencia negativa de {prev} → {cur}.",
                            en: "Negative trend {prev} → {cur}." },
  adDropModAction:        { es: "Monitorear próximas 2 {periods}. Revisar mix de turnos y desconexiones recientes con el partner.",
                            en: "Monitor next 2 {periods}. Review shift mix and recent disconnections with the partner." },
  adGrowTitle:            { es: "Crecimiento fuerte en AD (+{pct}%)",
                            en: "Strong AD growth (+{pct}%)" },
  adGrowBody:             { es: "Aumentó {prev} → {cur}.",
                            en: "Up {prev} → {cur}." },
  adGrowAction:           { es: "Aprovechar momentum: validar capacidad operativa, dar más visibilidad a leads Yango y considerar ampliar metas del próximo {period}.",
                            en: "Leverage the momentum: validate operational capacity, increase Yango lead visibility and consider raising targets for next {period}." },
  nrZeroTitle:            { es: "Cero ingresos de conductores este {period}",
                            en: "No new drivers this {period}" },
  nrZeroBody:             { es: "Había {prev} nuevos/reactivados el {period} anterior — esta vez 0.",
                            en: "Last {period} had {prev} new/reactivated — this time 0." },
  nrZeroAction:           { es: "Revisar pipeline de onboarding. ¿Está trabado el proceso de documentación? ¿Algún CLID dejó de cargar drivers?",
                            en: "Review the onboarding pipeline. Is documentation stuck? Did any CLID stop loading drivers?" },
  nrDropTitle:            { es: "Ingresos N+R bajaron fuerte ({cur} vs {prev})",
                            en: "New+React income dropped sharply ({cur} vs {prev})" },
  nrDropBody:             { es: "Reducción de más del 60% en nuevos drivers.",
                            en: "More than 60% drop in new drivers." },
  nrDropAction:           { es: "Confirmar si fue por estacionalidad o problema operativo. Revisar capacidad de onboarding del partner.",
                            en: "Confirm if seasonal or operational. Review the partner's onboarding capacity." },
  leadsTitle:             { es: "{leads} leads Yango sin reflejarse en AD",
                            en: "{leads} Yango leads not reflected in AD" },
  leadsBody:              { es: "El partner está recibiendo leads pero su base de conductores no crece.",
                            en: "The partner is receiving leads but the driver base isn't growing." },
  leadsAction:            { es: "Revisar tiempo y tasa de conversión lead→activación. Posible cuello de botella en documentación o capacitación inicial. Comparar con benchmark de partners similares.",
                            en: "Check lead→activation time and conversion rate. Possible bottleneck in documentation or initial training. Compare against similar-partner benchmarks." },
  metaLowTitle:           { es: "{label}: cumplimiento {pct}% (crítico)",
                            en: "{label}: {pct}% of target (critical)" },
  metaLowBody:            { es: "{cur} de {meta} comprometidos. Gap de {gap}.",
                            en: "{cur} of {meta} committed. Gap of {gap}." },
  metaMidTitle:           { es: "{label}: cumplimiento {pct}%",
                            en: "{label}: {pct}% of target" },
  metaMidBody:            { es: "{cur} de {meta}. Falta {gap} para llegar al 100%.",
                            en: "{cur} of {meta}. {gap} short of 100%." },
  metaMidAction:          { es: "Acelerar las próximas {periods}. Confirmar con el partner si la meta sigue siendo realista o necesita ajuste.",
                            en: "Accelerate over the next {periods}. Confirm with the partner whether the target is still realistic or needs adjustment." },
  metaHighTitle:          { es: "{label}: sobre-cumplimiento {pct}%",
                            en: "{label}: {pct}% over target" },
  metaHighBody:           { es: "{cur} vs {meta} comprometidos (+{over}).",
                            en: "{cur} vs {meta} committed (+{over})." },
  metaAdLowAction:        { es: "Plan de aceleración: identificar conductores con potencial de reactivación y agendar reunión esta {period}.",
                            en: "Acceleration plan: identify drivers with re-activation potential and schedule a meeting this {period}." },
  metaAdHighAction:       { es: "Caso de éxito. Documentar qué está funcionando y replicarlo en otros partners del mismo KAM.",
                            en: "Success case. Document what's working and replicate it across other partners under the same KAM." },
  metaNrLowAction:        { es: "Revisar pipeline de inducción y velocidad de procesamiento de nuevos drivers.",
                            en: "Review the induction pipeline and processing speed for new drivers." },
  metaNrHighAction:       { es: "Excelente captación. Confirmar que el partner tiene capacidad operativa para sostener el ritmo.",
                            en: "Excellent acquisition. Confirm the partner has operational capacity to sustain the pace." },
  metaShLowAction:        { es: "Revisar turnos y motivar a conductores con bajo % de online. Posible problema de incentivos.",
                            en: "Review shifts and motivate drivers with low online %. Possible incentive issue." },
  metaShHighAction:       { es: "Excelente productividad por conductor. Evaluar incrementar leads Yango asignados.",
                            en: "Excellent productivity per driver. Consider increasing assigned Yango leads." },
  noMetasTitle:           { es: "Partner sin metas asignadas",
                            en: "Partner with no targets assigned" },
  noMetasBody:            { es: "El sistema tiene metas para otros partners pero no para este.",
                            en: "The system has targets for other partners but not for this one." },
  noMetasAction:          { es: "Definir metas mensuales con el partner para tener métricas claras de seguimiento.",
                            en: "Define monthly targets with the partner to track clear KPIs." },
  cityGapTitle:           { es: "Brecha grande entre ciudades",
                            en: "Large gap across cities" },
  cityGapBody:            { es: "{best}: {bestAd} AD vs {worst}: {worstAd} AD ({ratio}x diferencia).",
                            en: "{best}: {bestAd} AD vs {worst}: {worstAd} AD ({ratio}x difference)." },
  cityGapAction:          { es: "Replicar el modelo de operación de {best} en {worst}. Preguntar al partner qué hacen distinto en la mejor ciudad.",
                            en: "Replicate the operating model from {best} in {worst}. Ask the partner what they do differently in their best city." },
  commTitle:              { es: "Comisión baja sin caer viajes",
                            en: "Commission down without trips dropping" },
  commBody:               { es: "Viajes {trPct}%, comisión {coPct}%.",
                            en: "Trips {trPct}%, commission {coPct}%." },
  commAction:             { es: "Posible cambio en tarifa promedio o mix de servicios. Revisar tipos de viaje predominantes y promociones activas.",
                            en: "Possible change in average fare or service mix. Review predominant trip types and active promotions." },
  noAlertsTitle:          { es: "Sin alertas críticas",
                            en: "No critical alerts" },
  noAlertsBody:           { es: "Métricas dentro de parámetros normales en el último período.",
                            en: "Metrics within normal range for the latest period." },
  noAlertsAction:         { es: "Mantener seguimiento regular. Continuar conversando objetivos del próximo {period} con el partner.",
                            en: "Keep regular follow-up. Continue discussing next {period}'s objectives with the partner." },
  // Decline metric labels
  metricActiveDrivers:    { es: "Conductores Activos",      en: "Active Drivers" },
  metricSupplyHours:      { es: "Horas de Conexión",        en: "Supply Hours" },
  metricNR:               { es: "Nuevos+Reactivados",       en: "New+Reactivated" },

  // ── 9 hallazgos nuevos basados en metricas puras (sin metas) ─────────────
  trendDownTitle:         { es: "Tendencia AD negativa a largo plazo",
                            en: "Long-term negative AD trend" },
  trendDownBody:          { es: "Promedio últimos 3 {periods} cayó {pct}% vs los 3 {periods} anteriores ({prevAvg} → {curAvg} AD).",
                            en: "Average of last 3 {periods} dropped {pct}% vs prior 3 {periods} ({prevAvg} → {curAvg} AD)." },
  trendDownAction:        { es: "No es ruido puntual: es una caída sostenida. Revisar plan estructural — incentivos, calidad del servicio, retención de conductores.",
                            en: "Not noise: it's a sustained decline. Review the structural plan — incentives, service quality, driver retention." },
  trendUpTitle:           { es: "Crecimiento sostenido en AD",
                            en: "Sustained AD growth" },
  trendUpBody:            { es: "Promedio últimos 3 {periods} subió {pct}% vs los 3 {periods} anteriores ({prevAvg} → {curAvg} AD).",
                            en: "Average of last 3 {periods} grew {pct}% vs prior 3 {periods} ({prevAvg} → {curAvg} AD)." },
  trendUpAction:          { es: "Tracción real, no rebote puntual. Validar capacidad operativa del partner para sostener el ritmo y conversar próximos pasos de expansión.",
                            en: "Real traction, not a one-off bounce. Validate the partner's operational capacity to sustain it and discuss next expansion steps." },
  prodLowTitle:           { es: "Baja productividad por conductor",
                            en: "Low productivity per driver" },
  prodLowBody:            { es: "Promedio de {hours}h por conductor en el último {period}. Esperado: >20h.",
                            en: "Average of {hours}h per driver in the last {period}. Expected: >20h." },
  prodLowAction:          { es: "Conductores presentes pero subutilizados. Revisar mix de turnos, ofertas de pico, calidad del despacho y motivación. Posible falta de incentivos para horas pico.",
                            en: "Drivers present but underutilized. Review shift mix, peak-hour offers, dispatch quality and motivation. Possible lack of peak-hour incentives." },
  prodHighTitle:           { es: "Excelente productividad por conductor",
                            en: "Excellent productivity per driver" },
  prodHighBody:            { es: "Promedio de {hours}h por conductor en el último {period}. Top tier (>35h).",
                            en: "Average of {hours}h per driver in the last {period}. Top tier (>35h)." },
  prodHighAction:          { es: "Caso de éxito: el partner está exprimiendo bien su base. Documentar prácticas (turnos, incentivos, comunicación) y replicar en otros partners del mismo KAM.",
                            en: "Success case: the partner is leveraging its base well. Document practices (shifts, incentives, communication) and replicate across other partners under the same KAM." },
  volatilityTitle:         { es: "Alta volatilidad operativa",
                            en: "High operational volatility" },
  volatilityBody:          { es: "AD oscila >25% entre {periods} consecutivos. Inestabilidad por encima del promedio.",
                            en: "AD swings >25% between consecutive {periods}. Above-average instability." },
  volatilityAction:        { es: "Identificar qué causa los picos y valles (eventos, cambios de turno, llegada/baja masiva). Estabilizar para hacer la operación predecible y poder pronosticar.",
                            en: "Identify what causes peaks and valleys (events, shift changes, mass arrivals/departures). Stabilize to make operations predictable and forecast-friendly." },
  commPerTripTitle:        { es: "Comisión por viaje en caída",
                            en: "Commission per trip dropping" },
  commPerTripBody:         { es: "Ratio comisión/viaje bajó de {prev} a {cur} (-{pct}%).",
                            en: "Commission-per-trip ratio dropped from {prev} to {cur} (-{pct}%)." },
  commPerTripAction:       { es: "Cambió el mix de tarifas o tipo de servicio. Revisar predominio de viajes cortos vs largos, promociones activas y tarifa base. Si es persistente, impacta ingresos.",
                            en: "Trip fare mix or service type changed. Review short vs long trip share, active promotions and base fares. If persistent, it impacts revenue." },
  peakBestTitle:           { es: "Partner en su mejor momento histórico",
                            en: "Partner at its all-time best" },
  peakBestBody:            { es: "AD actual ({cur}) está al {pct}% de su pico histórico ({peak}). Es un momento de máxima.",
                            en: "Current AD ({cur}) is at {pct}% of all-time peak ({peak}). This is a peak moment." },
  peakBestAction:          { es: "Aprovechar este nivel para pedir compromisos: ampliar metas, abrir nuevas zonas, sumar más conductores. El partner tiene momentum.",
                            en: "Leverage this level to ask for commitments: expand goals, open new zones, add more drivers. The partner has momentum." },
  peakLowTitle:            { es: "Muy por debajo del pico histórico",
                            en: "Far below all-time peak" },
  peakLowBody:             { es: "AD actual ({cur}) está al {pct}% de su pico histórico ({peak}). Capacidad demostrada NO está siendo usada.",
                            en: "Current AD ({cur}) is at {pct}% of all-time peak ({peak}). Demonstrated capacity is NOT being used." },
  peakLowAction:           { es: "Hay potencial probado de hacer {peak} conductores activos. Revisar qué cambió desde entonces: rotación, competencia, calidad del servicio, comisión, app.",
                            en: "There is proven capacity to reach {peak} active drivers. Review what changed since then: turnover, competition, service quality, commission, app." },
  leadDepTitle:            { es: "Alta dependencia de leads Yango",
                            en: "High dependency on Yango leads" },
  leadDepBody:             { es: "{pct}% de los nuevos drivers viene de Yango ({yango} de {total}). El partner depende del lead externo.",
                            en: "{pct}% of new drivers come from Yango ({yango} of {total}). The partner depends on external leads." },
  leadDepAction:           { es: "Trabajar con el partner para fortalecer su propio pipeline de captación: referidos, redes sociales, alianzas locales. Reduce el riesgo si Yango baja la asignación de leads.",
                            en: "Work with the partner to strengthen its own acquisition pipeline: referrals, social media, local partnerships. Reduces risk if Yango lowers lead assignment." }
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
  rows.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = {
      date: r.date, ad: 0, nr: 0, sh: 0,
      trips: 0, commission: 0,
      npPartner: 0, npService: 0, reactivated: 0
    };
    const e = byDate[r.date];
    // AD es snapshot: max entre CLIDs duplicados del mismo partner+ciudad+fecha
    if ((r.activeDrivers || 0) > e.ad) e.ad = r.activeDrivers || 0;
    e.npPartner   += r.newPartner;
    e.npService   += r.newService;
    e.reactivated += r.reactivated;
    e.nr = e.npPartner + e.npService + e.reactivated;
    e.sh += r.supplyHours;
    e.trips      += r.trips || 0;
    e.commission += r.commission || 0;
  });
  return dates.map(d => byDate[d] || {
    date: d, ad: 0, nr: 0, sh: 0,
    trips: 0, commission: 0,
    npPartner: 0, npService: 0, reactivated: 0
  });
}

// ── RENDER PRINCIPAL ──────────────────────────────────────────────────────────
function renderPartnerView() {
  const el = document.getElementById("partnerViewContent");
  if (!el) return;
  ensureIndexes();
  _pvDestroyCharts();
  // Reset _seriesCache: la siguiente seccion lo repuebla solo para el render
  // actual. Evita acumulacion sin limite si el usuario navega muchos partners.
  PARTNER_VIEW_STATE._seriesCache = {};

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
  const tAD = lastRows.reduce((s, r) => Math.max(s, r.activeDrivers), 0);  // max por ciudad
  // Para AD a nivel global mejor sumar ciudades del último period
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

      <!-- KPIs globales -->
      ${_secH("⚡", "#FF0000", _t("kpisTitle"), `${d2s(lastDate)}`)}
      <div class="section" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px">
        ${_pvKpiCard(_t("activeDrivers"), tADsum, pADsum, METRICS.ad.color)}
        ${_pvKpiCard(_t("newReact"),      tNR,    pNR,    METRICS.nr.color)}
        ${_pvKpiCard(_t("supplyHours"),   tSH,    pSH,    METRICS.sh.color, { useK: true })}
        ${_pvKpiCard(_t("trips"),         tTr,    null,   "#10b981",       { useK: true })}
        ${_pvKpiCard(_t("commission"),    tCo,    null,   "#06b6d4",       { isMoney: true, useK: true })}
      </div>

      <!-- Sección por ciudad -->
      ${_secH("🏙️", "#06b6d4", _t("cityDetail"), `${citiesOf.length} ${citiesOf.length>1?_t("cityCountPlural"):_t("cityCount")} · ${periodLabel}`)}
      <div class="section">
        ${citiesOf.map(city => {
          // Cachear series por ciudad para no recalcular en buildCharts
          if (!PARTNER_VIEW_STATE._seriesCache) PARTNER_VIEW_STATE._seriesCache = {};
          const ck = `${partner}|||${city}|||${dates.join(",")}`;
          if (!PARTNER_VIEW_STATE._seriesCache[ck]) {
            PARTNER_VIEW_STATE._seriesCache[ck] = _pvSeriesByPartnerCity(partner, city, dates);
          }
          return _pvCitySection(partner, city, dates, recibeLeads, PARTNER_VIEW_STATE._seriesCache[ck]);
        }).join("")}
      </div>
    </div>`;

  // Marca de render unica para evitar race conditions de setTimeout
  const renderId = (PARTNER_VIEW_STATE._renderId = (PARTNER_VIEW_STATE._renderId || 0) + 1);
  el.innerHTML = html;

  // Construir charts despues de innerHTML. Si llega otro render antes,
  // el renderId cambia y el setTimeout previo se ignora.
  setTimeout(() => {
    if (renderId !== PARTNER_VIEW_STATE._renderId) return;
    citiesOf.forEach(city => {
      const ck = `${partner}|||${city}|||${dates.join(",")}`;
      const series = PARTNER_VIEW_STATE._seriesCache?.[ck] || _pvSeriesByPartnerCity(partner, city, dates);
      _pvBuildCityCharts(partner, city, dates, recibeLeads, series);
    });
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
        if (r.activeDrivers > ex.activeDrivers) ex.activeDrivers = r.activeDrivers;
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

  // ── 2. Variacion fuerte en AD global ──────────────────────────────────────
  const wowAD = pADsum > 0 ? ((tADsum - pADsum) / pADsum) * 100 : null;
  if (wowAD !== null) {
    if (wowAD <= -15) {
      findings.push({
        sev: "red", icon: "🔴",
        title:  _t("adDropSharpTitle"),
        body:   _t("adDropSharpBody",  { prev: pADsum.toLocaleString(), cur: tADsum.toLocaleString(), pct: wowAD.toFixed(1), period }),
        action: _t("adDropSharpAction")
      });
    } else if (wowAD <= -5) {
      findings.push({
        sev: "yellow", icon: "🟡",
        title:  _t("adDropModTitle",  { pct: wowAD.toFixed(1) }),
        body:   _t("adDropModBody",   { prev: pADsum, cur: tADsum }),
        action: _t("adDropModAction", { periods })
      });
    } else if (wowAD >= 15) {
      findings.push({
        sev: "green", icon: "🟢",
        title:  _t("adGrowTitle",  { pct: wowAD.toFixed(1) }),
        body:   _t("adGrowBody",   { prev: pADsum.toLocaleString(), cur: tADsum.toLocaleString() }),
        action: _t("adGrowAction", { period })
      });
    }
  }

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

  // ── 5. Tendencia AD largo plazo (avg 3 ultimos vs 3 anteriores) ──────────
  // Construir serie agregada del partner por fecha (total cross-city, dedup CLID por ciudad/fecha)
  if (dates.length >= 6) {
    const adByDate = {};
    const seen = new Set();
    partnerRows.forEach(r => {
      const dk = `${r.clid}|${r.city}|${r.date}`;
      if (seen.has(dk)) return;
      seen.add(dk);
      adByDate[r.date] = (adByDate[r.date] || 0) + (r.activeDrivers || 0);
    });
    const serieAD = dates.map(d => adByDate[d] || 0);
    const last3 = serieAD.slice(-3);
    const prev3 = serieAD.slice(-6, -3);
    const sumL = last3.reduce((s, x) => s + x, 0);
    const sumP = prev3.reduce((s, x) => s + x, 0);
    if (sumP > 0) {
      const chg = ((sumL - sumP) / sumP) * 100;
      const avgL = Math.round(sumL / 3);
      const avgP = Math.round(sumP / 3);
      if (chg <= -5) {
        findings.push({
          sev: "red", icon: "🔴",
          title:  _t("trendDownTitle"),
          body:   _t("trendDownBody", { periods, pct: Math.abs(chg).toFixed(1), prevAvg: avgP.toLocaleString(), curAvg: avgL.toLocaleString() }),
          action: _t("trendDownAction")
        });
      } else if (chg >= 5) {
        findings.push({
          sev: "green", icon: "🟢",
          title:  _t("trendUpTitle"),
          body:   _t("trendUpBody", { periods, pct: chg.toFixed(1), prevAvg: avgP.toLocaleString(), curAvg: avgL.toLocaleString() }),
          action: _t("trendUpAction")
        });
      }
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

    // ── 7. Pico historico vs actual ────────────────────────────────────────
    const peak = Math.max(...serieAD);
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

  // ── 8. Productividad SH/AD ───────────────────────────────────────────────
  if (tADsum > 0 && tSH > 0) {
    const ratio = tSH / tADsum;  // horas promedio por conductor en el ultimo periodo
    if (ratio < 20) {
      findings.push({
        sev: "yellow", icon: "🟡",
        title:  _t("prodLowTitle"),
        body:   _t("prodLowBody",  { hours: ratio.toFixed(1), period }),
        action: _t("prodLowAction")
      });
    } else if (ratio > 35) {
      findings.push({
        sev: "green", icon: "🟢",
        title:  _t("prodHighTitle"),
        body:   _t("prodHighBody", { hours: ratio.toFixed(1), period }),
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
    yaxis: { labels: { formatter: v => fmtFn(v), style: { fontSize: "10px" } } },
    grid: { borderColor: "#f0f0f0", strokeDashArray: 4 },
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
    yaxis: { labels: { formatter: v => fmt(v), style: { fontSize: "10px" } } },
    grid: { borderColor: "#f0f0f0", strokeDashArray: 4 },
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
        labels: { formatter: v => fmtSmart(v), style: { fontSize: "10px" } } },
      { opposite: true, seriesName: (series[1] && series[1].name) || "Comisión",
        labels: { formatter: v => "$" + fmtSmart(v), style: { fontSize: "10px" } } }
    ],
    grid: { borderColor: "#f0f0f0", strokeDashArray: 4 },
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
    const canvas = await html2canvas(content, { scale: 2, useCORS: true, logging: false, backgroundColor: "#fff" });
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
