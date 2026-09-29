// dev/proto/pPerf.ts — "Desempeño": Rendimiento + Metas en UNA vista (SOLO prototipo).
//
// Pedido de Manuel (29-sep-2026): "ve pensando en poder combinar la vista de
// performance y de Metas para tener una sola… tomar lo mejor de cada sección".
//
// Qué se toma de cada una:
//   · Rendimiento: tarjetas con anillo ("B · Suave"), delta vs período anterior,
//     tarjetas por ciudad con minigráfico, "quién se movió", tendencias,
//     productividad y la tabla ordenable de partners.
//   · Metas: meta del mes, % con un decimal, proyección al cierre, estado por
//     cuenta (bajo / en / sobre / sin meta), cuota TukTuk, PDF y los avisos de
//     escala ("en semanal el % de AD no es comparable").
//   · Nuevo: "cuánto falta" (brecha y ritmo necesario por semana), tendencia con
//     la línea de la meta dibujada, y "dónde está la brecha" (partners que más
//     explican lo que falta).
//
// Tres propuestas: D1 un tablero con la meta integrada · D2 pestañas por nivel ·
// D3 foco en la brecha. Todo sale del fixture (mismo modelo que pRend/pMetas).

import { escapeHTML as e } from "../../core/security";
import { fmt, fmtSmart, hashColor } from "../../core/format";
import { iconSvg } from "../../shared/icons";
import { segmented, progressRing, badge } from "../../shared/ui";
import { buildLineChart } from "../../charts";
import { chartTokens, seriesColor } from "../../shared/chartTheme";
import { PS } from "./state";
import {
  modeloRend, modeloMetas, filtrar, cityLabel, d2s, mesNombre, mesLargo, CIUDADES, KAMS, pct1, finSemana, SEMANAS, mesDeSemana, MESES_META,
  type ModeloRend, type ModeloMetas, type Kpi, type UnidadMeta, type Linea
} from "./model";
import { dl, dot, catVar, sec, chartCard, spark, bar, toneTxt, tone } from "./bits";

type K3 = "ad" | "nr" | "sh";
const K3S: K3[] = ["ad", "nr", "sh"];
const LBL: Record<Kpi, string> = { ad: "Conductores activos", nr: "Nuevos + reactivados", sh: "Horas de conexión", tr: "Viajes" };
const CORTO: Record<Kpi, string> = { ad: "AD", nr: "N+R", sh: "Horas", tr: "Viajes" };
const LINEAS = [
  { value: "comb", label: "Combinado", icon: "activity" as const }, { value: "agg", label: "Agregador", icon: "taxi" as const },
  { value: "fleet", label: "Fleet", icon: "car" as const }, { value: "tk", label: "TukTuk", icon: "tuktuk" as const }
];
const fv = (k: Kpi, v: number | null | undefined) => v == null ? "—" : fmt(Math.round(v));   // SIEMPRE número completo (pedido de Manuel)

let R: ModeloRend;
let M: ModeloMetas;

// ── Cálculos propios de la vista combinada ──────────────────────────────────
const _diasMes = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
function avance(k: K3) { return M.pais.find(p => p.k === k)!.a; }
/** Cuánto falta para la meta y qué ritmo haría falta (flujos) o qué nivel (AD). */
function brecha(k: K3) {
  const a = avance(k);
  if (!a || !a.meta) return null;
  const ult = M.ult, dm = _diasMes(M.ym);
  const transcurridos = Math.min(+finSemana(ult).slice(8, 10), dm);
  const restantes = Math.max(dm - transcurridos, 0);
  const semRest = restantes / 7;
  const falta = Math.max(a.meta - a.actual, 0);
  // "Llega" = la PROYECCIÓN de la app (AD: máx × 1.4; flujos: ritmo del mes),
  // la misma que muestran el anillo y el pie — nunca dos veredictos distintos.
  if (k === "ad") return { falta, restantes, ritmoAct: null, ritmoNec: null, llega: a.projPct != null && a.projPct >= 100 };
  const ritmoAct = a.actual / (transcurridos / 7);
  const ritmoNec = semRest > 0 ? falta / semRest : null;
  return { falta, restantes, ritmoAct, ritmoNec, llega: a.projPct != null && a.projPct >= 100 };
}
/** Brecha de UNA cuenta a la fecha: lo que "debería llevar" según el ritmo lineal de la meta. */
function brechaUnidad(u: UnidadMeta, k: K3) {
  const meta = u.meta[k];
  if (!meta) return 0;
  if (k === "ad") return Math.max(meta - u.act.ad, 0);
  const dm = _diasMes(M.ym), dias = Math.min(+finSemana(M.ult).slice(8, 10), dm);
  return Math.max(meta * dias / dm - u.act[k], 0);
}
// Por CUENTA (partner + ciudad), no por partner: un partner en 3 ciudades
// tiene 3 filas y cada una su propia variación y su minigráfico.
let U: Map<string, { c: number; p: number; serie: number[] }> = new Map();
function porCuenta() {
  U = new Map();
  const ws = R.ws, P = R.P;
  const rows = filtrar(PS.perf.line as Linea, PS.F, P ? [P, ...ws] : ws);
  rows.forEach(r => {
    const k = r.partner + "@" + r.city;
    const o = U.get(k) || { c: 0, p: 0, serie: ws.map(() => 0) };
    if (r.week === R.L) o.c += r.ad;
    if (r.week === P) o.p += r.ad;
    const i = ws.indexOf(r.week); if (i >= 0) o.serie[i] += r.ad;
    U.set(k, o);
  });
}
const serieDe = (key: string) => (U.get(key) || { serie: [] as number[] }).serie;
const deltaDe = (key: string) => { const x = U.get(key); return x ? { c: x.c, p: x.p } : { c: null, p: null }; };

// ── Piezas ──────────────────────────────────────────────────────────────────
const lineToggle = () => segmented({ ariaLabel: "Línea de negocio", act: "pfLine", value: PS.perf.line, options: LINEAS });
function barraSuperior(): string {
  const meses = MESES_META.filter(ym => ym <= "2026-09").slice(0, 4);
  return `<div class="pf-toolbar">${lineToggle()}
    <label class="pf-mes">${iconSvg("target", { size: 15 })}<span>Meta de</span>
      <select class="ui-select ui-select--sm" data-act-change="pfMes">${meses.map(ym => `<option value="${ym}"${ym === PS.metasMes ? " selected" : ""}>${mesLargo(ym)}</option>`).join("")}</select></label>
    <span class="pf-toolbar__sp"></span>
    <button type="button" class="ui-btn ui-btn--secondary ui-btn--sm" data-act="prToast" data-msg="Descargaría el PDF de desempeño (siempre en claro, con marca de agua).">${iconSvg("download", { size: 14 })}<span>PDF</span></button>
  </div>
  ${PS.F.escala !== "mensual" ? `<div class="pf-aviso">${iconSvg("info", { size: 14 })}<span>La meta es mensual. En escala ${PS.F.escala} el % de conductores activos es orientativo; N+R y horas sí acumulan en el mes.</span></div>` : ""}`;
}

/** Tarjeta KPI combinada: anillo + valor + delta (Rendimiento) + meta, % y proyección (Metas). */
function kpiCard(k: Kpi): string {
  const v = k === "ad" ? R.k.ad.v : R.k[k].v;
  const d = dl(R.k[k].c, R.k[k].p);
  if (k === "tr") {
    return `<div class="pf-kpi"><div class="pf-kpi__top"><span class="pf-kpi__lbl">${LBL.tr}</span><span class="pf-kpi__ico">${iconSvg("car", { size: 20 })}</span></div>
      <div class="pf-kpi__val">${fv("tr", v)}</div><div class="pf-kpi__delta">${d}<span>vs sem. anterior</span></div>
      <div class="pf-kpi__meta pf-muted">Sin meta mensual</div></div>`;
  }
  const a = avance(k as K3);
  const conMeta = !!(a && a.meta);
  return `<div class="pf-kpi"><div class="pf-kpi__top"><span class="pf-kpi__lbl">${LBL[k]}<small>${k === "ad" ? "último período" : "acumulado del mes"}</small></span>
      ${conMeta ? progressRing({ pct: a!.pct, projPct: a!.projPct, label: `${pct1(a!.pct)} de la meta`, size: 64, stroke: 7 }) : ""}</div>
    <div class="pf-kpi__val">${fv(k, conMeta ? a!.actual : v)}</div>
    <div class="pf-kpi__delta">${d}<span>vs sem. anterior</span></div>
    ${conMeta ? `<div class="pf-kpi__meta">${bar(a!.pct, a!.projPct)}
      <div class="pf-kpi__cap"><span>${toneTxt(a!.pct)} de ${fv(k, a!.meta)}</span><span>Proyección <b>${fv(k, a!.proj)}</b> ${toneTxt(a!.projPct)}</span></div></div>`
      : `<div class="pf-kpi__meta pf-muted">Sin meta de ${mesNombre(M.ym, false)}</div>`}
  </div>`;
}
const kpis = () => `<div class="pf-kpis">${(["ad", "nr", "sh", "tr"] as Kpi[]).map(kpiCard).join("")}</div>`;

/** Ciudades: tarjeta de Rendimiento (valor + minigráfico + deltas) con las barras de avance de Metas. */
function ciudades(): string {
  return `<div class="pf-cities">${R.ciudades.map(c => {
    const g = M.ciudades.find(x => x && x.g === c.city);
    const kp = (k: K3) => g ? g.kp.find(x => x.k === k) : null;
    const serie = R.ciudadSerie("ad").find(s => s.city === c.city)?.data || [];
    const fila = (k: K3, act: number, prev: number) => { const x = kp(k); return `<div class="pf-city__row"><span class="pf-city__k">${CORTO[k]}</span>
      <span class="pf-city__bar">${bar(x ? x.pct : null, x ? x.projPct : null)}</span><span class="pf-city__pct">${toneTxt(x ? x.pct : null)}</span><span class="pf-city__d">${dl(act, prev)}</span></div>`; };
    return `<div class="pf-city"><div class="pf-city__head"><span class="pf-city__name">${dot(catVar(CIUDADES.indexOf(c.city)))}${cityLabel(c.city)}</span>${spark(serie, 96, 28)}</div>
      <div class="pf-city__val">${fmt(c.ad)}<small>conductores</small></div>
      ${fila("ad", c.ad, c.pad)}${fila("nr", c.nr, c.pnr)}${fila("sh", c.sh, c.psh)}</div>`;
  }).join("")}</div>`;
}

/** KAM: la tabla de Metas (actual / meta / % / proyección) con el delta de Rendimiento. */
function tablaKam(): string {
  const rk = (kam: string) => R.kams.find(k => k.kam === kam);
  const filas = M.kams.filter(Boolean).map((g: any) => {
    const r = rk(g.g);
    const cel = (k: K3) => { const x = g.kp.find((y: any) => y.k === k); return `<td class="ui-num pf-kcell"><div class="pf-kcell__v">${fv(k, x.actual)}<small>de ${fv(k, x.meta)}</small></div>${bar(x.pct, x.projPct, "pf-kcell__bar")}<div class="pf-kcell__p">${toneTxt(x.pct)} · proy. ${pct1(x.projPct)}</div></td>`; };
    return `<tr><th scope="row" class="pf-rowhead">${dot(catVar(KAMS.indexOf(g.g)))}${e(g.g)}<small>${g.n} cuentas</small></th>${cel("ad")}<td class="rd-dcol">${r ? dl(r.ad, r.pad) : ""}</td>${cel("nr")}${cel("sh")}</tr>`;
  }).join("");
  return `<div class="ui-table-wrap pf-table"><table class="ui-table"><thead><tr><th>KAM</th><th class="ui-num">Conductores activos</th><th class="rd-dcol">Δ sem.</th><th class="ui-num">Nuevos + reactivados</th><th class="ui-num">Horas de conexión</th></tr></thead><tbody>${filas}</tbody></table></div>`;
}

/** Partners: una sola tabla con estado de meta (Metas) + delta, minigráfico y orden (Rendimiento). */
function unidadesVista(): UnidadMeta[] {
  const f = PS.perf.filtro;
  let us = M.unidades.filter(u => f === "todos" || u.estado === f);
  const s = PS.perf.sort;
  const val = (u: UnidadMeta) => s === "ad" ? u.act.ad : s === "pct" ? (u.peor ?? 999) : s === "brecha" ? -brechaUnidad(u, "ad") : s === "delta" ? (() => { const d = deltaDe(u.key); return d.p ? (d.c! - d.p) / d.p : 0; })() : 0;
  us = us.slice().sort((a, b) => s === "pct" || s === "brecha" ? val(a) - val(b) : val(b) - val(a));
  return us;
}
function chipsEstado(): string {
  const n = (st: string) => st === "todos" ? M.unidades.length : M.unidades.filter(u => u.estado === st).length;
  const ch: [string, string, string][] = [["todos", "Todas", "neutral"], ["bajo", "Bajo meta", "bad"], ["en", "En meta", "ok"], ["sobre", "Sobre meta", "over"], ["sin", "Sin meta", "neutral"]];
  return `<div class="pf-chips" role="group" aria-label="Filtrar por estado">${ch.map(([v, l, t]) =>
    `<button type="button" class="pf-chip pf-chip--${t}${PS.perf.filtro === v ? " is-on" : ""}" data-act="pfFiltro" data-value="${v}" aria-pressed="${PS.perf.filtro === v}">${l}<b>${n(v)}</b></button>`).join("")}</div>`;
}
function ordenar(): string {
  return segmented({ ariaLabel: "Ordenar", act: "pfSort", value: PS.perf.sort, options: [
    { value: "pct", label: "Peor avance" }, { value: "brecha", label: "Más lejos de la meta" }, { value: "delta", label: "Más cayeron" }, { value: "ad", label: "Más grandes" }] });
}
function tablaPartners(limite = 999): string {
  const us = unidadesVista().slice(0, limite);
  const ESTADO: Record<string, [string, string]> = { bajo: ["Bajo meta", "bad"], en: ["En meta", "ok"], sobre: ["Sobre meta", "over"], sin: ["Sin meta", "neutral"] };
  const filas = us.map(u => {
    const d = deltaDe(u.key);
    const cel = (k: K3) => `<td class="ui-num"><div class="pf-pcell">${fv(k, u.act[k])}${u.meta[k] ? `<small>${toneTxt(u.pct[k])}</small>` : `<small class="pf-muted">sin meta</small>`}</div></td>`;
    const [el, et] = ESTADO[u.estado];
    return `<tr><th scope="row" class="pf-rowhead"><span class="pf-pname">${dot(hashColor(u.partner))}${e(u.partner)}</span><small>${cityLabel(u.city)} · ${e(u.kam)}</small></th>
      <td><span class="pf-estado pf-estado--${et}">${el}</span></td>${cel("ad")}<td class="rd-dcol">${dl(d.c, d.p)}</td>${cel("nr")}${cel("sh")}<td class="pf-sparkcell">${spark(serieDe(u.key), 90, 24)}</td></tr>`;
  }).join("");
  return `<div class="ui-table-wrap ui-table-wrap--scroll pf-table pf-table--partners"><table class="ui-table ui-table--sticky-first"><thead><tr>
    <th>Partner</th><th>Estado</th><th class="ui-num">Cond. activos</th><th class="rd-dcol">Δ sem.</th><th class="ui-num">N+R</th><th class="ui-num">Horas</th><th>Últimas semanas</th></tr></thead>
    <tbody>${filas || `<tr><td colspan="7" class="pf-empty">Ninguna cuenta en este estado.</td></tr>`}</tbody></table></div>`;
}

/** Quién se movió (Rendimiento) junto a "lejos de la meta" (nuevo). */
function movimiento(): string {
  const it = (xs: { partner: string; delta: number; pct: number }[], cls: string) => xs.map(m => `<li><span class="pf-mov__n">${dot(hashColor(m.partner))}${e(m.partner)}</span><span class="pf-mov__v pf-mov__v--${cls}">${m.delta > 0 ? "+" : "−"}${fmt(Math.abs(m.delta))}</span><span class="pf-mov__p">${m.pct > 0 ? "+" : ""}${m.pct.toFixed(1)}%</span></li>`).join("");
  const lejos = M.unidades.filter(u => !u.sinMeta).map(u => ({ u, g: brechaUnidad(u, "ad") })).filter(x => x.g > 0).sort((a, b) => b.g - a.g).slice(0, 5);
  return `<div class="pf-grid3">
    <div class="pf-card pf-mov"><div class="pf-mov__h pf-mov__h--good">${iconSvg("trending-up", { size: 16 })}Los que más subieron</div><ul>${it(R.suben, "good") || "<li class='pf-muted'>Sin movimientos</li>"}</ul></div>
    <div class="pf-card pf-mov"><div class="pf-mov__h pf-mov__h--bad">${iconSvg("trending-down", { size: 16 })}Los que más cayeron</div><ul>${it(R.bajan, "bad") || "<li class='pf-muted'>Sin movimientos</li>"}</ul></div>
    <div class="pf-card pf-mov"><div class="pf-mov__h pf-mov__h--warn">${iconSvg("target", { size: 16 })}Más lejos de su meta de AD</div><ul>${lejos.map(x => `<li><span class="pf-mov__n">${dot(hashColor(x.u.partner))}${e(x.u.partner)} <small>${cityLabel(x.u.city)}</small></span><span class="pf-mov__v pf-mov__v--bad">faltan ${fmt(Math.round(x.g))}</span><span class="pf-mov__p">${pct1(x.u.pct.ad)}</span></li>`).join("") || "<li class='pf-muted'>Todas en meta</li>"}</ul></div>
  </div>`;
}
const tendencias = () => `<div class="pf-grid2">${chartCard("pfCh_ad", "Conductores activos vs meta", "Línea punteada: meta del mes (nivel)")}${chartCard("pfCh_nr", "N+R acumulado del mes vs meta", "Línea punteada: ritmo lineal que llega a la meta")}${chartCard("pfCh_sh", "Horas acumuladas del mes vs meta", "Línea punteada: ritmo lineal que llega a la meta")}${chartCard("pfCh_tr", "Viajes por semana", "Top 8 partners")}</div>`;
function productividad(): string {
  const c = (l: string, a: number, b: number, dec = 1) => `<div class="pf-prod"><span>${l}</span><b>${a.toFixed(dec)}</b>${dl(a, b)}</div>`;
  return `<div class="pf-prods">${c("Horas por conductor", R.prodL.shAd, R.prodP.shAd)}${c("Viajes por conductor", R.prodL.trAd, R.prodP.trAd)}${c("Viajes por hora", R.prodL.trSh, R.prodP.trSh, 2)}</div>`;
}
function cuotaTk(): string {
  if (PS.perf.line !== "tk") return "";
  return `<div class="pf-aviso pf-aviso--info">${iconSvg("tuktuk", { size: 14 })}<span>El % de TukTuk se calcula solo sobre las cuentas con cuota declarada en la Calculadora; el actual es de todas las cuentas.</span></div>`;
}
function fleet(): string {
  const f = R.fleetL, p = R.fleetP;
  const c = (l: string, v: string, a: number | null, b: number | null) => `<div class="pf-kpi"><div class="pf-kpi__top"><span class="pf-kpi__lbl">${l}</span></div><div class="pf-kpi__val">${v}</div><div class="pf-kpi__delta">${dl(a, b)}<span>vs sem. anterior</span></div><div class="pf-kpi__meta pf-muted">Meta Fleet: se carga en la Calculadora</div></div>`;
  return `<div class="pf-kpis">${c("Autos propios", fmt(f.oc), f.oc, p.oc)}${c("SH por auto", f.shCar == null ? "—" : f.shCar.toFixed(1), f.shCar, p.shCar)}${c("Aceptación", f.acc == null ? "—" : pct1(f.acc), f.acc, p.acc)}${c("Autos brandeados", fmt(f.br), f.br, p.br)}</div>
    ${sec("Tendencias de la flota", "Autos propios y horas por auto, por semana")}<div class="pf-grid2">${chartCard("pfCh_foc", "Autos propios activos")}${chartCard("pfCh_fsh", "SH por auto")}</div>`;
}

// ── D1 · Tablero con la meta integrada ──────────────────────────────────────
function d1(): string {
  if (PS.perf.line === "fleet") return `<div class="pf">${barraSuperior()}${fleet()}</div>`;
  return `<div class="pf">${barraSuperior()}${cuotaTk()}
    ${sec(`Desempeño de ${mesLargo(M.ym)}`, `Actual del mes contra la meta · delta vs la semana anterior (${d2s(R.P)})`)}${kpis()}
    ${sec("Por ciudad", "Nivel de conductores y avance de cada KPI contra la meta del mes")}${ciudades()}
    ${sec("Por KAM", "Actual, meta, % y proyección al cierre · ordenado por conductores activos")}${tablaKam()}
    ${sec("Quién se movió y quién está lejos", `Variación de conductores vs ${d2s(R.P)} · brecha contra la meta de AD`)}${movimiento()}
    ${sec("Tendencias contra la meta", "")}${tendencias()}
    ${sec("Productividad", `${d2s(R.L)} vs período anterior`)}${productividad()}
    <div class="pf-sechead">${sec("Partners", "Estado contra la meta, variación y últimas semanas")}${ordenar()}</div>${chipsEstado()}${tablaPartners()}
  </div>`;
}

// ── D2 · Pestañas por nivel ─────────────────────────────────────────────────
function d2(): string {
  if (PS.perf.line === "fleet") return `<div class="pf">${barraSuperior()}${fleet()}</div>`;
  const tabs = segmented({ ariaLabel: "Nivel", act: "pfTab", value: PS.perf.tab, options: [
    { value: "resumen", label: "Resumen", icon: "activity" }, { value: "ciudades", label: "Ciudades", icon: "map-pin" }, { value: "kams", label: "KAMs", icon: "users" },
    { value: "partners", label: "Partners", icon: "building" }, { value: "tendencias", label: "Tendencias", icon: "chart-line" }] });
  let cuerpo = "";
  switch (PS.perf.tab) {
    case "ciudades": cuerpo = ciudades(); break;
    case "kams": cuerpo = tablaKam(); break;
    case "partners": cuerpo = `<div class="pf-sechead">${chipsEstado()}${ordenar()}</div>${tablaPartners()}`; break;
    case "tendencias": cuerpo = tendencias() + sec("Productividad", "") + productividad(); break;
    default: cuerpo = `${movimiento()}${sec("Cuentas bajo meta", "Las 8 con peor avance")}${(() => { const f = PS.perf.filtro, s = PS.perf.sort; PS.perf.filtro = "bajo"; PS.perf.sort = "pct"; const h = tablaPartners(8); PS.perf.filtro = f; PS.perf.sort = s; return h; })()}`;
  }
  return `<div class="pf">${barraSuperior()}${cuotaTk()}${kpis()}<div class="pf-tabs">${tabs}</div><div class="pf-tabbody">${cuerpo}</div></div>`;
}

// ── D3 · Foco en la brecha ──────────────────────────────────────────────────
function tarjetaBrecha(k: K3): string {
  const a = avance(k), b = brecha(k);
  if (!a || !a.meta || !b) return `<div class="pf-gap"><div class="pf-gap__lbl">${LBL[k]}</div><div class="pf-muted">Sin meta de ${mesNombre(M.ym, false)}</div></div>`;
  const ok = b.llega;
  const cuerpo = k === "ad"
    ? `<div class="pf-gap__big">${b.falta ? `faltan <b>${fmt(Math.round(b.falta))}</b>` : `<b>meta alcanzada</b>`}</div><div class="pf-gap__sub">Nivel actual ${fmt(a.actual)} de ${fmt(a.meta)} · potencial ${fmt(Math.round(a.proj))}</div>`
    : `<div class="pf-gap__big">faltan <b>${fmt(Math.round(b.falta))}</b> en ${b.restantes} días</div>
       <div class="pf-gap__ritmo"><span>Ritmo actual <b>${fmt(Math.round(b.ritmoAct || 0))}</b>/sem</span><span>Necesario <b class="${ok ? "" : "pf-bad"}">${b.ritmoNec == null ? "—" : fmt(Math.round(b.ritmoNec))}</b>/sem</span></div>`;
  return `<div class="pf-gap pf-gap--${ok ? "ok" : "warn"}"><div class="pf-gap__top"><span class="pf-gap__lbl">${LBL[k]}</span>${progressRing({ pct: a.pct, projPct: a.projPct, label: pct1(a.pct), size: 56, stroke: 6 })}</div>
    ${cuerpo}<div class="pf-gap__foot">${ok ? iconSvg("check-circle", { size: 14 }) : iconSvg("alert-triangle", { size: 14 })}<span>${ok ? "Proyección: llega" : "Proyección: no llega"} · ${pct1(a.projPct)} de la meta</span></div></div>`;
}
function dondeBrecha(): string {
  const us = M.unidades.filter(u => !u.sinMeta).map(u => ({ u, g: { ad: brechaUnidad(u, "ad"), nr: brechaUnidad(u, "nr"), sh: brechaUnidad(u, "sh") } }))
    .filter(x => x.g.ad > 0 || x.g.nr > 0).sort((a, b) => (b.g.nr + b.g.ad * 2) - (a.g.nr + a.g.ad * 2)).slice(0, 10);
  const totNr = us.reduce((s, x) => s + x.g.nr, 0) || 1;
  return `<div class="ui-table-wrap pf-table"><table class="ui-table"><thead><tr><th>Partner</th><th class="ui-num">Faltan AD</th><th class="ui-num">Atraso N+R a la fecha</th><th>Peso en la brecha de N+R</th><th class="ui-num">Horas atrasadas</th><th class="rd-dcol">Δ AD sem.</th></tr></thead><tbody>` +
    us.map(x => { const d = deltaDe(x.u.key); const w = x.g.nr / totNr * 100; return `<tr><th scope="row" class="pf-rowhead"><span class="pf-pname">${dot(hashColor(x.u.partner))}${e(x.u.partner)}</span><small>${cityLabel(x.u.city)} · ${e(x.u.kam)}</small></th>
      <td class="ui-num">${x.g.ad ? fmt(Math.round(x.g.ad)) : "—"}</td><td class="ui-num">${x.g.nr ? fmt(Math.round(x.g.nr)) : "—"}</td>
      <td><div class="pf-peso"><div class="pf-peso__bar" style="width:${w.toFixed(1)}%"></div><span>${w.toFixed(1)}%</span></div></td>
      <td class="ui-num">${x.g.sh ? fmt(Math.round(x.g.sh)) : "—"}</td><td class="rd-dcol">${dl(d.c, d.p)}</td></tr>`; }).join("") + `</tbody></table></div>`;
}
function d3(): string {
  if (PS.perf.line === "fleet") return `<div class="pf">${barraSuperior()}${fleet()}</div>`;
  return `<div class="pf">${barraSuperior()}${cuotaTk()}
    ${sec(`¿Llegamos a la meta de ${mesNombre(M.ym, false)}?`, `Con datos hasta la semana del ${d2s(M.ult)} · la proyección es la misma de Metas`)}
    <div class="pf-gaps">${K3S.map(tarjetaBrecha).join("")}</div>
    ${sec("Dónde está la brecha", "Las cuentas que más explican lo que falta · a la fecha, contra el ritmo lineal de su meta")}${dondeBrecha()}
    ${sec("Tendencias contra la meta", "")}${tendencias()}
    ${sec("Por ciudad y KAM", "")}${ciudades()}<div class="pf-sp"></div>${tablaKam()}
    <div class="pf-sechead">${sec("Todas las cuentas", "")}${ordenar()}</div>${chipsEstado()}${tablaPartners()}
  </div>`;
}

export function renderPerf(): string {
  const line = PS.perf.line as Linea;
  R = modeloRend(line, PS.F);
  M = modeloMetas(line === "fleet" ? "comb" : line, PS.F, PS.metasMes);
  if (!R.L) return `<div class="ui-empty"><div class="ui-empty__title">Sin datos en el rango</div></div>`;
  porCuenta();
  return PS.perf.v === "d2" ? d2() : PS.perf.v === "d3" ? d3() : d1();
}

// Gráficas: la tendencia con la meta DIBUJADA (nuevo) — AD vs nivel de meta;
// N+R y horas acumulados del mes vs el ritmo lineal que llega a la meta.
export function chartsPerf(): void {
  if (!R || !R.L) return;
  const tk = chartTokens();
  const hay = (id: string) => !!document.getElementById(id);
  const semMes = SEMANAS.filter(w => mesDeSemana(w) === M.ym);
  if (hay("pfCh_ad")) {
    const a = avance("ad");
    const serie = R.serieTotal("ad");
    buildLineChart("pfCh_ad", R.ws, [{ name: "Conductores activos", data: serie }, ...(a && a.meta ? [{ name: "Meta del mes", data: R.ws.map(() => a.meta) }] : [])],
      [seriesColor(0, tk), tk.textMuted], { stroke: { dashArray: [0, 6], width: [3, 2] } } as any);
  }
  (["nr", "sh"] as K3[]).forEach(k => {
    const id = "pfCh_" + k;
    if (!hay(id)) return;
    const a = avance(k);
    const porSem = semMes.map(w => R.serieTotal(k)[R.ws.indexOf(w)] || 0);
    let acc = 0; const acum = porSem.map(v => (acc += v));
    const dm = _diasMes(M.ym);
    const ritmo = semMes.map(w => a && a.meta ? Math.round(a.meta * Math.min(+finSemana(w).slice(8, 10), dm) / dm) : null);
    buildLineChart(id, semMes.map(w => d2s(finSemana(w)).slice(0, 5)), [{ name: "Acumulado del mes", data: acum }, ...(a && a.meta ? [{ name: "Ritmo a la meta", data: ritmo }] : [])],
      [seriesColor(k === "nr" ? 1 : 2, tk), tk.textMuted], { stroke: { dashArray: [0, 6], width: [3, 2] } } as any);
  });
  if (hay("pfCh_tr")) { const s = R.series("tr"); buildLineChart("pfCh_tr", R.ws, s, s.map((_, i) => seriesColor(i, tk)), { chart: { height: 290 } }); }
  if (hay("pfCh_foc")) buildLineChart("pfCh_foc", R.ws, [{ name: "Autos propios", data: R.fleetSerie("oc") }], [seriesColor(0, tk)], undefined);
  if (hay("pfCh_fsh")) buildLineChart("pfCh_fsh", R.ws, [{ name: "SH por auto", data: R.fleetSerie("shCar").map(v => v == null ? null : Math.round(v * 10) / 10) }], [seriesColor(1, tk)], undefined);
}
export { badge, fmtSmart, tone };
