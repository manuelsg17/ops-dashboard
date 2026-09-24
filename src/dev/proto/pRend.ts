// dev/proto/pRend.ts — Rendimiento en las 4 versiones del prototipo.

import { escapeHTML as e } from "../../core/security";
import { fmt, fmtSmart, hashColor } from "../../core/format";
import { iconSvg } from "../../shared/icons";
import { segmented, badge } from "../../shared/ui";
import { buildLineChart } from "../../charts";
import { chartTokens, seriesColor } from "../../shared/chartTheme";
import { PS } from "./state";
import { modeloRend, captionAvance, cityLabel, d2s, mesNombre, CIUDADES, KAMS, fmtK$, pct1, varPct, type ModeloRend, type Kpi } from "./model";
import { dl, dot, catVar, sec, kpi, chartCard, ring, spark, bar, n0 } from "./bits";

const LBL: Record<Kpi, string> = { ad: "Conductores Activos", nr: "Nuevos + Reactivados", sh: "Horas de Conexión", tr: "Viajes" };
const CORTO: Record<Kpi, string> = { ad: "Cond. Activos", nr: "N+R", sh: "Hs. Conexión", tr: "Viajes" };
const LINEAS = [
  { value: "comb", label: "Combinado", icon: "activity" as const }, { value: "agg", label: "Agregador", icon: "taxi" as const },
  { value: "fleet", label: "Fleet", icon: "car" as const }, { value: "tk", label: "TukTuk", icon: "tuktuk" as const }
];
const fk = (k: Kpi, v: number) => k === "tr" ? fmtSmart(v) : fmt(v);
const cityIdx = (c: string) => CIUDADES.indexOf(c);
const kamIdx = (k: string) => KAMS.indexOf(k);

let M: ModeloRend;

function goal(k: "ad" | "nr" | "sh") {
  const a = M.av[k];
  return { pct: a && a.meta ? a.pct : null, projPct: a && a.meta ? a.projPct : null, caption: captionAvance(k, a) };
}
function valor(k: Kpi) { return k === "ad" ? fmt(M.k.ad.v) : fmt(Math.round(M.k[k].v)); }
function nota() {
  const a = M.av.ad;
  return a ? `Avance igual al de Metas: solo cuenta ${mesNombre(a.ym, false)} (${a.nPer} de ${a.nTot} períodos en el rango). La meta es mensual: en esta escala el % es orientativo.` : "";
}
const lineToggle = () => segmented({ ariaLabel: "Línea de negocio", act: "prRendLine", value: PS.rendLine, options: LINEAS });

// ── Tablas reutilizadas (marcado real) ──────────────────────────────────────
function tablaCiudad(cls = "ui-table-wrap rd-tabla-compacta"): string {
  const cols: [Kpi, string, string][] = [["ad", "ad", "pad"], ["nr", "nr", "pnr"], ["sh", "sh", "psh"], ["tr", "tr", "ptr"]];
  return `<div class="${cls}"><table class="ui-table rd-table"><thead><tr><th scope="col">Ciudad</th>${cols.map(([k]) =>
    `<th scope="col" class="ui-num">${LBL[k]}</th><th scope="col" class="rd-dcol"><span class="ui-sr-only">Variación</span>Δ</th>`).join("")}</tr></thead><tbody>` +
    M.ciudades.map(c => `<tr><th scope="row" class="rd-rowhead">${dot(catVar(cityIdx(c.city)))}${cityLabel(c.city)}</th>` +
      cols.map(([k, a, p]) => `<td class="ui-num">${k === "tr" ? fmtSmart(c[a]) : fmt(Math.round(c[a]))}</td><td class="rd-dcol">${dl(c[a], c[p])}</td>`).join("") + `</tr>`).join("") +
    `</tbody></table></div>`;
}
function movers(tipo: "suben" | "bajan", cardCls = "ui-card rd-mov"): string {
  const it = tipo === "suben" ? M.suben : M.bajan;
  return `<div class="${cardCls}"><div class="rd-mov__head rd-mov__head--${tipo === "suben" ? "good" : "bad"}">${iconSvg(tipo === "suben" ? "trending-up" : "trending-down", { size: 16 })}<span>${tipo === "suben" ? "Los que más subieron" : "Los que más cayeron"}</span></div>
    <ul class="rd-mov__list">${it.map(m => `<li class="rd-mov__row"><span class="rd-mov__name">${dot(hashColor(m.partner))}<span>${e(m.partner)}</span></span>` +
      `<span class="rd-mov__abs rd-mov__abs--${m.delta > 0 ? "good" : "bad"}">${m.delta > 0 ? "+" : "−"}${fmt(Math.abs(m.delta))}</span><span class="rd-mov__pct">${m.pct > 0 ? "+" : ""}${m.pct.toFixed(1)}%</span></li>`).join("") || `<li class="rd-mov__vacio">Sin movimientos</li>`}</ul></div>`;
}
function tablaKam(cls = "ui-table-wrap rd-tabla-compacta"): string {
  const vd = (c: number, p: number, k: Kpi) => `<span class="rd-vd">${fk(k, Math.round(c))}<span class="rd-vd__d">${dl(c, p)}</span></span>`;
  return `<div class="${cls}"><table class="ui-table rd-table rd-table--kam"><thead>
    <tr class="rd-thgroup"><th></th><th colspan="4">última semana</th><th colspan="3" class="rd-thgroup--acum">Acumulado del rango</th></tr>
    <tr><th scope="col">KAM</th><th class="ui-num">Cond. Activos</th><th class="ui-num">Nuevos+React</th><th class="ui-num">Hs. Conexión</th><th class="ui-num">Viajes</th>
      <th class="ui-num rd-acum">Nuevos+React</th><th class="ui-num">Hs. Conexión</th><th class="ui-num">Viajes</th></tr></thead><tbody>` +
    M.kams.map(k => `<tr><th scope="row" class="rd-rowhead">${dot(catVar(kamIdx(k.kam)))}${e(k.kam)}</th>
      <td class="ui-num">${vd(k.ad, k.pad, "ad")}</td><td class="ui-num">${vd(k.nr, k.pnr, "nr")}</td><td class="ui-num">${vd(k.sh, k.psh, "sh")}</td><td class="ui-num">${vd(k.tr, k.ptr, "tr")}</td>
      <td class="ui-num rd-acum">${fmt(k.gnr)}</td><td class="ui-num">${fmt(Math.round(k.gsh))}</td><td class="ui-num">${fmt(k.gtr)}</td></tr>`).join("") + `</tbody></table></div>`;
}
const SORT_COLS: [string, string, boolean][] = [["partner", "Partner", false], ["kam", "KAM", false], ["ad", "AD", true], ["nr", "N+R", true], ["sh", "SH", true], ["tr", "Viajes", true], ["co", "Comisión", true], ["ns", "Leads Yango", true]];
function partnersOrdenados() {
  const { col, dir } = PS.sort, s = dir === "asc" ? 1 : -1;
  return M.partners.slice().sort((a, b) => (typeof a[col] === "string" ? a[col].localeCompare(b[col]) : a[col] - b[col]) * s);
}
function trend(serie: number[]) {
  const v = serie.slice(-3); const up = v[v.length - 1] > v[0] * 1.02, down = v[v.length - 1] < v[0] * 0.98;
  return `<span class="rd-trend rd-trend--${up ? "up" : down ? "down" : "flat"}">${iconSvg(up ? "trending-up" : down ? "trending-down" : "minus", { size: 14 })}</span>`;
}
function tablaPartners(wrap = "ui-table-wrap ui-table-wrap--scroll rd-tabla-wrap", tcls = "ui-table ui-table--sticky-first rd-table rd-table--partners"): string {
  const th = SORT_COLS.map(([k, l, num]) => {
    const on = PS.sort.col === k, cls = on ? (PS.sort.dir === "asc" ? " sa" : " sd") : "";
    return `<th scope="col" class="rd-sortable${num ? " ui-num" : ""}${cls}" aria-sort="${on ? (PS.sort.dir === "asc" ? "ascending" : "descending") : "none"}" data-act="prSort" data-col="${k}" tabindex="0"><span class="rd-th">${l}${iconSvg("chevron-down", { size: 12, className: "rd-sort-ico" })}</span></th>`;
  }).join("");
  const rows = partnersOrdenados().map(r => `<tr><th scope="row" class="rd-rowhead">${dot(hashColor(r.partner))}<span>${e(r.partner)}</span></th>
    <td class="rd-kamcell">${dot(catVar(kamIdx(r.kam)))}${e(r.kam)}</td><td class="ui-num">${fmt(r.ad)}</td><td class="ui-num">${fmt(r.nr)}</td>
    <td class="ui-num">${fmt(Math.round(r.sh))}</td><td class="ui-num">${fmtSmart(r.tr)}</td><td class="ui-num">${fmtK$(r.co)}</td>
    <td class="ui-num">${r.ns > 0 ? `<span class="ui-badge ui-badge--info rd-leads-badge">★ ${fmt(r.ns)}</span>` : `<span class="rd-muted">0</span>`}</td>
    <td class="rd-dcol">${dl(r.ad, r.pad)}</td><td class="rd-center">${trend(r.serie)}</td></tr>`).join("");
  return `<div class="${wrap}"><table class="${tcls}"><thead><tr>${th}<th class="rd-dcol">Variación</th><th class="rd-center">Tendencia</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
const ciudadToggle = () => `<div class="rd-sec__right">${segmented({ ariaLabel: "Modo de la comparativa", act: "prCiudadModo", value: PS.ciudadModo, options: [{ value: "indice", label: "Índice (base 100)" }, { value: "valores", label: "Valores" }] })}</div>`;
const ciudadNota = () => PS.ciudadModo === "indice"
  ? `Índice: el primer período del rango (${d2s(M.ws[0])}) = 100 en cada ciudad. Compara ritmos de crecimiento entre ciudades de distinto tamaño.`
  : "Valores absolutos: Lima es varias veces más grande que las demás ciudades.";
const leads = () => { const n = M.partners.filter(p => p.ns > 0).length; return n ? `<div class="rd-leads">${badge(`${n} partners reciben leads de Yango`, "info", { icon: "star" })}</div>` : ""; };

// ── Fleet (vista propia, como en la app) ────────────────────────────────────
function fleetKpis(cls = "rd-kpis"): string {
  const L = M.fleetL, P = M.fleetP;
  return `<div class="${cls}">
    ${kpi({ label: "Autos propios activos", value: fmt(L.oc), cur: L.oc, prev: P.oc, sub: "última semana" })}
    ${kpi({ label: "SH por auto (flota interna)", value: L.shCar == null ? "—" : fmt(L.shCar), cur: L.shCar, prev: P.shCar, sub: "horas por auto propio", goal: { pct: L.shCar ? L.shCar / 60 * 100 : null, caption: `Meta de septiembre: 60 h por auto · ${pct1(L.shCar ? L.shCar / 60 * 100 : null)}` } })}
    ${kpi({ label: "Aceptación", value: pct1(L.acc), cur: L.acc, prev: P.acc, sub: "ponderada por viajes", goal: { pct: L.acc ? L.acc / 65 * 100 : null, caption: `Meta de septiembre: 65% · ${pct1(L.acc ? L.acc / 65 * 100 : null)}` } })}
    ${kpi({ label: "Autos brandeados", value: fmt(L.br), cur: L.br, prev: P.br, sub: "última semana", goal: { pct: null, caption: "Sin meta mensual" } })}
  </div>`;
}

// ── ELEGIDA: el marcado de la app (rendimiento.ts) ─────────────────────────
function elegida(): string {
  const per = `última semana`;
  let h = `<div class="rd-view"><div class="rd-toolbar">${lineToggle()}</div>`;
  if (PS.rendLine === "fleet") {
    h += sec("Resumen de la flota", `Solo KPIs propios de la sub-flota · última semana (${d2s(M.L)})`) + fleetKpis();
    h += sec("Tendencias de la flota", "Autos propios y horas por auto, por semana") +
      `<div class="rd-grid-2">${chartCard("prCh_foc", "Autos propios activos")}${chartCard("prCh_fsh", "SH por auto")}</div>`;
    return h + `</div>`;
  }
  h += sec("Resumen del período", `Conductores activos: ${per} (${d2s(M.L)}) · N+R, horas y viajes: acumulado del rango`);
  h += `<div class="rd-kpis">
    ${kpi({ label: LBL.ad, value: valor("ad"), cur: M.k.ad.c, prev: M.k.ad.p, sub: per, goal: goal("ad") })}
    ${kpi({ label: LBL.nr, value: valor("nr"), cur: M.k.nr.c, prev: M.k.nr.p, sub: "acumulado rango", goal: goal("nr") })}
    ${kpi({ label: LBL.sh, value: valor("sh"), cur: M.k.sh.c, prev: M.k.sh.p, sub: "acumulado rango", goal: goal("sh") })}
    ${kpi({ label: LBL.tr, value: valor("tr"), cur: M.k.tr.c, prev: M.k.tr.p, sub: "acumulado rango", goal: { pct: null, caption: "Sin meta mensual" } })}
  </div>`;
  h += `<p class="rd-note">${iconSvg("info", { size: 14 })}<span>${e(nota())}</span></p>`;
  h += sec("Por Ciudad", `${per} vs el período anterior, ordenado por conductores activos`) + tablaCiudad();
  h += sec("Quién se movió", `Mayores variaciones de Conductores Activos vs ${d2s(M.P)}`) + `<div class="rd-grid-2">${movers("suben")}${movers("bajan")}</div>`;
  h += sec("Por KAM", `${per} con variación, y acumulado del rango · ordenado por conductores activos`) + tablaKam();
  h += sec("Productividad", `Rendimiento por conductor y por hora · ${d2s(M.L)} vs período anterior`) + `<div class="rd-kpis rd-kpis--3">
    ${kpi({ label: "Horas por conductor", value: fmt(M.prodL.shAd), cur: M.prodL.shAd, prev: M.prodP.shAd, sub: "snapshot último período" })}
    ${kpi({ label: "Viajes por conductor", value: fmt(M.prodL.trAd), cur: M.prodL.trAd, prev: M.prodP.trAd, sub: "snapshot último período" })}
    ${kpi({ label: "Viajes por hora", value: M.prodL.trSh.toFixed(2), cur: M.prodL.trSh, prev: M.prodP.trSh, sub: "snapshot último período" })}</div>`;
  h += sec("Tendencias", "Top 8 partners por conductores activos del último período") + `<div class="rd-grid-2">
    ${chartCard("prCh_ad", "Conductores Activos", M.restoPie("ad"))}${chartCard("prCh_nr", "Nuevos + Reactivados", M.restoPie("nr"))}
    ${chartCard("prCh_sh", "Horas de Conexión", M.restoPie("sh"))}${chartCard("prCh_tr", "Viajes", M.restoPie("tr"))}</div>`;
  h += sec("Comparativa por ciudad", "", ciudadToggle()) + `<p class="rd-note">${iconSvg("info", { size: 14 })}<span>${e(ciudadNota())}</span></p>` + `<div class="rd-grid-2">
    ${chartCard("prCc_ad", "Conductores Activos")}${chartCard("prCc_nr", "Nuevos + Reactivados")}${chartCard("prCc_sh", "Horas de Conexión")}${chartCard("prCc_tr", "Viajes")}</div>`;
  h += sec("Tabla de Partners", "Último período · haz clic en una columna para ordenar", leads()) + tablaPartners();
  return h + `</div>`;
}

// ── A · LIENZO ABIERTO ─────────────────────────────────────────────────────
function aTabs(): string {
  return `<div class="pr-a-tabs" role="group" aria-label="Línea de negocio">${LINEAS.map(l =>
    `<button type="button" class="pr-a-tab" aria-pressed="${PS.rendLine === l.value}" data-act="prRendLine" data-value="${l.value}">${e(l.label)}</button>`).join("")}</div>`;
}
const aH = (t: string, sub = "", right = "") => `<div class="pr-a-h"><div><h2>${e(t)}</h2>${sub ? `<p>${e(sub)}</p>` : ""}</div>${right}</div>`;
function aKpi(k: Kpi, sub: string, g?: ReturnType<typeof goal>) {
  return `<div class="pr-a-kpi"><div class="pr-a-kpi__lbl">${LBL[k]}</div><div class="pr-a-kpi__val">${valor(k)}</div>
    <div class="pr-a-kpi__delta">${dl(M.k[k].c, M.k[k].p)} <span>vs sem. anterior · ${e(sub)}</span></div>
    ${g ? (g.pct != null ? `${bar(g.pct, g.projPct, "pr-a-line")}<div class="pr-a-kpi__cap">${e(g.caption)}</div>` : `<div class="pr-a-kpi__cap pr-muted">Sin meta mensual</div>`) : ""}</div>`;
}
function versionA(): string {
  let h = `<div class="pr-a">` + aTabs();
  if (PS.rendLine === "fleet") {
    return h + aH("Flota", `Solo KPIs propios de la sub-flota · ${d2s(M.L)}`) + fleetKpis("pr-a-kpis pr-a-kpis--cards") +
      `<div class="pr-a-grid2">${chartCard("prCh_foc", "Autos propios activos", "", "pr-a-chart")}${chartCard("prCh_fsh", "SH por auto", "", "pr-a-chart")}</div></div>`;
  }
  h += `<div class="pr-a-kpis">${aKpi("ad", "última semana", goal("ad"))}${aKpi("nr", "acumulado", goal("nr"))}${aKpi("sh", "acumulado", goal("sh"))}${aKpi("tr", "acumulado", { pct: null, projPct: null, caption: "" })}</div>`;
  h += `<p class="pr-a-note">${e(nota())}</p>`;
  h += aH("Por ciudad", "última semana vs la anterior") + tablaCiudad("pr-a-table");
  h += aH("Quién se movió", `Conductores activos vs ${d2s(M.P)}`) + `<div class="pr-a-movers">${movers("suben", "pr-a-mov")}${movers("bajan", "pr-a-mov")}</div>`;
  h += aH("Tendencias", "Top 8 partners por conductores activos") + `<div class="pr-a-grid2">
    ${chartCard("prCh_ad", "Conductores Activos", M.restoPie("ad"), "pr-a-chart")}${chartCard("prCh_nr", "Nuevos + Reactivados", M.restoPie("nr"), "pr-a-chart")}
    ${chartCard("prCh_sh", "Horas de Conexión", "", "pr-a-chart")}${chartCard("prCh_tr", "Viajes", "", "pr-a-chart")}</div>`;
  h += aH("Comparativa por ciudad", ciudadNota(), ciudadToggle()) + `<div class="pr-a-grid2">${chartCard("prCc_ad", "Conductores Activos", "", "pr-a-chart")}${chartCard("prCc_nr", "Nuevos + Reactivados", "", "pr-a-chart")}</div>`;
  h += aH("Por KAM", "última semana con variación · acumulado del rango") + tablaKam("pr-a-table");
  h += aH("Partners", "Último período · clic en una columna para ordenar", leads()) + tablaPartners("pr-a-table pr-a-table--scroll");
  return h + `</div>`;
}

// ── B · SUAVE ──────────────────────────────────────────────────────────────
function bKpi(k: Kpi, sub: string, g?: ReturnType<typeof goal>) {
  const conMeta = g && g.pct != null;
  return `<div class="pr-b-kpi">${conMeta ? ring(g!.pct, 72, 8) : `<div class="pr-b-kpi__ico">${iconSvg(k === "tr" ? "car" : "activity", { size: 22 })}</div>`}
    <div class="pr-b-kpi__body"><div class="pr-b-kpi__lbl">${LBL[k]}</div><div class="pr-b-kpi__val">${valor(k)}</div>
    <div class="pr-b-kpi__delta">${dl(M.k[k].c, M.k[k].p)}<span>${e(sub)}</span></div>
    ${conMeta ? `<div class="pr-b-kpi__cap">${e(g!.caption)}</div>` : `<div class="pr-b-kpi__cap pr-muted">Sin meta mensual</div>`}</div></div>`;
}
function versionB(): string {
  let h = `<div class="pr-b"><div class="pr-b-toolbar">${lineToggle()}</div>`;
  if (PS.rendLine === "fleet") {
    return h + `<div class="pr-b-panel"><h2 class="pr-b-h">Tu flota esta semana</h2>${fleetKpis("pr-b-kpis pr-b-kpis--fleet")}</div>` +
      `<div class="pr-b-grid2">${chartCard("prCh_foc", "Autos propios activos", "", "pr-b-chart")}${chartCard("prCh_fsh", "SH por auto", "", "pr-b-chart")}</div></div>`;
  }
  h += `<div class="pr-b-kpis">${bKpi("ad", "vs sem. anterior", goal("ad"))}${bKpi("nr", "vs sem. anterior", goal("nr"))}${bKpi("sh", "vs sem. anterior", goal("sh"))}${bKpi("tr", "vs sem. anterior")}</div>`;
  h += `<p class="pr-b-note">${iconSvg("info", { size: 14 })}<span>${e(nota())}</span></p>`;
  h += `<h2 class="pr-b-h">Por ciudad</h2><div class="pr-b-cities">${M.ciudades.map(c => `<div class="pr-b-city">
    <div class="pr-b-city__name">${dot(catVar(cityIdx(c.city)))}${cityLabel(c.city)}</div>
    <div class="pr-b-city__val">${fmt(c.ad)}<span>conductores</span></div>
    <div class="pr-b-city__row"><span>N+R ${fmt(c.nr)}</span>${dl(c.nr, c.pnr)}</div>
    <div class="pr-b-city__row"><span>Horas ${fmtSmart(c.sh)}</span>${dl(c.sh, c.psh)}</div>
    <div class="pr-b-city__row"><span>AD</span>${dl(c.ad, c.pad)}</div></div>`).join("")}</div>`;
  h += `<h2 class="pr-b-h">Quién se movió</h2><div class="pr-b-grid2">${movers("suben", "pr-b-mov")}${movers("bajan", "pr-b-mov")}</div>`;
  h += `<h2 class="pr-b-h">Tendencias <span class="pr-b-hsub">top 8 partners</span></h2><div class="pr-b-grid2">
    ${chartCard("prCh_ad", "Conductores Activos", M.restoPie("ad"), "pr-b-chart")}${chartCard("prCh_nr", "Nuevos + Reactivados", "", "pr-b-chart")}
    ${chartCard("prCh_sh", "Horas de Conexión", "", "pr-b-chart")}${chartCard("prCh_tr", "Viajes", "", "pr-b-chart")}</div>`;
  h += `<div class="pr-b-hrow"><h2 class="pr-b-h">Comparativa por ciudad</h2>${ciudadToggle()}</div><div class="pr-b-grid2">${chartCard("prCc_ad", "Conductores Activos", ciudadNota(), "pr-b-chart")}${chartCard("prCc_nr", "Nuevos + Reactivados", "", "pr-b-chart")}</div>`;
  h += `<h2 class="pr-b-h">Por KAM</h2>${tablaKam("pr-b-table")}`;
  h += `<div class="pr-b-hrow"><h2 class="pr-b-h">Partners</h2>${leads()}</div>${tablaPartners("pr-b-table pr-b-table--scroll", "ui-table rd-table rd-table--partners")}`;
  return h + `</div>`;
}

// ── C · MESA DE TRABAJO ────────────────────────────────────────────────────
function versionC(): string {
  const serieT = (k: Kpi) => M.serieTotal(k);
  const strip = (["ad", "nr", "sh", "tr"] as Kpi[]).map(k => {
    const g = k === "tr" ? null : goal(k);
    return `<div class="pr-c-stat"><div class="pr-c-stat__lbl">${CORTO[k]}</div><div class="pr-c-stat__row"><span class="pr-c-stat__val">${k === "sh" || k === "tr" ? fmtSmart(M.k[k].v) : valor(k)}</span>${dl(M.k[k].c, M.k[k].p)}</div>
      <div class="pr-c-stat__row">${spark(serieT(k), 110, 22)}${g && g.pct != null ? `<span class="pr-c-stat__meta">${pct1(g.pct)} meta</span>` : `<span class="pr-c-stat__meta pr-muted">sin meta</span>`}</div></div>`;
  }).join("");
  let h = `<div class="pr-c"><div class="pr-c-top">${lineToggle()}<span class="pr-c-top__hint">${e(nota())}</span></div>`;
  if (PS.rendLine === "fleet") {
    return h + fleetKpis("pr-c-strip pr-c-strip--fleet") + `<div class="pr-b-grid2">${chartCard("prCh_foc", "Autos propios activos", "", "pr-c-panel")}${chartCard("prCh_fsh", "SH por auto", "", "pr-c-panel")}</div></div>`;
  }
  h += `<div class="pr-c-strip">${strip}</div>`;
  const lista = partnersOrdenados();
  const sel = lista.find(p => p.partner === PS.rSel) || lista[0];
  const sortBtn = (k: string, l: string) => `<button type="button" class="pr-c-sort" aria-pressed="${PS.sort.col === k}" data-act="prSort" data-col="${k}">${l}${PS.sort.col === k ? iconSvg(PS.sort.dir === "asc" ? "arrow-up" : "arrow-down", { size: 12 }) : ""}</button>`;
  h += `<div class="pr-c-split"><div class="pr-c-list">
    <div class="pr-c-list__head"><span>${lista.length} partners</span><span class="pr-c-list__sorts">${sortBtn("ad", "AD")}${sortBtn("nr", "N+R")}${sortBtn("partner", "A–Z")}</span></div>
    <div class="pr-c-list__body">${lista.map(p => `<button type="button" class="pr-c-row${p === sel ? " is-sel" : ""}" data-act="prRSel" data-p="${e(p.partner)}">
      <span class="pr-c-row__name">${dot(hashColor(p.partner))}<span>${e(p.partner)}</span></span><span class="pr-c-row__kam">${e(p.kam)}</span>
      <span class="pr-c-row__num">${fmt(p.ad)}</span><span class="pr-c-row__d">${dl(p.ad, p.pad)}</span>${spark(p.serie, 64, 20)}</button>`).join("")}</div></div>`;
  if (sel) {
    const v = varPct(sel.ad, sel.pad);
    h += `<div class="pr-c-detail"><div class="pr-c-detail__head"><div><div class="pr-c-detail__name">${dot(hashColor(sel.partner))}${e(sel.partner)}</div>
      <div class="pr-c-detail__meta">KAM ${e(sel.kam)} · semana del ${d2s(M.L)}</div></div>
      <button type="button" class="ui-btn ui-btn--secondary ui-btn--sm" data-act="prToast" data-msg="Abriría la Presentación de este partner">${iconSvg("presentation", { size: 14 })}<span>Presentación</span></button></div>
      <div class="pr-c-mini">
        <div><span>Cond. activos</span><strong>${fmt(sel.ad)}</strong>${dl(sel.ad, sel.pad)}</div>
        <div><span>N+R</span><strong>${fmt(sel.nr)}</strong></div><div><span>Horas</span><strong>${fmtSmart(sel.sh)}</strong></div>
        <div><span>Viajes</span><strong>${fmtSmart(sel.tr)}</strong></div><div><span>Comisión</span><strong>${fmtK$(sel.co)}</strong></div>
        <div><span>Leads Yango</span><strong>${fmt(sel.ns)}</strong></div></div>
      ${chartCard("prCd_ad", "Conductores activos por semana", v == null ? "" : `Última semana ${v >= 0 ? "+" : ""}${v.toFixed(1)}% vs la anterior`, "pr-c-panel pr-c-panel--flat")}
      </div>`;
  }
  h += `</div>`;
  h += `<div class="pr-c-grid"><div class="pr-c-panel"><div class="pr-c-panel__t">Por ciudad</div>${tablaCiudad("pr-c-table")}</div>
    <div class="pr-c-panel"><div class="pr-c-panel__t">Por KAM · última semana</div>${tablaKam("pr-c-table")}</div></div>`;
  h += `<div class="pr-c-grid">${chartCard("prCh_ad", "Top 8 · Conductores activos", "", "pr-c-panel")}${chartCard("prCc_ad", "Ciudades · " + (PS.ciudadModo === "indice" ? "índice base 100" : "valores"), "", "pr-c-panel")}</div>`;
  return h + `</div>`;
}

export function renderRend(): string {
  M = modeloRend(PS.rendLine, PS.F);
  if (!M.L) return `<div class="ui-empty"><div class="ui-empty__title">Sin datos en el rango</div></div>`;
  return PS.v === "a" ? versionA() : PS.v === "b" ? versionB() : PS.v === "c" ? versionC() : elegida();
}

/** Monta las gráficas (ApexCharts vía charts.buildLineChart, el mismo de la app). */
export function chartsRend(): void {
  if (!M || !M.L) return;
  const tk = chartTokens();
  const cats = M.ws;
  const hay = (id: string) => !!document.getElementById(id);
  (["ad", "nr", "sh", "tr"] as Kpi[]).forEach(k => {
    if (hay("prCh_" + k)) {
      const s = M.series(k);
      buildLineChart("prCh_" + k, cats, s, s.map((_, i) => seriesColor(i, tk)), { chart: { height: 290 } });
    }
    if (hay("prCc_" + k)) {
      const cs = M.ciudadSerie(k);
      const idx = PS.ciudadModo === "indice";
      buildLineChart("prCc_" + k, cats, cs.map(c => ({ name: cityLabel(c.city), data: idx ? c.data.map(v => c.data[0] ? Math.round(v / c.data[0] * 1000) / 10 : null) : c.data })),
        cs.map(c => seriesColor(cityIdx(c.city), tk)), idx ? { yaxis: { labels: { formatter: v => v == null ? "" : Math.round(v) } } } : undefined);
    }
  });
  if (hay("prCd_ad")) {
    const lista = partnersOrdenados();
    const sel = lista.find(p => p.partner === PS.rSel) || lista[0];
    if (sel) buildLineChart("prCd_ad", cats, [{ name: sel.partner, data: sel.serie }], [seriesColor(0, tk)], undefined);
  }
  if (hay("prCh_foc")) buildLineChart("prCh_foc", cats, [{ name: "Autos propios", data: M.fleetSerie("oc") }], [seriesColor(0, tk)], undefined);
  if (hay("prCh_fsh")) buildLineChart("prCh_fsh", cats, [{ name: "SH por auto", data: M.fleetSerie("shCar").map(v => v == null ? null : Math.round(v * 10) / 10) }], [seriesColor(1, tk)], undefined);
}
export { n0 };
