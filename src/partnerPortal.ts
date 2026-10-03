//@ts-nocheck
// partnerPortal.ts — Portal del PARTNER externo (rediseño 2-oct-2026).
//
// Lo que ve alguien de AFUERA de la empresa: SU operación, nada más. Pestañas
// (maqueta ?ui=portal, aprobada por Manuel): Resumen · Desempeño · Subflotas ·
// Mis datos, con escala + rango de fechas + ciudad + subflota arriba, que aplican
// a todo el portal.
//
// DÓNDE ESTÁ LA SEGURIDAD REAL: en la base, no acá.
//   - rendimiento* se lee por portal_rendimiento*() (solo sus CLIDs y SIN columnas
//     internas: participación de mercado, subsidios, fraude, KAM). Ver
//     shared/lecturaPartner.ts y la migración 2026-10-02_portal_partner_columnas.sql.
//   - El resto (metas, partners, fleetrooms, logos) lo recorta RLS por my_clids().
//   - La comparación con el mercado (portal_mercado) devuelve SOLO tasas
//     agregadas: mediana con >= 5 partners y rango típico con >= 10.
// Por eso acá no hay (ni debe haber) un filtro "where clid = ..." de seguridad.
//
// Total del partner = Combinado (Taxi + TukTuk), igual que el reporte de su KAM.
// Delivery y Cargo se muestran aparte (Subflotas, Mis datos) y no suman.

import { registerActions } from "./shared/actions.js";
import { t, mesLabel, getLang } from "./core/i18n";
import { logAccess } from "./shared/accessLog.js";
import { stampPDF } from "./shared/pdfmeta.js";
import { ensurePdfLibs } from "./shared/lazyLibs.js";
import { opcionesCapturaClara, tokenClaro } from "./shared/exportClaro";
// Mismo núcleo de cálculo que Desempeño y el deck: el partner tiene que ver
// EXACTAMENTE los números que su KAM le presenta.
import { seriesByDate, projectFlow, ratio, tasaPonderada } from "./domain/metrics.js";
import { reportYM, diasMesReporteDe, MES_NOMBRES } from "./shared/mesReporte.js";
import { datasetLinea, sliceEscala } from "./shared/escala.js";
import { dn } from "./shared/huella";
import { esMesEnCurso } from "./domain/mesEnCurso";
import { escalaLista, reintentarCuandoEscalaLista } from "./shared/escalaLista";
import { fechaLocalISO } from "./shared/fechaLocal";
import { delta, goalTone, emptyState, icon } from "./shared/ui";
import { apexBase, seriesColor, chartTokens } from "./shared/chartTheme";
import { alertDialog } from "./shared/confirmDialog";
import { filaCSV } from "./shared/csv";
import { ensureFullRendColumns, ensurePartnerLogos } from "./data.js";
import { ensureApex } from "./charts.js";
import { ChartRegistry } from "./core/chartRegistry.js";
import { veredictoMercado, subflotasDe, tipoSubflota } from "./domain/portalPartner";

// Rótulos con clave explícita (check:drift verifica que existan en los 3 idiomas).
const _TIPO = { fleet: "pt.tipo.fleet", tuktuk: "pt.tipo.tuktuk", delivery: "pt.tipo.delivery", cargo: "pt.tipo.cargo", otra: "pt.tipo.otra", taxi: "pt.tipo.taxi" };
const _TAB = { resumen: "pt.tab.resumen", desempeno: "pt.tab.desempeno", subflotas: "pt.tab.subflotas", datos: "pt.tab.datos" };
const _AT = { diario: "pt.at.diario", semanal: "pt.at.semanal", mensual: "pt.at.mensual" };
const _VER = { mejor: "pt.mkt.ver.mejor", peor: "pt.mkt.ver.peor", normal: "pt.mkt.ver.normal" };

export const PORTAL_STATE = {
  tab: "resumen", city: "all", sub: "todas", metrica: "ad",
  cols: new Set(["base", "adq"]), mercado: null
};

// ¿La sesión actual es de un partner externo?
export function isPartnerSession() {
  return STATE.userRole === "partner";
}

// ── Datos ────────────────────────────────────────────────────────────────────
const _rango = () => ({
  from: document.getElementById("dateFrom")?.value || "",
  to:   document.getElementById("dateTo")?.value   || ""
});
const _enRango = (r, rg) => (!rg.from || r.date >= rg.from) && (!rg.to || r.date <= rg.to);
const _ciudadOk = r => PORTAL_STATE.city === "all" || r.city === PORTAL_STATE.city;
// Todas las filas del partner en la escala activa: Combinado + Delivery + Cargo.
function _todas() {
  return datasetLinea(STATE, "comb")
    .concat(sliceEscala(STATE, "Delivery"), sliceEscala(STATE, "Cargo"));
}
// Filas que entran en los números (rango + ciudad + subflota). "todas" = el
// total del partner (Combinado); una subflota puntual puede ser Delivery/Cargo.
function _filas() {
  const rg = _rango(), sub = PORTAL_STATE.sub;
  const base = sub === "todas" ? datasetLinea(STATE, "comb") : _todas().filter(r => (r.db_id || "") === sub);
  return base.filter(r => _enRango(r, rg) && _ciudadOk(r));
}
const _sum = (rows, fn) => rows.reduce((s, r) => s + (fn(r) || 0), 0);
const _nuevos = r => (r.newPartner || 0) + (r.newService || 0);
const _n50 = r => (r.newFromPartner50t || 0) + (r.newFromService50t || 0);
function _porPeriodo(rows) {
  const m = new Map();
  rows.forEach(r => { let a = m.get(r.date); if (!a) { a = []; m.set(r.date, a); } a.push(r); });
  const fechas = [...m.keys()].sort();
  return { fechas, de: f => m.get(f) || [] };
}
function _serie(rows, fn) {
  const by = {};
  rows.forEach(r => { by[r.date] = (by[r.date] || 0) + (fn(r) || 0); });
  return { dates: Object.keys(by).sort(), values: seriesByDate(by) };
}
// KPIs del último período del rango y del anterior + totales del rango.
function _kpis(rows) {
  const p = _porPeriodo(rows), n = p.fechas.length;
  const L = p.de(p.fechas[n - 1]), P = n > 1 ? p.de(p.fechas[n - 2]) : [];
  const k = rs => ({ ad: _sum(rs, r => r.activeDrivers), nue: _sum(rs, _nuevos), rea: _sum(rs, r => r.reactivated),
    sh: _sum(rs, r => r.supplyHours), tr: _sum(rs, r => r.trips), gmv: _sum(rs, r => r.gmv), com: _sum(rs, r => r.commission) });
  const l = k(L), pr = n > 1 ? k(P) : null, tot = k(rows);
  const ganados = l.nue + l.rea;
  return {
    fechas: p.fechas, ult: p.fechas[n - 1] || "", l, p: pr, tot,
    // Retención = la fórmula de la Presentación y de Desempeño (y de portal_mercado):
    // (AD − nuevos − reactivados) / AD anterior. En diario no se muestra.
    ret: pr && pr.ad > 0 && STATE.curMode !== "diario" ? (l.ad - ganados) / pr.ad : null,
    perdidos: pr ? Math.max(0, pr.ad + ganados - l.ad) : null,
    // Sin NINGÚN registro de "llegó a 50 viajes" en el rango, la fuente no trae
    // el dato (no es que nadie llegó): "—" y no 0%.
    a50: tot.nue > 0 && _sum(rows, _n50) > 0 ? _sum(rows, _n50) / tot.nue : null,
    pctReact: tot.nue + tot.rea > 0 ? tot.rea / (tot.nue + tot.rea) : null,
    acc: tasaPonderada(rows.map(r => [r.acceptanceRate, r.trips])),
    compl: tasaPonderada(rows.map(r => [r.completionRate, r.trips])),
    rating: tasaPonderada(rows.map(r => [r.avgDriverRating, r.trips])),
    soporte: tasaPonderada(rows.map(r => [r.driverSupportRequestsShare, r.trips]))
  };
}

// ── Formato ──────────────────────────────────────────────────────────────────
const _pct = (v, d = 1) => v == null || !isFinite(v) ? "—" : (v * 100).toFixed(d) + "%";
const _n = v => v == null || !isFinite(v) ? "—" : fmt(Math.round(v));
const _sol = v => v == null || !isFinite(v) ? "—" : "S/ " + fmt(Math.round(v));
const _dec = (v, d) => v == null || !isFinite(v) ? "—" : v.toFixed(d);
function _delta(a, b, menosEsMejor = false) {
  if (STATE.curMode === "diario" && b == null) return "";
  if (a == null || b == null || !b) return "";
  const pct = ((a - b) / b) * 100;
  return delta(menosEsMejor ? -pct : pct, { label: (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%" });
}
const _per = () => t(STATE.curMode === "mensual" ? "pt.per.mes" : STATE.curMode === "diario" ? "pt.per.dia" : "pt.per.semana");
const _ultPer = () => t(STATE.curMode === "mensual" ? "pt.ult.mes" : STATE.curMode === "diario" ? "pt.ult.dia" : "pt.ult.semana");
const _cap = s => s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s;
const _card = (titulo, cuerpo, extra = "") => `<section class="ui-card pt-card ${extra}"><h3 class="pt-card__t">${titulo}</h3>${cuerpo}</section>`;
function _kpi(label, valor, d, sub, mkt = "", num = "") {
  return `<div class="pt-kpi"><span class="pt-kpi__l">${escapeHTML(label)}</span><b${num ? dn(num) : ""}>${valor}</b>${d || ""}${sub ? `<small>${escapeHTML(sub)}</small>` : ""}${mkt}</div>`;
}

// ── Mercado (fase 2) ─────────────────────────────────────────────────────────
// Cache por (escala, rango, ciudad). La función de la base hace TODO el cálculo;
// acá solo se pide y se pinta.
const _mercado = new Map();
function _mercadoCiudad() {
  if (PORTAL_STATE.mercado) return PORTAL_STATE.mercado;
  if (PORTAL_STATE.city !== "all") return PORTAL_STATE.city;
  const ad = {};
  datasetLinea(STATE, "comb").forEach(r => { ad[r.city] = (ad[r.city] || 0) + (r.activeDrivers || 0); });
  const c = Object.keys(ad).sort((a, b) => ad[b] - ad[a])[0];
  return c || "__peru";
}
function _mercadoDatos() {
  const rg = _rango();
  if (!rg.from || !rg.to) return null;
  const ciudad = _mercadoCiudad();
  const clave = [STATE.curMode, rg.from, rg.to, ciudad].join("|");
  const e = _mercado.get(clave);
  if (e) return e.datos;
  _mercado.set(clave, { datos: null });
  sb.rpc("portal_mercado", { scale: STATE.curMode, desde: rg.from, hasta: rg.to, ciudad: ciudad === "__peru" ? null : ciudad })
    .then(({ data, error }) => {
      if (error) { _mercado.delete(clave); if (DEBUG) console.error(error); return; }
      const porM = {};
      (data || []).forEach(f => { porM[f.metrica] = { tu: f.tu == null ? null : +f.tu, med: f.mediana == null ? null : +f.mediana,
        p25: f.p25 == null ? null : +f.p25, p75: f.p75 == null ? null : +f.p75, n: f.n || 0 }; });
      _mercado.set(clave, { datos: porM });
      if (STATE.curTab === "portal" && (PORTAL_STATE.tab === "desempeno" || PORTAL_STATE.tab === "resumen")) renderPartnerPortal();
    })
    .catch(() => _mercado.delete(clave));
  return null;
}
const _ciudadMercadoTxt = () => { const c = _mercadoCiudad(); return c === "__peru" ? t("pt.mkt.peru") : cityLabel(c); };
const _MKT = {
  retencion:   { l: "pt.mkt.retencion",   f: v => _pct(v) },
  pct_react:   { l: "pt.mkt.pctReact",    f: v => _pct(v, 0) },
  a50:         { l: "pt.mkt.a50",         f: v => _pct(v, 0) },
  hpc:         { l: "pt.mkt.hpc",         f: v => _dec(v, 1) },
  vph:         { l: "pt.mkt.vph",         f: v => _dec(v, 2) },
  iph:         { l: "pt.mkt.iph",         f: v => v == null ? "—" : "S/ " + v.toFixed(1) },
  aceptacion:  { l: "pt.mkt.aceptacion",  f: v => _pct(v) },
  completados: { l: "pt.mkt.completados", f: v => _pct(v) },
  soporte:     { l: "pt.mkt.soporte",     f: v => _pct(v), menos: true }
};
function _chipMercado(k) {
  const m = (_mercadoDatos() || {})[k];
  if (!m || m.med == null) return "";
  const v = veredictoMercado(m.tu, m.p25, m.p75, !!_MKT[k].menos);
  return `<span class="pt-mkt pt-mkt--${v}" title="${escapeHTML(t("pt.mkt.chipTip", { n: m.n }))}">${escapeHTML(t("pt.mkt.chip", { c: _ciudadMercadoTxt(), v: _MKT[k].f(m.med) }))}</span>`;
}
function _tarjetaMercado() {
  const datos = _mercadoDatos();
  const ciudades = [...new Set(datasetLinea(STATE, "comb").map(r => r.city).filter(Boolean))].sort();
  const sel = _mercadoCiudad();
  const opciones = ciudades.map(c => `<button type="button" class="ui-segmented__btn" aria-pressed="${sel === c}" data-act="portalMercado" data-v="${escapeHTML(c)}">${escapeHTML(t("pt.mkt.de", { c: cityLabel(c) }))}</button>`).join("")
    + `<button type="button" class="ui-segmented__btn" aria-pressed="${sel === "__peru"}" data-act="portalMercado" data-v="__peru">${escapeHTML(t("pt.mkt.peru"))}</button>`;
  let cuerpo;
  if (!datos) cuerpo = `<p class="pt-mut">${escapeHTML(t("pt.mkt.cargando"))}</p>`;
  else {
    const filas = Object.keys(_MKT).map(k => {
      const m = datos[k], d = _MKT[k];
      if (!m || m.med == null) return "";
      const banda = m.p25 != null && m.p75 != null;
      const vals = [m.tu, m.med, m.p25, m.p75].filter(v => v != null);
      const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1;
      const X = v => ((v - (lo - pad)) / ((hi + pad) - (lo - pad)) * 100).toFixed(1);
      const ver = veredictoMercado(m.tu, m.p25, m.p75, !!d.menos);
      return `<div class="pt-cmp__row"><span>${escapeHTML(t(d.l))}</span>
        <div class="pt-cmp__bar">${banda ? `<span class="pt-cmp__band" style="left:${X(m.p25)}%;width:${(X(m.p75) - X(m.p25)).toFixed(1)}%"></span>` : ""}
          <span class="pt-cmp__med" style="left:${X(m.med)}%"></span>${m.tu != null ? `<span class="pt-cmp__tu" style="left:${X(m.tu)}%"></span>` : ""}</div>
        <b>${d.f(m.tu)}</b><small>${escapeHTML(t("pt.mkt.tipico", { v: d.f(m.med) }))}</small>
        <span class="pt-ver pt-ver--${ver}">${escapeHTML(t(_VER[ver]))}</span></div>`;
    }).join("");
    const n = Math.max(0, ...Object.values(datos).map(m => m.n || 0));
    cuerpo = filas
      ? `<div class="pt-cmp">${filas}</div>
         <div class="pt-leg"><span><i class="pt-cmp__tu pt-leg__tu"></i>${escapeHTML(t("pt.mkt.tu"))}</span><span><i class="pt-cmp__med pt-leg__med"></i>${escapeHTML(t("pt.mkt.mediana"))}</span><span><i class="pt-cmp__band pt-leg__band"></i>${escapeHTML(t("pt.mkt.rangoTipico"))}</span></div>
         <p class="pt-mut">${escapeHTML(t("pt.mkt.nota", { n, c: _ciudadMercadoTxt() }))}</p>`
      : `<p class="pt-mut">${escapeHTML(t("pt.mkt.pocos"))}</p>`;
  }
  return _card(escapeHTML(t("pt.mkt.titulo")), `<div class="pt-row"><span class="pt-lbl">${escapeHTML(t("pt.mkt.comparar"))}</span><div class="ui-segmented">${opciones}</div></div>${cuerpo}`, "pt-span2");
}

// ── Metas del mes (misma regla que Desempeño y el deck) ──────────────────────
function _mesEnFrase(mes) {
  const s = mesLabel(mes) || "";
  return ({ es: 1, ru: 1 })[getLang()] ? s.toLocaleLowerCase() : s;
}
// Metas del mes vs actual, Combinado (la meta paraguas ya cubre Taxi + TukTuk).
// Mes = el del "Hasta" si tiene meta cargada; si no, el más reciente.
function _portalMetas(rows) {
  const metas = STATE.metasData || [];
  if (!metas.length || !rows.length) return "";
  const maxAnio = new Map();
  metas.forEach(m => { if (m.mes && m.mYear != null && !(maxAnio.get(m.mes) >= m.mYear)) maxAnio.set(m.mes, m.mYear); });
  const meses = [...new Set(metas.map(m => m.mes))].filter(Boolean)
    .sort((a, b) => _metasMesOrden(b, maxAnio.get(b) ?? null) - _metasMesOrden(a, maxAnio.get(a) ?? null));
  if (!meses.length) return "";
  const dates = [...new Set(rows.map(r => r.date))].sort();
  const lastAll = dates[dates.length - 1] || "";
  let mes = meses[0];
  if (lastAll) {
    const name = MES_NOMBRES[reportYM(lastAll, STATE.curMode, parseLocalDate).m - 1];
    if (name && meses.includes(name)) mes = name;
  }
  const metaAños = metas.filter(m => m.mes === mes && m.mYear != null).map(m => m.mYear);
  const mesYearSel = metaAños.length ? Math.max(...metaAños) : null;
  const delMes = metas.filter(m => m.mes === mes && (mesYearSel == null || m.mYear == null || m.mYear === mesYearSel) && _ciudadOk(m));
  const rowsMes = rows.filter(r => {
    const rym = reportYM(r.date, STATE.curMode, parseLocalDate);
    return MES_NOMBRES[rym.m - 1] === mes && (mesYearSel == null || rym.y === mesYearSel);
  });
  const datesMes = [...new Set(rowsMes.map(r => r.date))].sort();
  const last = datesMes[datesMes.length - 1] || "";
  const adAct = _sum(rowsMes.filter(r => r.date === last), r => r.activeDrivers);
  const nrAct = _sum(rowsMes, r => _nuevos(r) + (r.reactivated || 0));
  const shAct = _sum(rowsMes, r => r.supplyHours);
  const adSerie = _serie(rowsMes, r => r.activeDrivers).values;
  const { daysElapsed, daysRemaining } = diasMesReporteDe(STATE, last, parseLocalDate);
  const anioMes = mesYearSel != null ? mesYearSel : (last ? reportYM(last, STATE.curMode, parseLocalDate).y : null);
  const proyOn = esMesEnCurso(MES_NOMBRES.indexOf(mes) + 1, anioMes);
  const mesFrase = escapeHTML(_mesEnFrase(mes));
  const sumOrNull = fn => { let s = null; delMes.forEach(m => { const v = fn(m); if (v != null) s = (s || 0) + v; }); return s; };
  const mA = sumOrNull(m => m.mA || null), mNR = sumOrNull(m => m.mNR || null), mH = sumOrNull(m => m.mH || null);
  if (mA == null && mNR == null && mH == null) return "";
  return _card(escapeHTML(t("portal.metasComb", { m: mesLabel(mes) })),
    `<p class="pt-mut">${escapeHTML(proyOn ? t("portal.metasSubEnCurso") : t("portal.metasSubCerrado"))}</p>
    <div class="pp-goals">
      ${_metaFila(t("metric.ad.label"), adAct, mA, proyOn ? projAD(adSerie, last) : null, fmt, "portal.metas.comb.ad", mesFrase)}
      ${_metaFila(t("metric.nr.label"), nrAct, mNR, proyOn ? projectFlow(nrAct, daysElapsed, daysRemaining) : null, fmt, "portal.metas.comb.nr", mesFrase)}
      ${_metaFila(t("metric.sh.label"), shAct, mH, proyOn ? projectFlow(shAct, daysElapsed, daysRemaining) : null, v => fmt(Math.round(v)), "portal.metas.comb.sh", mesFrase)}
    </div>`, "pt-span2");
}
function _metaFila(label, act, meta, proj, fmtFn, numKey, mesFrase) {
  const _k = sfx => dn(numKey, sfx);
  if (meta == null || !meta) return "";
  const p = (act / meta) * 100, pp = proj != null ? (proj / meta) * 100 : null;
  const tone = goalTone(p) || "bad", toneP = goalTone(pp) || tone;
  const w = v => Math.max(0, Math.min(100, v)).toFixed(1);
  const cap = t("portal.meta.caption", { p: `<span class="pp-tone--${tone} pp-goal__pct"${_k("pct")}>${p.toFixed(1)}%</span>`, m: mesFrase, v: `<span${_k("meta")}>${fmtFn(meta)}</span>` });
  const proyTxt = pp != null ? `<span class="pp-goal__proj pp-tone--${toneP}">${t("portal.meta.proy", { v: `<strong${_k("proj")}>${fmtFn(Math.round(proj))}</strong>`, p: `${pp.toFixed(1)}%` })}</span>` : "";
  return `<div class="pp-goal">
      <div class="pp-goal__head"><span class="pp-goal__label">${escapeHTML(label)}</span><span class="pp-goal__nums"><strong${_k("real")}>${fmtFn(act)}</strong></span></div>
      <div class="ui-progress ui-progress--${tone}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.max(0, Math.min(100, p)))}" aria-label="${escapeHTML(label)}">
        ${pp != null && pp > p ? `<div class="ui-progress__proj" style="width:${w(pp)}%"></div>` : ""}<div class="ui-progress__bar" style="width:${w(p)}%"></div></div>
      <div class="pp-goal__caption"><span>${cap}</span>${proyTxt}</div></div>`;
}

// ── Gráficos (ApexCharts, chartTheme) ────────────────────────────────────────
function _merge(a, b) {
  if (Array.isArray(b) || b == null || typeof b !== "object") return b;
  const out = { ...(a && typeof a === "object" && !Array.isArray(a) ? a : {}) };
  Object.keys(b).forEach(k => { out[k] = _merge(out[k], b[k]); });
  return out;
}
const _etiquetaEje = d => (d && d.length === 10) ? d2s(d).slice(0, 5) : d2s(d);
const _fmtEje = v => (v == null || !isFinite(v)) ? "—" : Math.abs(v) >= 10000 ? fmtSmart(v) : fmt(v);
const _pendientes = [];
function _grafico(id, opts) { _pendientes.push([id, opts]); return `<div id="${id}" class="pt-chart"></div>`; }
function _dibujar(id, opts) {
  if (!window.ApexCharts) { ensureApex().then(() => _dibujar(id, opts)); return; }
  const el = document.getElementById(id);
  if (!el) return;
  if (!el.getBoundingClientRect().width && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => { if (!el.isConnected) { ro.disconnect(); return; } if (el.getBoundingClientRect().width) { ro.disconnect(); _dibujar(id, opts); } });
    ro.observe(el); return;
  }
  const prev = STATE.charts && STATE.charts[id];
  if (prev) { try { prev.destroy(); } catch (e) { /* huérfano */ } delete STATE.charts[id]; }
  const ch = new ApexCharts(el, _merge(apexBase(), opts));
  ch.render();
  if (STATE.charts) STATE.charts[id] = ch;
  ChartRegistry.register(id, ch);
}
function _linea(id, nombre, serie, color, fmtY = _fmtEje) {
  return _grafico(id, {
    chart: { type: "area", height: 210, animations: { enabled: false } },
    series: [{ name: nombre, data: serie.values }], colors: [color],
    stroke: { width: 2, curve: "straight" },
    fill: { type: "gradient", gradient: { shadeIntensity: 0, opacityFrom: 0.18, opacityTo: 0.02, stops: [0, 100] } },
    markers: { size: serie.dates.length <= 14 ? 3 : 0, strokeWidth: 0 }, legend: { show: false },
    grid: { padding: { left: 8, right: 20 } },
    xaxis: { categories: serie.dates.map(_etiquetaEje), labels: { rotate: 0, hideOverlappingLabels: true, trim: false } },
    yaxis: { labels: { formatter: fmtY }, forceNiceScale: true }, tooltip: { y: { formatter: fmtY } }
  });
}
function _apiladas(id, rows, subs, fn) {
  const fechas = [...new Set(rows.map(r => r.date))].sort();
  const tk = chartTokens();
  return _grafico(id, {
    chart: { type: "bar", height: 260, stacked: true, animations: { enabled: false } },
    series: subs.map(s => ({ name: s.nombre, data: fechas.map(f => _sum(rows.filter(r => r.date === f && (r.db_id || "") === s.id), fn)) })),
    colors: subs.map((_, i) => seriesColor(i, tk)),
    plotOptions: { bar: { columnWidth: "60%" } }, dataLabels: { enabled: false },
    legend: { show: true, position: "top", horizontalAlign: "left" },
    xaxis: { categories: fechas.map(_etiquetaEje), labels: { rotate: 0, hideOverlappingLabels: true } },
    yaxis: { labels: { formatter: _fmtEje } }, tooltip: { y: { formatter: _fmtEje } }
  });
}

// ── Pestañas ─────────────────────────────────────────────────────────────────
function _subsTotal(rows) { return subflotasDe(rows, STATE).filter(s => s.enTotal); }

// "Lo que cambió": lecturas automáticas, solo con números del partner (y la
// mediana del mercado si ya llegó). Máximo 4.
function _insights(rows, k) {
  const out = [];
  const subs = _subsTotal(rows);
  const p = _porPeriodo(rows);
  if (p.fechas.length >= 3) {
    let peor = null, mejor = null;
    subs.forEach(s => {
      const v = p.fechas.map(f => _sum(p.de(f).filter(r => (r.db_id || "") === s.id), r => r.activeDrivers));
      const n = v.length;
      if (v[n - 3] > 0 && v[n - 1] < v[n - 2] && v[n - 2] < v[n - 3]) {
        const caida = (v[n - 1] - v[n - 3]) / v[n - 3];
        if (!peor || caida < peor.c) peor = { s, c: caida };
      }
      if (v[n - 2] > 0) { const c = (v[n - 1] - v[n - 2]) / v[n - 2]; if (c > 0.02 && (!mejor || c > mejor.c)) mejor = { s, c }; }
    });
    if (peor) out.push(["bad", "trending-down", t("pt.ins.cae", { s: peor.s.nombre, c: _pct(Math.abs(peor.c)) })]);
    if (mejor) out.push(["ok", "trending-up", t("pt.ins.crece", { s: mejor.s.nombre, c: _pct(mejor.c), p: _ultPer() })]);
  }
  if (k.pctReact != null) out.push(["", "users", k.a50 != null ? t("pt.ins.react50", { r: _pct(k.pctReact, 0), a: _pct(k.a50, 0) }) : t("pt.ins.react", { r: _pct(k.pctReact, 0) })]);
  const m = (_mercadoDatos() || {}).retencion;
  if (m && m.tu != null && m.med != null) out.push(["mkt", "target", t("pt.ins.ret", { t: _pct(m.tu), c: _ciudadMercadoTxt(), m: _pct(m.med) })]);
  if (!out.length) return "";
  return _card(escapeHTML(t("pt.ins.titulo")), `<ul class="pt-ins">${out.slice(0, 4).map(([tono, ic, txt]) => `<li class="pt-ins--${tono}">${icon(ic, { size: 16 })}<span>${escapeHTML(txt)}</span></li>`).join("")}</ul>`);
}

function _tabResumen(rows) {
  const k = _kpis(rows);
  const subs = _subsTotal(rows);
  const ult = k.ult;
  const totAd = _sum(rows.filter(r => r.date === ult), r => r.activeDrivers) || 1;
  const comp = subs.map((s, i) => {
    const v = _sum(rows.filter(r => r.date === ult && (r.db_id || "") === s.id), r => r.activeDrivers);
    return `<div class="pt-comp__row"><span><i style="background:${seriesColor(i, chartTokens())}"></i>${escapeHTML(s.nombre)} <small>${escapeHTML(t(_TIPO[s.tipo]))}</small></span>
      <div class="pt-bar"><span style="width:${(v / totAd * 100).toFixed(1)}%;background:${seriesColor(i, chartTokens())}"></span></div><b>${_n(v)}</b><small>${_pct(v / totAd, 0)}</small></div>`;
  }).join("");
  const nrL = k.l.nue + k.l.rea, nrP = k.p ? k.p.nue + k.p.rea : null;
  const hpc = k.l.ad ? k.l.sh / k.l.ad : null, hpcP = k.p && k.p.ad ? k.p.sh / k.p.ad : null;
  return `<div class="pt-grid2">
    ${_portalMetas(rows)}
    ${_card(escapeHTML(t("pt.res.vs", { u: _cap(_ultPer()) })) + ` <span class="pt-chip">${escapeHTML(d2s(ult))}</span>`,
      `<div class="pt-kpis">
        ${_kpi(t("metric.ad.label"), _n(k.l.ad), _delta(k.l.ad, k.p && k.p.ad), "", "", "portal.kpi.comb.ad")}
        ${_kpi(t("metric.nr.label"), _n(nrL), _delta(nrL, nrP), t("pt.res.entraron"), "", "portal.kpi.comb.nr")}
        ${_kpi(t("metric.sh.label"), _n(k.l.sh), _delta(k.l.sh, k.p && k.p.sh), "", "", "portal.kpi.comb.sh")}
        ${_kpi(t("metric.tr.label"), _n(k.l.tr), _delta(k.l.tr, k.p && k.p.tr), "", "", "portal.kpi.comb.tr")}
        ${_kpi(t("pt.k.comision"), _sol(k.l.com), _delta(k.l.com, k.p && k.p.com), t("pt.k.comisionSub"))}
        ${_kpi(t("pt.k.hpc"), _dec(hpc, 1), _delta(hpc, hpcP), t("pt.k.productividad"))}
      </div>
      <p class="pt-mut">${escapeHTML(t("pt.res.enRango", { nr: _n(k.tot.nue + k.tot.rea), h: _n(k.tot.sh), v: _n(k.tot.tr), c: _sol(k.tot.com) }))}</p>`, "pt-span2")}
    ${_insights(rows, k)}
    ${subs.length > 1 ? _card(escapeHTML(t("pt.res.comp")), `<div class="pt-comp">${comp}<button type="button" class="pt-link" data-act="portalTab" data-v="subflotas">${escapeHTML(t("pt.res.verSub"))} →</button></div>`) : ""}
  </div>`;
}

function _tabDesempeno(rows) {
  const k = _kpis(rows);
  const tk = chartTokens();
  const p = _porPeriodo(rows);
  const serieDe = fn => ({ dates: p.fechas, values: p.fechas.map(f => fn(p.de(f))) });
  const sAd = serieDe(rs => _sum(rs, r => r.activeDrivers));
  const sHpc = serieDe(rs => { const a = _sum(rs, r => r.activeDrivers); return a ? +(_sum(rs, r => r.supplyHours) / a).toFixed(2) : null; });
  const sAcc = serieDe(rs => { const v = tasaPonderada(rs.map(r => [r.acceptanceRate, r.trips])); return v == null ? null : +(v * 100).toFixed(2); });
  const sCom = serieDe(rs => _sum(rs, r => r.commission));
  const vph = k.tot.sh ? k.tot.tr / k.tot.sh : null, iph = k.tot.sh ? k.tot.gmv / k.tot.sh : null;
  const hpc = k.l.ad ? k.l.sh / k.l.ad : null, hpcP = k.p && k.p.ad ? k.p.sh / k.p.ad : null;
  const neto = k.p ? k.l.ad - k.p.ad : null;
  // Flota propia: solo si el partner tiene subflotas Fleet con datos.
  const ultRows = rows.filter(r => r.date === k.ult);
  const owned = _sum(ultRows, r => r.ownedFleetActiveCars);
  const flota = owned > 0 ? _card(escapeHTML(t("pt.d.flota")), `<div class="pt-kpis pt-kpis--3">
      ${_kpi(t("portal.autosPropios"), _n(owned), "", _ultPer())}
      ${_kpi(t("pt.k.brandeados"), _n(_sum(ultRows, r => r.ownedFleetBrandedActiveCars)), "", _ultPer())}
      ${_kpi(t("pt.k.horasAuto"), _dec(ratio(_sum(ultRows, r => r.internalFleetSh), owned), 1), "", t("pt.k.horasAutoSub"))}
    </div>`) : "";
  return `<div class="pt-grid2">
    ${_card(escapeHTML(t("pt.d.conductores")), `<div class="pt-kpis pt-kpis--4">
        ${_kpi(t("pt.k.activos"), _n(k.l.ad), _delta(k.l.ad, k.p && k.p.ad), _ultPer() + " " + t("pt.k.delRango"))}
        ${_kpi(t("pt.k.nuevos"), _n(k.l.nue), _delta(k.l.nue, k.p && k.p.nue), t("pt.k.enRango", { v: _n(k.tot.nue) }))}
        ${_kpi(t("pt.k.reactivados"), _n(k.l.rea), _delta(k.l.rea, k.p && k.p.rea), t("pt.k.enRango", { v: _n(k.tot.rea) }), _chipMercado("pct_react"))}
        ${STATE.curMode === "diario" ? "" : _kpi(t("pt.k.seFueron"), _n(k.perdidos), "", k.ret != null ? t("pt.k.retencion", { v: _pct(k.ret) }) : "", _chipMercado("retencion"))}
      </div>${_linea("ptChAd", t("metric.ad.label"), sAd, seriesColor(0, tk))}
      ${neto != null ? `<p class="pt-mut">${escapeHTML(t("pt.d.neto", { n: (neto >= 0 ? "+" : "") + _n(neto), e: _n(k.l.nue + k.l.rea), s: _n(k.perdidos) }))}</p>` : ""}`, "pt-span2")}
    ${_card(escapeHTML(t("pt.d.origen")), `<div class="pt-kpis pt-kpis--3">
        ${_kpi(t("pt.k.propios"), _n(_sum(rows, r => r.newPartner)), "", t("pt.k.propiosSub"))}
        ${_kpi(t("pt.k.yango"), _n(_sum(rows, r => r.newService)), "", t("pt.k.yangoSub"))}
        ${_kpi(t("pt.k.a50"), k.a50 == null ? "—" : _n(_sum(rows, _n50)), "", k.a50 != null ? t("pt.k.a50Sub", { v: _pct(k.a50, 0) }) : "", _chipMercado("a50"))}
      </div>${_grafico("ptChOrigen", {
        chart: { type: "bar", height: 210, stacked: true, animations: { enabled: false } },
        series: [{ name: t("pt.k.propios"), data: p.fechas.map(f => _sum(p.de(f), r => r.newPartner)) },
                 { name: t("pt.k.yango"), data: p.fechas.map(f => _sum(p.de(f), r => r.newService)) }],
        colors: [seriesColor(0, tk), seriesColor(4, tk)], plotOptions: { bar: { columnWidth: "60%" } }, dataLabels: { enabled: false },
        legend: { show: true, position: "top", horizontalAlign: "left" },
        xaxis: { categories: p.fechas.map(_etiquetaEje), labels: { rotate: 0, hideOverlappingLabels: true } },
        yaxis: { labels: { formatter: _fmtEje } }, tooltip: { y: { formatter: _fmtEje } }
      })}`)}
    ${_card(escapeHTML(t("pt.d.productividad")), `<div class="pt-kpis pt-kpis--3">
        ${_kpi(t("pt.k.hpc"), _dec(hpc, 1), _delta(hpc, hpcP), _ultPer(), _chipMercado("hpc"))}
        ${_kpi(t("pt.k.vph"), _dec(vph, 2), "", t("pt.k.enElRango"), _chipMercado("vph"))}
        ${_kpi(t("pt.k.iph"), iph == null ? "—" : "S/ " + iph.toFixed(1), "", t("pt.k.iphSub"), _chipMercado("iph"))}
      </div>${_linea("ptChHpc", t("pt.k.hpc"), sHpc, seriesColor(2, tk), v => _dec(v, 1))}`)}
    ${_card(escapeHTML(t("pt.d.calidad")), `<div class="pt-kpis pt-kpis--4">
        ${_kpi(t("portal.aceptacion"), _pct(k.acc), "", t("pt.k.enElRango"), _chipMercado("aceptacion"))}
        ${_kpi(t("pt.k.completados"), _pct(k.compl), "", t("pt.k.enElRango"), _chipMercado("completados"))}
        ${_kpi(t("pt.k.calificacion"), _dec(k.rating, 2), "", t("pt.k.calificacionSub"))}
        ${_kpi(t("pt.k.soporte"), _pct(k.soporte), "", t("pt.k.soporteSub"), _chipMercado("soporte"))}
      </div>${_linea("ptChAcc", t("portal.aceptacion"), sAcc, seriesColor(1, tk), v => _dec(v, 1) + "%")}`)}
    ${_card(escapeHTML(t("pt.d.ingresos")), `<div class="pt-kpis pt-kpis--3">
        ${_kpi(t("pt.k.gmv"), _sol(k.tot.gmv), "", t("pt.k.enElRango"))}
        ${_kpi(t("pt.k.comision"), _sol(k.tot.com), "", t("pt.k.enElRango"))}
        ${_kpi(t("metric.tr.label"), _n(k.tot.tr), "", t("pt.k.enElRango"))}
      </div>${_linea("ptChCom", t("pt.k.comision"), sCom, seriesColor(3, tk))}`)}
    ${flota}
    ${_tarjetaMercado()}
  </div>`;
}

const _METRICAS_SUB = {
  ad: { l: "metric.ad.label", fn: r => r.activeDrivers, foto: true },
  nr: { l: "metric.nr.label", fn: r => _nuevos(r) + (r.reactivated || 0) },
  sh: { l: "metric.sh.label", fn: r => r.supplyHours },
  tr: { l: "metric.tr.label", fn: r => r.trips },
  com: { l: "pt.k.comision", fn: r => r.commission }
};
function _tabSubflotas() {
  const rg = _rango();
  const todas = _todas().filter(r => _enRango(r, rg) && _ciudadOk(r));
  const subs = subflotasDe(todas, STATE);
  const enTotal = subs.filter(s => s.enTotal);
  const M = _METRICAS_SUB[PORTAL_STATE.metrica] || _METRICAS_SUB.ad;
  const fechas = [...new Set(todas.map(r => r.date))].sort(), ult = fechas[fechas.length - 1], ant = fechas[fechas.length - 2];
  const totUlt = _sum(todas.filter(r => r.date === ult && enTotal.some(s => s.id === (r.db_id || ""))), M.fn) || 1;
  const filas = subs.map(s => {
    const rs = todas.filter(r => (r.db_id || "") === s.id);
    const L = rs.filter(r => r.date === ult), P = rs.filter(r => r.date === ant);
    const ad = _sum(L, r => r.activeDrivers), adP = _sum(P, r => r.activeDrivers);
    const sh = _sum(rs, r => r.supplyHours);
    return `<tr class="${s.enTotal ? "" : "is-fuera"}">
      <td><b>${escapeHTML(s.nombre)}</b><small>${escapeHTML(cityLabel(s.ciudad))} · ${escapeHTML(t(_TIPO[s.tipo]))}</small></td>
      <td class="ui-num">${_n(ad)} ${_delta(ad, P.length ? adP : null)}</td>
      <td class="ui-num">${_n(_sum(rs, r => _nuevos(r) + (r.reactivated || 0)))}</td>
      <td class="ui-num">${_n(sh)}</td>
      <td class="ui-num">${_dec(ratio(_sum(L, r => r.supplyHours), ad), 1)}</td>
      <td class="ui-num">${_n(_sum(rs, r => r.trips))}</td>
      <td class="ui-num">${_sol(_sum(rs, r => r.commission))}</td>
      <td class="ui-num">${s.enTotal ? _pct(_sum(L, M.fn) / totUlt, 0) : "—"}</td>
      <td><button type="button" class="pt-link" data-act="portalVerSub" data-v="${escapeHTML(s.id)}">${escapeHTML(t("pt.sub.ver"))} →</button></td></tr>`;
  }).join("");
  const botones = Object.entries(_METRICAS_SUB).map(([k, m]) => `<button type="button" class="ui-segmented__btn" aria-pressed="${PORTAL_STATE.metrica === k}" data-act="portalMetrica" data-v="${k}">${escapeHTML(t(m.l))}</button>`).join("");
  return `${_card(escapeHTML(t("pt.sub.comp", { m: t(M.l) })), `<div class="ui-segmented">${botones}</div>${enTotal.length ? _apiladas("ptChSub", todas, enTotal, M.fn) : ""}`)}
    ${_card(escapeHTML(t("pt.sub.detalle", { r: _rangoTxt() })), `<div class="ui-table-wrap"><table class="ui-table pt-tbl"><thead><tr>
      <th>${escapeHTML(t("pt.sub.th.subflota"))}</th><th class="ui-num">${escapeHTML(t("pt.sub.th.activos", { u: _ultPer() }))}</th><th class="ui-num">${escapeHTML(t("metric.nr.label"))}</th>
      <th class="ui-num">${escapeHTML(t("metric.sh.label"))}</th><th class="ui-num">${escapeHTML(t("pt.k.hpc"))}</th><th class="ui-num">${escapeHTML(t("metric.tr.label"))}</th>
      <th class="ui-num">${escapeHTML(t("pt.k.comision"))}</th><th class="ui-num">${escapeHTML(t("pt.sub.th.pct"))}</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>
      <p class="pt-mut">${escapeHTML(t("pt.sub.nota", { u: _ultPer() }))}</p>`)}`;
}

// ── Mis datos ────────────────────────────────────────────────────────────────
// Columnas exportables, en grupos. Nunca columnas internas: la base ya no se las
// entrega (lecturaPartner.ts) y acá tampoco se arman (KAM, marcas de clasificación).
const _pct100 = v => v == null ? "" : Math.round(v * 10000) / 100;
const _GRUPOS = {
  base: ["pt.g.base", [["pt.c.periodo", r => r.date], ["pt.c.ciudad", r => cityLabel(r.city)], ["pt.c.subflota", r => _nombreSub(r)], ["pt.c.tipo", r => t(_TIPO[tipoSubflota(r.db_id, STATE)])],
    ["pt.c.activos", r => r.activeDrivers], ["pt.c.horas", r => r.supplyHours], ["pt.c.viajes", r => r.trips]]],
  adq: ["pt.g.adq", [["pt.c.nuevosTuyos", r => r.newPartner], ["pt.c.nuevosYango", r => r.newService], ["pt.c.reactivados", r => r.reactivated], ["pt.c.a50", r => _n50(r)]]],
  cal: ["pt.g.cal", [["pt.c.aceptacion", r => _pct100(r.acceptanceRate)], ["pt.c.completados", r => _pct100(r.completionRate)], ["pt.c.calificacion", r => r.avgDriverRating],
    ["pt.c.malCalificados", r => _pct100(r.badRatedTripsShare)], ["pt.c.soporte", r => _pct100(r.driverSupportRequestsShare)]]],
  ing: ["pt.g.ing", [["pt.c.gmv", r => r.gmv], ["pt.c.comision", r => r.commission], ["pt.c.ingresoHora", r => r.moneyPerHour], ["pt.c.tarifa", r => r.avgFareAfterSurge]]],
  flo: ["pt.g.flo", [["pt.c.autosActivos", r => r.activeCars], ["pt.c.brandeados", r => r.brandedActiveCars], ["pt.c.autosPropios", r => r.ownedFleetActiveCars], ["pt.c.horasInternas", r => r.internalFleetSh]]]
};
const _nombreSub = r => (STATE.FLEETROOM_NAME || {})[r.db_id] || r.fleetroom || r.db_id || "—";
function _filasDatos() {
  const rg = _rango(), sub = PORTAL_STATE.sub;
  return _todas().filter(r => _enRango(r, rg) && _ciudadOk(r) && (sub === "todas" || (r.db_id || "") === sub))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.city || "").localeCompare(b.city || "") || _nombreSub(a).localeCompare(_nombreSub(b))));
}
const _columnas = () => Object.keys(_GRUPOS).filter(g => PORTAL_STATE.cols.has(g)).flatMap(g => _GRUPOS[g][1]);
function _tabDatos() {
  const filas = _filasDatos(), cols = _columnas();
  const vista = filas.slice(-8).reverse();
  const celda = v => v == null || v === "" ? "—" : typeof v === "number" ? fmt(v) : escapeHTML(String(v));
  const chips = Object.entries(_GRUPOS).map(([g, [l]]) => `<label class="pt-ck"><input type="checkbox" data-act-change="portalCol" data-v="${g}"${PORTAL_STATE.cols.has(g) ? " checked" : ""}> ${escapeHTML(t(l))}</label>`).join("");
  return _card(escapeHTML(t("pt.dat.titulo")), `<p class="pt-mut">${escapeHTML(t("pt.dat.sub", { p: _per() }))}</p>
    <div class="pt-dl"><div><span class="pt-lbl">${escapeHTML(t("pt.dat.columnas"))}</span><div class="pt-chips">${chips}</div></div>
      <div class="pt-dl__btns">
        <button type="button" class="ui-btn ui-btn--secondary ui-btn--sm" data-act="portalDescargar" data-v="csv"${filas.length && cols.length ? "" : " disabled"}>${icon("download", { size: 14 })}<span>CSV</span></button>
        <button type="button" class="ui-btn ui-btn--primary ui-btn--sm" id="ptXlsxBtn" data-act="portalDescargar" data-v="xlsx"${filas.length && cols.length ? "" : " disabled"}>${icon("download", { size: 14 })}<span>${escapeHTML(t("pt.dat.excel", { n: fmt(filas.length), r: _rangoTxt() }))}</span></button>
      </div></div>
    ${cols.length ? `<div class="ui-table-wrap"><table class="ui-table pt-tbl"><thead><tr>${cols.map(([l]) => `<th>${escapeHTML(t(l))}</th>`).join("")}</tr></thead>
      <tbody>${vista.map(r => `<tr>${cols.map(([, fn]) => `<td>${celda(fn(r))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}
    <p class="pt-mut">${escapeHTML(t("pt.dat.nota"))}</p>`);
}
export async function portalDescargar(formato) {
  const filas = _filasDatos(), cols = _columnas();
  if (!filas.length || !cols.length) return;
  logAccess("download_csv", "portal");
  const enc = cols.map(([l]) => t(l));
  const valores = filas.map(r => cols.map(([, fn]) => { const v = fn(r); return v == null ? "" : v; }));
  const nombre = `MisDatos_${STATE.curMode}_${_rango().from}_${_rango().to}`;
  if (formato === "xlsx") {
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet([enc, ...valores]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Datos");
      XLSX.writeFile(wb, nombre + ".xlsx");
      return;
    } catch (e) { if (DEBUG) console.error(e); }
  }
  // CSV con BOM (Excel lo abre con tildes) y celdas protegidas contra fórmulas.
  const csv = "﻿" + [filaCSV(enc), ...valores.map(filaCSV)].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = nombre + ".csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── Barra de filtros (escala + rango + atajos + ciudad + subflota) ───────────
// Maneja los MISMOS controles del panel lateral (#dateFrom/#dateTo, switchMode),
// así el rango se guarda y se restaura igual que en el resto de la app.
const _ATAJOS = { diario: [7, 14, 28], semanal: [1, 4, 8, 0], mensual: [1, 3, 6, 0] };
function _rangoTxt() { const rg = _rango(); return rg.from === rg.to ? d2s(rg.to) : `${d2s(rg.from)} – ${d2s(rg.to)}`; }
function _filtros() {
  const all = STATE.allDates || [], rg = _rango();
  const opt = (sel, min) => all.map(d => `<option value="${escapeHTML(d)}"${d === sel ? " selected" : ""}${min && d < min ? " disabled" : ""}>${escapeHTML(d2s(d))}</option>`).join("");
  const n = all.indexOf(rg.to) - all.indexOf(rg.from) + 1, alFinal = rg.to === all[all.length - 1];
  const atajos = (_ATAJOS[STATE.curMode] || []).map(k => {
    const on = alFinal && (k === 0 ? rg.from === all[0] : n === k);
    const l = k === 0 ? t("pt.at.todo") : k === 1 && STATE.curMode === "semanal" ? t("pt.at.ultSemana") : k === 1 && STATE.curMode === "mensual" ? t("pt.at.ultMes") : t(_AT[STATE.curMode], { n: k });
    return `<button type="button" class="pt-atajo${on ? " is-on" : ""}" data-act="portalAtajo" data-v="${k}">${escapeHTML(l)}</button>`;
  }).join("");
  const comb = datasetLinea(STATE, "comb");
  const ciudades = [...new Set(comb.map(r => r.city).filter(Boolean))].sort();
  const subs = subflotasDe(_todas(), STATE);
  return `<div class="pt-filtros" data-html2canvas-ignore="true">
    <div class="ui-segmented" role="group" aria-label="${escapeHTML(t("pt.f.escala"))}">${["diario", "semanal", "mensual"].map(m => `<button type="button" class="ui-segmented__btn" aria-pressed="${STATE.curMode === m}" data-act="switchMode" data-mode="${m}">${escapeHTML(t("mode." + m))}</button>`).join("")}</div>
    <label class="pt-fecha"><span>${escapeHTML(t("pt.f.desde"))}</span><select class="ui-select ui-select--sm" data-act-change="portalDesde">${opt(rg.from)}</select></label>
    <label class="pt-fecha"><span>${escapeHTML(t("pt.f.hasta"))}</span><select class="ui-select ui-select--sm" data-act-change="portalHasta">${opt(rg.to, rg.from)}</select></label>
    <div class="pt-atajos">${atajos}</div>
    ${ciudades.length > 1 ? `<select class="ui-select ui-select--sm" data-act-change="portalSetCity" aria-label="${escapeHTML(t("sidebar.ciudad"))}"><option value="all">${escapeHTML(t("pt.f.todasCiudades"))}</option>${ciudades.map(c => `<option value="${escapeHTML(c)}"${PORTAL_STATE.city === c ? " selected" : ""}>${escapeHTML(cityLabel(c))}</option>`).join("")}</select>` : ""}
    ${subs.length > 1 ? `<select class="ui-select ui-select--sm" data-act-change="portalSetSub" aria-label="${escapeHTML(t("pt.f.subflota"))}"><option value="todas">${escapeHTML(t("pt.f.todasSub"))}</option>${subs.map(s => `<option value="${escapeHTML(s.id)}"${PORTAL_STATE.sub === s.id ? " selected" : ""}>${escapeHTML(s.nombre)}${s.enTotal ? "" : " · " + escapeHTML(t("pt.f.fueraTotal"))}</option>`).join("")}</select>` : ""}
    ${PORTAL_STATE.tab === "datos" ? "" : `<button type="button" class="ui-btn ui-btn--secondary ui-btn--sm pt-pdf" id="portalPdfBtn" data-act="portalDownloadPDF">${icon("download", { size: 14 })}<span>${escapeHTML(t("portal.descargarPDF"))}</span></button>`}
  </div>`;
}
function _ponerRango(from, to) {
  const f = document.getElementById("dateFrom"), h = document.getElementById("dateTo");
  if (!f || !h) return;
  if (from != null) f.value = from;
  if (to != null) h.value = to;
  if (f.value > h.value) h.value = f.value;
  window.applyFilters();
}

// ── Encabezado (entra al PDF) ────────────────────────────────────────────────
function _portalLogo(nombre) {
  const url = (STATE.partnerLogos || {})[nombre];
  if (url) return `<img class="pp-hero__logo" src="${escapeHTML(url)}" alt="">`;
  const ini = String(nombre || "").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase();
  return `<div class="pp-hero__logo pp-hero__logo--mono" aria-hidden="true">${escapeHTML(ini)}</div>`;
}
let _logosPedidos = false;
function _pedirLogos(nombre) {
  if (_logosPedidos || STATE._logosCargados) return;
  _logosPedidos = true;
  ensurePartnerLogos().then(() => { if (STATE.curTab === "portal" && (STATE.partnerLogos || {})[nombre]) renderPartnerPortal(); }).catch(() => { /* monograma */ });
}
// Columnas diferidas (aceptación, calidad, flota, nuevos a 50 viajes): el portal
// las pide él mismo y se repinta cuando llegan.
//
// Antes se marcaba un booleano "ya pedidas" por escala, para siempre. Pero cada
// recarga de filas (ampliar el "Desde", datos frescos tras pintar del caché)
// trae filas SIN esas columnas y resetea el pedido (resetFullRendColumns): con
// la marca puesta no se volvían a pedir y esas métricas quedaban en "—" el resto
// de la sesión, también en el CSV/Excel de "Mis datos" (3-oct-2026). Ahora se
// recuerda la PROMESA vigente: si ensureFullRendColumns devuelve otra, es un
// pedido nuevo y se repinta cuando llega.
const _ultimaCols = {};
const _PENDIENTE = {};
function _pedirColumnas() {
  const mode = STATE.curMode || "semanal";
  const p = ensureFullRendColumns();
  if (!p || p === _ultimaCols[mode]) return;
  _ultimaCols[mode] = p;
  Promise.race([p, Promise.resolve(_PENDIENTE)]).then(v => {
    if (v !== _PENDIENTE) return;   // ya estaban: no hace falta repintar
    p.then(() => { if (STATE.curTab === "portal" && STATE.curMode === mode) renderPartnerPortal(); });
  }).catch(() => { if (_ultimaCols[mode] === p) _ultimaCols[mode] = null; });
}

// ── RENDER ───────────────────────────────────────────────────────────────────
const _TABS = [["resumen", "activity"], ["desempeno", "chart-line"], ["subflotas", "users"], ["datos", "table"]];
export function renderPartnerPortal() {
  const box = document.getElementById("portalContent");
  if (!box) return;
  // B12: no pintar números de otra escala bajo el rótulo de la elegida.
  if (!escalaLista(STATE)) {
    const esc = STATE.curMode === "mensual" ? "datos.cargandoMensual" : STATE.curMode === "diario" ? "datos.cargandoDiario" : "datos.cargandoSemanal";
    box.innerHTML = `<div class="pp">${emptyState({ title: t(esc), icon: "clock" })}</div>`;
    reintentarCuandoEscalaLista("portal", STATE, renderPartnerPortal, () => STATE.curTab === "portal");
    return;
  }
  _pedirColumnas();
  // Una subflota elegida que ya no existe en esta escala/rango vuelve al total.
  if (PORTAL_STATE.sub !== "todas" && !_todas().some(r => (r.db_id || "") === PORTAL_STATE.sub)) PORTAL_STATE.sub = "todas";

  const rows = _filas();
  const misPartners = [...new Set(datasetLinea(STATE, "comb").map(r => r.partner))].filter(Boolean).sort();
  const titulo = misPartners.length > 3
    ? misPartners.slice(0, 3).map(escapeHTML).join(" · ") + ` <span class="pp-hero__more">${t("portal.yMas", { n: misPartners.length - 3 })}</span>`
    : (misPartners.map(escapeHTML).join(" · ") || escapeHTML(t("portal.tuOperacion")));
  _pedirLogos(misPartners[0]);
  const ultimo = (STATE.allDates || []).slice(-1)[0] || "";

  const tabs = `<nav class="pt-tabs" role="tablist" data-html2canvas-ignore="true">${_TABS.map(([k, ic]) =>
    `<button type="button" role="tab" aria-selected="${PORTAL_STATE.tab === k}" class="pt-tab${PORTAL_STATE.tab === k ? " is-on" : ""}" data-act="portalTab" data-v="${k}">${icon(ic, { size: 15 })}<span>${escapeHTML(t(_TAB[k]))}</span></button>`).join("")}</nav>`;
  const hero = `<header class="pp-hero ui-card">
      ${_portalLogo(misPartners[0])}
      <div class="pp-hero__text"><h2 class="pp-hero__name">${titulo}</h2>
        <p class="pp-hero__meta">${escapeHTML(t("mode." + STATE.curMode))} · ${escapeHTML(_rangoTxt())}${PORTAL_STATE.city === "all" ? "" : " · " + escapeHTML(cityLabel(PORTAL_STATE.city))}${PORTAL_STATE.sub === "todas" ? "" : " · " + escapeHTML(_nombreSub({ db_id: PORTAL_STATE.sub }))}</p></div>
      <div class="pp-hero__date"><span class="pp-hero__date-lbl">${escapeHTML(t("portal.hero.datosAl"))}</span><strong>${escapeHTML(d2s(ultimo))}</strong></div>
      <span class="pt-lock" data-html2canvas-ignore="true">${icon("lock", { size: 13 })}${escapeHTML(t("pt.lock"))}</span>
    </header>`;

  let cuerpo;
  _pendientes.length = 0;
  if (PORTAL_STATE.tab === "datos") cuerpo = _tabDatos();
  else if (PORTAL_STATE.tab === "subflotas") cuerpo = _tabSubflotas();
  else if (!rows.length) cuerpo = emptyState({ title: t("portal.sinDatos"), text: t("portal.sinDatosSub"), icon: "calendar" });
  else cuerpo = PORTAL_STATE.tab === "desempeno" ? _tabDesempeno(rows) : _tabResumen(rows);

  box.innerHTML = `<div class="pp pt">${hero}${tabs}${_filtros()}${cuerpo}</div>`;
  const dib = _pendientes.splice(0);
  dib.forEach(([id, opts]) => { try { _dibujar(id, opts); } catch (_) { /* el gráfico es accesorio */ } });
}

export function portalSetCity(city) { PORTAL_STATE.city = city; renderPartnerPortal(); }

// Export PDF de la pestaña visible. Sellado con el email de la sesión + fecha.
export async function portalDownloadPDF() {
  logAccess("download_pdf", "portal");
  const content = document.getElementById("portalContent");
  if (!content) return;
  const btn = document.getElementById("portalPdfBtn");
  const lbl = btn && btn.querySelector("span");
  if (btn) { if (lbl) lbl.textContent = t("metas.generandoPDF"); btn.disabled = true; }
  try {
    await ensurePdfLibs();
    const bg = tokenClaro("--color-bg", "#f3f4f6");
    const canvas = await html2canvas(content, opcionesCapturaClara({ scale: 2, useCORS: true, logging: false, backgroundColor: bg }));
    const { jsPDF } = window.jspdf;
    // La página va en px CSS (no en px del canvas, que con scale:2 es el doble),
    // con `px_scaling` como Presentación y la orientación de la captura. Antes:
    // una captura más ancha que alta salía cortada (jsPDF la ponía vertical) y
    // una larga (celular, Mis datos) perdía el final en silencio, porque jsPDF
    // limita la página a 14.400 pt. Si aun así no entra, se achica entera.
    const MAX_PX = 19000;   // 14.400 pt ÷ 0,75 pt/px, con margen
    const f = Math.min(1, MAX_PX / Math.max(canvas.width / 2, canvas.height / 2));
    const w = Math.round(canvas.width / 2 * f), h = Math.round(canvas.height / 2 * f);
    const pdf = new jsPDF({ orientation: w > h ? "landscape" : "portrait", unit: "px", format: [w, h], hotfixes: ["px_scaling"] });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, w, h);
    stampPDF(pdf, t("portal.pdfTitulo"));
    pdf.save(`MiDesempeno_${fechaLocalISO()}.pdf`);
  } catch (err) {
    if (DEBUG) console.error(err);
    await alertDialog({ title: t("portal.errPDFTitulo"), body: t("portal.errPDF"), tone: "bad" });
  } finally {
    if (btn) { if (lbl) lbl.textContent = t("portal.descargarPDF"); btn.disabled = false; }
  }
}

registerActions({
  portalTab:       d => { PORTAL_STATE.tab = d.v; renderPartnerPortal(); },
  portalSetCity:   (d, el) => portalSetCity(el.value),
  portalSetSub:    (d, el) => { PORTAL_STATE.sub = el.value; renderPartnerPortal(); },
  portalVerSub:    d => { PORTAL_STATE.sub = d.v; PORTAL_STATE.tab = "desempeno"; renderPartnerPortal(); },
  portalMetrica:   d => { PORTAL_STATE.metrica = d.v; renderPartnerPortal(); },
  portalMercado:   d => { PORTAL_STATE.mercado = d.v; renderPartnerPortal(); },
  portalCol:       (d, el) => { if (el.checked) PORTAL_STATE.cols.add(d.v); else PORTAL_STATE.cols.delete(d.v); renderPartnerPortal(); },
  portalDesde:     (d, el) => _ponerRango(el.value, null),
  portalHasta:     (d, el) => _ponerRango(null, el.value),
  portalAtajo:     d => {
    const all = STATE.allDates || [], k = +d.v;
    if (!all.length) return;
    _ponerRango(k === 0 ? all[0] : all[Math.max(0, all.length - k)], all[all.length - 1]);
  },
  portalDescargar: d => portalDescargar(d.v),
  portalDownloadPDF
});
