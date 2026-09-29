// dev/proto/pCalc2.ts — Calculadora, segunda vuelta (29-sep-2026, SOLO prototipo).
//
// Pedido de Manuel: "sigue sin gustarme el diseño y que no pueda editar
// manualmente las metas de TukTuk… quiero poder editar manualmente agregador,
// fleet y tuktuk y si en un futuro entra delivery y cargo también".
//
// Regla elegida por Manuel: cada LÍNEA se edita por separado y el total del
// partner = Taxi + TukTuk (editar TukTuk no le quita nada a Taxi). Mapea 1:1 a
// la base actual sin migrar: meta_active_drivers = Taxi + TukTuk y
// meta_tk_ad = TukTuk. Delivery y Cargo entrarían como líneas nuevas (config +
// columnas propias); acá se muestran como "Próximamente".
//
// Tres propuestas, todas con la capa suave (campos rellenos, sin marcos
// oscuros, más aire): P1 panel + pestañas por línea · P2 un indicador a la vez
// con Taxi y TukTuk lado a lado · P3 líneas arriba como tarjetas, tabla ancha.

import { escapeHTML as e } from "../../core/security";
import { fmt, hashColor } from "../../core/format";
import { iconSvg, type IconName } from "../../shared/icons";
import { segmented } from "../../shared/ui";
import { PS, type K3 } from "./state";
import { unidadesCalc, repartir, KAMS, cityLabel, FILAS, type UnidadCalc } from "./model";
import { dot } from "./bits";

const K3S: K3[] = ["ad", "sh", "nr"];
const NOM: Record<K3, string> = { ad: "Conductores activos", sh: "Horas de conexión", nr: "Nuevos + reactivados" };
const CORTO: Record<K3, string> = { ad: "AD", sh: "Horas", nr: "N+R" };
type Ln = "taxi" | "tk";
const LN_NOM: Record<Ln, string> = { taxi: "Taxi", tk: "TukTuk" };
const LN_ICO: Record<Ln, IconName> = { taxi: "taxi", tk: "tuktuk" };
const FUTURAS: { id: string; nom: string; ico: IconName }[] = [
  { id: "delivery", nom: "Delivery", ico: "package" }, { id: "cargo", nom: "Cargo", ico: "truck" }
];

// ── Modelo ──────────────────────────────────────────────────────────────────
interface Calc {
  us: UnidadCalc[];
  goal: Record<Ln, Record<K3, number | null>>;
  tkSugerido: Record<K3, boolean>;          // TukTuk sin declarar → peso real
  pesoTk: Record<K3, number>;               // % real de TukTuk en la cartera
  base: Record<Ln, Record<K3, number[]>>;
  vals: Record<Ln, Record<K3, (number | null)[]>>;
  suma: Record<Ln, Record<K3, number>>;
  baseTot: Record<Ln, Record<K3, number>>;
}
const fk = (key: string, ln: Ln, k: K3) => `${key}|${ln}|${k}`;

function calcular(): Calc {
  const C = PS.c2;
  const us = unidadesCalc(C.kam);
  const base = { taxi: {}, tk: {} } as Calc["base"];
  const baseTot = { taxi: {}, tk: {} } as Calc["baseTot"];
  const goal = { taxi: {}, tk: {} } as Calc["goal"];
  const vals = { taxi: {}, tk: {} } as Calc["vals"];
  const suma = { taxi: {}, tk: {} } as Calc["suma"];
  const tkSugerido = {} as Calc["tkSugerido"], pesoTk = {} as Calc["pesoTk"];
  K3S.forEach(k => {
    base.tk[k] = us.map(u => u.tk[k]);
    base.taxi[k] = us.map(u => Math.max(0, u.base[k] - u.tk[k]));
    baseTot.tk[k] = Math.round(base.tk[k].reduce((a, b) => a + b, 0));
    baseTot.taxi[k] = Math.round(base.taxi[k].reduce((a, b) => a + b, 0));
    const tot = baseTot.tk[k] + baseTot.taxi[k];
    pesoTk[k] = tot ? baseTot.tk[k] / tot * 100 : 0;
    const T = C.total[k];
    let tk: number | null = null;
    if (C.tkModo === "pct" && C.tkPct[k] != null && T != null) tk = Math.round(T * (C.tkPct[k] as number) / 100);
    if (C.tkModo === "abs" && C.tkAbs[k] != null) tk = C.tkAbs[k];
    tkSugerido[k] = tk == null && T != null;
    if (tkSugerido[k]) tk = Math.round((T as number) * pesoTk[k] / 100);
    goal.tk[k] = tk;
    goal.taxi[k] = T == null ? null : Math.max(0, T - (tk || 0));
    (["taxi", "tk"] as Ln[]).forEach(ln => {
      const fij = us.map(u => C.fijos[fk(u.key, ln, k)] ?? null);
      const g = goal[ln][k];
      vals[ln][k] = g == null ? fij : repartir(g, base[ln][k], fij);
      suma[ln][k] = vals[ln][k].reduce((s: number, v) => s + (v || 0), 0);
    });
  });
  return { us, goal, tkSugerido, pesoTk, base, vals, suma, baseTot };
}

// ── Piezas comunes ──────────────────────────────────────────────────────────
const num = (v: number | null | undefined) => v == null ? "" : fmt(v);
function cambio(a: number | null, b: number): string {
  if (a == null || !b) return `<span class="c2-muted">—</span>`;
  const v = (a - b) / b * 100;
  return `<span class="c2-cambio c2-cambio--${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%</span>`;
}
function tip(txt: string): string {
  return `<span class="ui-tip" tabindex="0" role="img" aria-label="${e(txt)}" data-tip="${e(txt)}">${iconSvg("info", { size: 14 })}</span>`;
}
function estadoLinea(D: Calc, ln: Ln): { ok: boolean; txt: string; tone: "ok" | "warn" | "neutral" } {
  const cargadas = K3S.filter(k => D.goal[ln][k] != null);
  if (!cargadas.length) return { ok: false, txt: "sin meta", tone: "neutral" };
  const malas = cargadas.filter(k => D.suma[ln][k] !== D.goal[ln][k]);
  if (malas.length) return { ok: false, txt: "no cuadra", tone: "warn" };
  if (ln === "tk" && K3S.some(k => D.tkSugerido[k])) return { ok: true, txt: "sugerido", tone: "neutral" };
  return { ok: true, txt: "cuadra", tone: "ok" };
}
function fleetUnits(D: Calc) { return D.us.filter(u => u.fleet); }
function fleetEstado(D: Calc): string {
  const fl = fleetUnits(D);
  const n = fl.filter(u => PS.c2.fleet[u.key + "|shcar"] != null || PS.c2.fleet[u.key + "|acc"] != null).length;
  return `${n}/${fl.length}`;
}
const kamSel = () => `<select class="ui-select c2-select" id="c2Kam" data-act-change="c2Kam" aria-label="KAM">${KAMS.map(k => `<option value="${k}"${k === PS.c2.kam ? " selected" : ""}>${k}</option>`).join("")}</select>`;
const mesPill = () => `<span class="c2-mes">${iconSvg("calendar", { size: 15 })}Septiembre 2026</span>`;
const acciones = (vertical = true) => `<div class="c2-actions${vertical ? "" : " c2-actions--row"}">
  <button type="button" class="ui-btn ui-btn--primary" data-act="c2Guardar">${iconSvg("save", { size: 16 })}<span>Guardar metas</span></button>
  <button type="button" class="ui-btn ui-btn--secondary" data-act="prToast" data-msg="Abriría las tarjetas compartibles por partner (ES / EN / RU), con Taxi, TukTuk y Fleet separados.">${iconSvg("image", { size: 16 })}<span>Tarjetas</span></button></div>`;

// Campo de meta del KAM (total). `compacto` = sin atajos (P3).
function campoTotal(k: K3, D: Calc, compacto = false): string {
  const g = PS.c2.total[k];
  const b = D.baseTot.taxi[k] + D.baseTot.tk[k];
  const v = g != null && b ? (g - b) / b * 100 : null;
  const atajos: [string, number][] = [["+5%", 1.05], ["+10%", 1.10], ["+15%", 1.15], ["Igual", 1]];
  return `<div class="c2-goal">
    <label class="c2-goal__lbl" for="c2T_${k}">${NOM[k]}</label>
    <input class="c2-in c2-in--lg" id="c2T_${k}" inputmode="numeric" value="${num(g)}" placeholder="p. ej. ${fmt(Math.round(b * 1.1))}" data-act-change="c2Total" data-k="${k}">
    ${compacto ? "" : `<div class="c2-chips">${atajos.map(([l, f]) => `<button type="button" class="c2-chip" data-act="c2Atajo" data-k="${k}" data-f="${f}">${l}</button>`).join("")}</div>`}
    <div class="c2-hint">Agosto: <b>${fmt(b)}</b>${v == null ? "" : ` <span class="c2-cambio c2-cambio--${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%</span>`}</div>
  </div>`;
}

// Bloque TukTuk del KAM: % de PnL o número, con el equivalente al lado.
function bloqueTk(D: Calc, compacto = false): string {
  const C = PS.c2;
  const modo = segmented({ ariaLabel: "Cómo cargar TukTuk", act: "c2TkModo", value: C.tkModo, options: [{ value: "pct", label: "%" }, { value: "abs", label: "Número" }] });
  const campos = K3S.map(k => {
    const val = C.tkModo === "pct" ? C.tkPct[k] : C.tkAbs[k];
    const eq = D.goal.tk[k] == null ? "" : C.tkModo === "pct"
      ? `= ${fmt(D.goal.tk[k] as number)}`
      : (C.total[k] ? `= ${((D.goal.tk[k] as number) / (C.total[k] as number) * 100).toFixed(1)}%` : "");
    return `<label class="c2-tkf"><span class="c2-tkf__k">${CORTO[k]}</span>
      <span class="c2-suffix"><input class="c2-in c2-in--sm" id="c2Tk_${k}" inputmode="decimal" value="${val == null ? "" : C.tkModo === "pct" ? String(val) : fmt(val)}" placeholder="${C.tkModo === "pct" ? D.pesoTk[k].toFixed(1) : fmt(Math.round((C.total[k] || 0) * D.pesoTk[k] / 100))}" data-act-change="c2Tk" data-k="${k}">${C.tkModo === "pct" ? `<span class="c2-suffix__t">%</span>` : ""}</span>
      <span class="c2-tkf__eq${D.tkSugerido[k] ? " is-sug" : ""}">${D.tkSugerido[k] ? `sugerido ${fmt(D.goal.tk[k] as number)}` : eq}</span></label>`;
  }).join("");
  return `<div class="c2-tk">
    <div class="c2-tk__head"><span class="c2-h">${iconSvg("tuktuk", { size: 14 })}TukTuk ${tip("La parte TukTuk de la meta total (lo que te baja PnL y declaras en el Loyalty Program). Vacío = se sugiere el peso real de TukTuk en tu cartera; al guardar se pide confirmar.")}</span>${modo}</div>
    <div class="c2-tkgrid">${campos}</div>
    ${compacto ? "" : `<div class="c2-hint">Peso real en agosto: AD ${D.pesoTk.ad.toFixed(1)}% · Horas ${D.pesoTk.sh.toFixed(1)}% · N+R ${D.pesoTk.nr.toFixed(1)}%</div>`}
  </div>`;
}

// Resumen por línea: meta del KAM por línea + si el reparto cuadra.
function resumenLineas(D: Calc): string {
  const fila = (ln: Ln) => {
    const st = estadoLinea(D, ln);
    return `<div class="c2-sum__row"><span class="c2-sum__ln">${iconSvg(LN_ICO[ln], { size: 14 })}${LN_NOM[ln]}</span>
      <span class="c2-sum__vals">${K3S.map(k => `<span>${CORTO[k]} <b>${num(D.goal[ln][k]) || "—"}</b></span>`).join("")}</span>
      <span class="c2-pill c2-pill--${st.tone}">${st.ok && st.tone === "ok" ? iconSvg("check", { size: 12 }) : ""}${st.txt}</span></div>`;
  };
  return `<div class="c2-sum">${fila("taxi")}${fila("tk")}
    <div class="c2-sum__row"><span class="c2-sum__ln">${iconSvg("car", { size: 14 })}Fleet</span><span class="c2-sum__vals"><span>SH/auto, aceptación, utilización</span></span><span class="c2-pill c2-pill--neutral">${fleetEstado(D)}</span></div></div>`;
}

// Celda editable de una línea. Id único: el foco sobrevive al repintado.
function celda(D: Calc, i: number, ln: Ln, k: K3): string {
  const u = D.us[i];
  const fija = PS.c2.fijos[fk(u.key, ln, k)] != null;
  const sinBase = !D.base[ln][k][i] && !fija;
  return `<input class="c2-cell${fija ? " is-fija" : ""}${sinBase ? " is-vacia" : ""}" id="c2c_${i}_${ln}_${k}" inputmode="numeric" value="${sinBase && !D.vals[ln][k][i] ? "" : num(D.vals[ln][k][i])}" placeholder="—"
    aria-label="Meta ${LN_NOM[ln]} ${CORTO[k]} · ${e(u.partner)} ${cityLabel(u.city)}" data-act-change="c2Cell" data-key="${e(u.key)}" data-ln="${ln}" data-k="${k}">`;
}
const partnerTd = (u: UnidadCalc, _D: Calc) => {
  const fija = Object.keys(PS.c2.fijos).some(x => x.startsWith(u.key + "|"));
  return `<th class="c2-p"><span class="c2-p__n">${dot(hashColor(u.partner))}<span>${e(u.partner)}</span>` +
    `${u.tieneMeta ? `<span class="c2-ico c2-ico--ok" title="Ya tiene meta guardada para septiembre">${iconSvg("check-circle", { size: 13 })}</span>` : ""}` +
    `${u.fleet ? `<span class="c2-ico" title="Partner Fleet">${iconSvg("car", { size: 13 })}</span>` : ""}` +
    `${u.tk.ad > 0 ? `<span class="c2-ico" title="Tiene TukTuk">${iconSvg("tuktuk", { size: 13 })}</span>` : ""}</span>` +
    `<span class="c2-p__c">${cityLabel(u.city)}${fija ? ` · <button type="button" class="c2-link" data-act="c2Soltar" data-key="${e(u.key)}">soltar</button>` : ""}</span></th>`;
};

// Tabla de UNA línea (P1 y P3): AD con real y cambio, Horas, N+R.
function tablaLinea(D: Calc, ln: Ln): string {
  // Solo los partners que tienen esa línea (o una celda fijada en ella): un
  // partner 100% TukTuk no ocupa una fila en cero en la pestaña Taxi.
  const idx = D.us.map((_, i) => i).filter(i => K3S.some(k => D.base[ln][k][i] > 0 || PS.c2.fijos[fk(D.us[i].key, ln, k)] != null));
  const filas = idx.map(i => {
    const u = D.us[i];
    const real = ln === "tk" ? u.tk.ad : u.base.ad - u.tk.ad;
    return `<tr>${partnerTd(u, D)}<td class="c2-num">${celda(D, i, ln, "ad")}</td><td class="c2-num c2-muted">${fmt(real)}</td><td class="c2-num">${cambio(D.vals[ln].ad[i], real)}</td>
      <td class="c2-num">${celda(D, i, ln, "sh")}</td><td class="c2-num">${celda(D, i, ln, "nr")}</td></tr>`;
  }).join("");
  const tot = (k: K3) => {
    const g = D.goal[ln][k], s = D.suma[ln][k];
    const dif = g != null && s !== g ? `<span class="c2-dif">${s > g ? "+" : "−"}${fmt(Math.abs(s - g))}</span>` : "";
    return `<b>${fmt(s)}</b>${g != null ? `<span class="c2-de">de ${fmt(g)}</span>` : ""}${dif}`;
  };
  const realTot = ln === "tk" ? D.baseTot.tk.ad : D.baseTot.taxi.ad;
  return `<div class="c2-tablewrap"><table class="c2-table">
    <thead><tr><th>Partner</th><th class="c2-num">Meta AD</th><th class="c2-num">Real ago</th><th class="c2-num">Cambio</th><th class="c2-num">Meta horas</th><th class="c2-num">Meta N+R</th></tr></thead>
    <tbody>${filas || `<tr><td colspan="6" class="c2-empty">Ningún partner de ${e(PS.c2.kam)} tiene ${LN_NOM[ln]}.</td></tr>`}</tbody>
    <tfoot><tr><th>Total ${LN_NOM[ln]}</th><td class="c2-num">${tot("ad")}</td><td class="c2-num c2-muted">${fmt(realTot)}</td><td class="c2-num">${cambio(D.suma[ln].ad || null, realTot)}</td><td class="c2-num">${tot("sh")}</td><td class="c2-num">${tot("nr")}</td></tr></tfoot>
  </table></div>`;
}

// Resumen por partner (solo lectura): Total = Taxi + TukTuk.
function tablaTotal(D: Calc): string {
  const filas = D.us.map((u, i) => `<tr>${partnerTd(u, D)}${K3S.map(k => {
    const a = D.vals.taxi[k][i] || 0, b = D.vals.tk[k][i] || 0;
    return `<td class="c2-num"><b>${fmt(a + b)}</b><span class="c2-split">${fmt(a)}${b ? ` · <span class="c2-tkc">${fmt(b)}</span>` : ""}</span></td>`;
  }).join("")}<td class="c2-num">${cambio((D.vals.taxi.ad[i] || 0) + (D.vals.tk.ad[i] || 0), u.base.ad)}</td></tr>`).join("");
  return `<div class="c2-tablewrap"><table class="c2-table">
    <thead><tr><th>Partner</th><th class="c2-num">AD total</th><th class="c2-num">Horas total</th><th class="c2-num">N+R total</th><th class="c2-num">Cambio AD</th></tr></thead>
    <tbody>${filas}</tbody></table></div>
    <p class="c2-foot">Debajo de cada total: Taxi · <span class="c2-tkc">TukTuk</span>. Se edita en su pestaña.</p>`;
}

// Fleet: sus KPIs propios (tasas), editables.
function tablaFleet(D: Calc): string {
  const fl = fleetUnits(D);
  const inp = (u: UnidadCalc, m: string, ph: string) => `<input class="c2-cell c2-cell--sm" id="c2f_${e(u.key)}_${m}" inputmode="decimal" placeholder="${ph}" value="${PS.c2.fleet[u.key + "|" + m] ?? ""}" data-act-change="c2Fleet" data-key="${e(u.key)}" data-m="${m}">`;
  const filas = fl.map(u => {
    const rs = FILAS.filter(f => f.clid === u.clid && f.city === u.city && f.fleet);
    const oc = rs.reduce((s, r) => s + r.oc, 0), tr = rs.reduce((s, r) => s + r.tr, 0);
    const sh = oc ? rs.reduce((s, r) => s + r.ish, 0) / oc : 0, ac = tr ? rs.reduce((s, r) => s + r.acc * r.tr, 0) / tr * 100 : 0;
    return `<tr>${partnerTd(u, D)}<td class="c2-num c2-muted">${sh.toFixed(1)}</td><td class="c2-num">${inp(u, "shcar", "meta")}</td><td class="c2-num c2-muted">${ac.toFixed(1)}%</td><td class="c2-num">${inp(u, "acc", "meta %")}</td><td class="c2-num">${inp(u, "util", "85")}</td></tr>`;
  }).join("");
  return `<div class="c2-tablewrap"><table class="c2-table">
    <thead><tr><th>Partner</th><th class="c2-num">SH/auto ago</th><th class="c2-num">Meta SH/auto</th><th class="c2-num">Aceptación ago</th><th class="c2-num">Meta aceptación</th><th class="c2-num">Meta utilización</th></tr></thead>
    <tbody>${filas || `<tr><td colspan="6" class="c2-empty">${e(PS.c2.kam)} no tiene partners Fleet.</td></tr>`}</tbody></table></div>`;
}

function pestanas(D: Calc, conResumen = true): string {
  const st = (ln: Ln) => estadoLinea(D, ln);
  const opts: any[] = [];
  if (conResumen) opts.push({ value: "total", label: "Total", icon: "activity" });
  opts.push({ value: "taxi", label: "Taxi", icon: "taxi", note: st("taxi").txt, noteTone: st("taxi").tone });
  opts.push({ value: "tk", label: "TukTuk", icon: "tuktuk", note: st("tk").txt, noteTone: st("tk").tone });
  opts.push({ value: "fleet", label: "Fleet", icon: "car", note: fleetEstado(D), noteTone: "neutral" });
  FUTURAS.forEach(f => opts.push({ value: f.id, label: f.nom, icon: f.ico, disabled: true, note: "pronto", noteTone: "neutral" }));
  return segmented({ ariaLabel: "Línea", act: "c2Tab", value: PS.c2.tab, options: opts });
}
function cuerpoTab(D: Calc): string {
  const t = PS.c2.tab;
  if (t === "fleet") return tablaFleet(D);
  if (t === "total") return tablaTotal(D);
  return tablaLinea(D, t as Ln);
}
const leyenda = `<div class="c2-legend"><span><i class="c2-sw c2-sw--fija"></i>fijado a mano: no se recalcula</span><span>Editar TukTuk no cambia Taxi: el total del partner es la suma.</span></div>`;

// ── P1 · Panel + pestañas por línea ─────────────────────────────────────────
function p1(D: Calc): string {
  const tabTit = PS.c2.tab === "total" ? "Total por partner" : PS.c2.tab === "fleet" ? "Metas Fleet" : `Metas ${LN_NOM[PS.c2.tab as Ln]}`;
  return `<div class="c2 c2-p1">
    <aside class="c2-card c2-side">
      <div class="c2-who">${kamSel()}${mesPill()}</div>
      <section class="c2-block"><div class="c2-h">Meta total del KAM ${tip("Taxi + TukTuk del mes, como la baja PnL. Se reparte por el peso de agosto de cada partner.")}</div>
        ${K3S.map(k => campoTotal(k, D)).join("")}</section>
      <section class="c2-block">${bloqueTk(D)}</section>
      <div class="c2-side__foot">${resumenLineas(D)}${acciones()}</div>
    </aside>
    <section class="c2-main">
      <div class="c2-main__head"><div><h2 class="c2-title">${tabTit}</h2><p class="c2-sub">${PS.c2.tab === "taxi" || PS.c2.tab === "tk" ? `Editable: una celda que cambies queda fijada y el resto de la línea se reparte solo` : `${D.us.length} partner-ciudad de ${e(PS.c2.kam)} · base agosto 2026`}</p></div></div>
      <div class="c2-tabs">${pestanas(D)}</div>
      ${PS.c2.tab === "taxi" || PS.c2.tab === "tk" ? leyenda : ""}
      <div class="c2-card c2-card--flush">${cuerpoTab(D)}</div>
    </section></div>`;
}

// ── P2 · Un indicador a la vez, Taxi y TukTuk lado a lado ──────────────────
function p2(D: Calc): string {
  const k = PS.c2.kpi;
  const vistaFleet = PS.c2.tab === "fleet";
  const selK = segmented({ ariaLabel: "Indicador", act: "c2Kpi", value: vistaFleet ? "fleet" : k, options: [
    ...K3S.map(x => ({ value: x, label: CORTO[x] === "AD" ? "Conductores activos" : CORTO[x] === "Horas" ? "Horas de conexión" : "Nuevos + reactivados" })),
    { value: "fleet", label: "Fleet", icon: "car", note: fleetEstado(D), noteTone: "neutral" }] as any });
  let tabla: string;
  if (vistaFleet) tabla = tablaFleet(D);
  else {
    const filas = D.us.map((u, i) => {
      const rTx = Math.max(0, u.base[k] - u.tk[k]), rTk = u.tk[k];
      const tot = (D.vals.taxi[k][i] || 0) + (D.vals.tk[k][i] || 0);
      return `<tr>${partnerTd(u, D)}
        <td class="c2-num c2-muted">${fmt(Math.round(rTx))}</td><td class="c2-num">${celda(D, i, "taxi", k)}</td>
        <td class="c2-num c2-muted c2-gsep">${rTk ? fmt(Math.round(rTk)) : "—"}</td><td class="c2-num">${celda(D, i, "tk", k)}</td>
        <td class="c2-num c2-gsep"><b>${fmt(tot)}</b></td><td class="c2-num">${cambio(tot, u.base[k])}</td></tr>`;
    }).join("");
    const tl = (ln: Ln) => {
      const g = D.goal[ln][k], s = D.suma[ln][k];
      return `<b>${fmt(s)}</b>${g != null ? `<span class="c2-de">de ${fmt(g)}</span>` : ""}${g != null && s !== g ? `<span class="c2-dif">${s > g ? "+" : "−"}${fmt(Math.abs(s - g))}</span>` : ""}`;
    };
    const totT = D.suma.taxi[k] + D.suma.tk[k];
    tabla = `<div class="c2-tablewrap"><table class="c2-table c2-table--grp">
      <thead><tr class="c2-grp"><th></th><th colspan="2">${iconSvg("taxi", { size: 13 })}Taxi</th><th colspan="2" class="c2-gsep">${iconSvg("tuktuk", { size: 13 })}TukTuk</th><th colspan="2" class="c2-gsep">Total del partner</th></tr>
      <tr><th>Partner</th><th class="c2-num">Real ago</th><th class="c2-num">Meta</th><th class="c2-num c2-gsep">Real ago</th><th class="c2-num">Meta</th><th class="c2-num c2-gsep">Meta</th><th class="c2-num">Cambio</th></tr></thead>
      <tbody>${filas}</tbody>
      <tfoot><tr><th>Total ${e(PS.c2.kam)}</th><td class="c2-num c2-muted">${fmt(D.baseTot.taxi[k])}</td><td class="c2-num">${tl("taxi")}</td><td class="c2-num c2-muted c2-gsep">${fmt(D.baseTot.tk[k])}</td><td class="c2-num">${tl("tk")}</td>
        <td class="c2-num c2-gsep"><b>${fmt(totT)}</b></td><td class="c2-num">${cambio(totT || null, D.baseTot.taxi[k] + D.baseTot.tk[k])}</td></tr></tfoot>
    </table></div>`;
  }
  return `<div class="c2 c2-p2">
    <aside class="c2-card c2-side">
      <div class="c2-who">${kamSel()}${mesPill()}</div>
      <section class="c2-block"><div class="c2-h">Meta total del KAM ${tip("Taxi + TukTuk del mes, como la baja PnL.")}</div>${K3S.map(x => campoTotal(x, D)).join("")}</section>
      <section class="c2-block">${bloqueTk(D)}</section>
      <div class="c2-side__foot">${resumenLineas(D)}${acciones()}</div>
    </aside>
    <section class="c2-main">
      <div class="c2-main__head"><div><h2 class="c2-title">${vistaFleet ? "Metas Fleet" : NOM[k]}</h2><p class="c2-sub">${vistaFleet ? "KPIs propios de los partners Fleet" : `Taxi y TukTuk lado a lado · total del partner = Taxi + TukTuk`}</p></div></div>
      <div class="c2-tabs">${selK}<span class="c2-futuras">${FUTURAS.map(f => `<span class="c2-futura" title="Cuando llegue la línea: otro par de columnas acá">${iconSvg(f.ico, { size: 13 })}${f.nom} · pronto</span>`).join("")}</span></div>
      ${vistaFleet ? "" : leyenda}
      <div class="c2-card c2-card--flush">${tabla}</div>
    </section></div>`;
}

// ── P3 · Líneas arriba como tarjetas, tabla a todo el ancho ─────────────────
function p3(D: Calc): string {
  const C = PS.c2;
  const cardLn = (ln: Ln) => {
    const st = estadoLinea(D, ln);
    const sel = C.tab === ln;
    return `<button type="button" class="c2-lcard${sel ? " is-sel" : ""}" data-act="c2Tab" data-value="${ln}">
      <span class="c2-lcard__h">${iconSvg(LN_ICO[ln], { size: 16 })}${LN_NOM[ln]}<span class="c2-pill c2-pill--${st.tone}">${st.txt}</span></span>
      <span class="c2-lcard__vals">${K3S.map(k => `<span><small>${CORTO[k]}</small><b>${num(D.goal[ln][k]) || "—"}</b></span>`).join("")}</span></button>`;
  };
  const cardFleet = `<button type="button" class="c2-lcard${C.tab === "fleet" ? " is-sel" : ""}" data-act="c2Tab" data-value="fleet">
      <span class="c2-lcard__h">${iconSvg("car", { size: 16 })}Fleet<span class="c2-pill c2-pill--neutral">${fleetEstado(D)}</span></span>
      <span class="c2-lcard__vals"><span><small>KPIs</small><b>SH/auto · acept. · util.</b></span></span></button>`;
  const futuras = FUTURAS.map(f => `<div class="c2-lcard c2-lcard--futura"><span class="c2-lcard__h">${iconSvg(f.ico, { size: 16 })}${f.nom}</span><span class="c2-lcard__vals"><span><small>próximamente</small></span></span></div>`).join("");
  const tabTit = C.tab === "fleet" ? "Metas Fleet" : C.tab === "total" ? "Total por partner" : `Metas ${LN_NOM[C.tab as Ln]} por partner`;
  return `<div class="c2 c2-p3">
    <div class="c2-card c2-top">
      <div class="c2-top__who">${kamSel()}${mesPill()}${acciones(false)}</div>
      <div class="c2-top__grid">
        <section class="c2-top__col"><div class="c2-h">Meta total del KAM ${tip("Taxi + TukTuk del mes, como la baja PnL.")}</div><div class="c2-top__goals">${K3S.map(k => campoTotal(k, D, true)).join("")}</div></section>
        <section class="c2-top__col c2-top__col--tk">${bloqueTk(D, true)}</section>
      </div>
    </div>
    <div class="c2-lcards">${cardLn("taxi")}${cardLn("tk")}${cardFleet}${futuras}</div>
    <div class="c2-main__head"><div><h2 class="c2-title">${tabTit}</h2><p class="c2-sub">${D.us.length} partner-ciudad · base agosto 2026 · edita una celda para fijarla</p></div>
      <button type="button" class="c2-link" data-act="c2Tab" data-value="total">${C.tab === "total" ? "" : "Ver total por partner →"}</button></div>
    <div class="c2-card c2-card--flush">${cuerpoTab(D)}</div>
  </div>`;
}

export function renderCalc2(): string {
  const D = calcular();
  return PS.c2.v === "p2" ? p2(D) : PS.c2.v === "p3" ? p3(D) : p1(D);
}
export function totalesCalc2() { return calcular(); }
