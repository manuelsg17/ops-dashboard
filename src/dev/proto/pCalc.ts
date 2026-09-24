// dev/proto/pCalc.ts — Calculadora en las 4 versiones del prototipo.
//
// Interactiva de verdad sobre el fixture: escribir una meta o tocar un atajo
// re-reparte en el acto (proporcional a la base de agosto, con resto mayor para
// que cuadre exacto) y editar una celda la FIJA: el resto se reparte entre las
// filas libres. No se escribe nada en ninguna parte.

import { escapeHTML as e } from "../../core/security";
import { fmt, hashColor } from "../../core/format";
import { iconSvg } from "../../shared/icons";
import { segmented, badge } from "../../shared/ui";
import { PS } from "./state";
import { unidadesCalc, repartir, KAMS, cityLabel, pct1, SEMANAS, d2s, FILAS, type UnidadCalc } from "./model";
import { spark, ring, dot } from "./bits";

type K3 = "ad" | "sh" | "nr";
const K3: K3[] = ["ad", "sh", "nr"];                 // orden de la app: AD / Horas / N+R
const NOM: Record<K3, string> = { ad: "Conductores activos", sh: "Horas de conexión", nr: "Nuevos + Reactivados" };
const COL: Record<K3, string> = { ad: "Meta AD", sh: "Meta SH", nr: "Meta N+R" };
const ATAJOS: [string, number | null][] = [["+5%", 1.05], ["+10%", 1.10], ["+15%", 1.15], ["Igual que agosto", 1]];

export interface Dist { us: UnidadCalc[]; vals: Record<K3, (number | null)[]>; tk: Record<K3, (number | null)[]>; base: Record<K3, number>; suma: Record<K3, number> }
export function dist(): Dist {
  const C = PS.calc;
  const us = unidadesCalc(C.kam);
  const vals = {} as Dist["vals"], tk = {} as Dist["tk"], base = {} as Dist["base"], suma = {} as Dist["suma"];
  K3.forEach(k => {
    base[k] = Math.round(us.reduce((s, u) => s + u.base[k], 0));
    const g = C.goals[k];
    const fij = us.map(u => C.fijos[u.key]?.[k] ?? null);
    vals[k] = g == null ? us.map((_, i) => fij[i]) : repartir(g, us.map(u => u.base[k]), fij);
    suma[k] = vals[k].reduce((s, v) => s + (v || 0), 0);
    const pct = parseFloat(String(C.tkPct[k]).replace(",", "."));
    tk[k] = g != null && pct > 0 ? repartir(Math.round(g * pct / 100), us.map(u => u.tk[k]), us.map(() => null)) : us.map(() => null);
  });
  return { us, vals, tk, base, suma };
}
const num = (v: number | null) => v == null ? "" : fmt(v);
const cambio = (a: number | null, b: number) => a == null || !b ? `<span class="pr-muted">—</span>` :
  `<span class="calc-tone--${a >= b ? "ok" : "bad"} pr-cambio">${a >= b ? "+" : "−"}${Math.abs((a - b) / b * 100).toFixed(1)}%</span>`;

function hint(k: K3, D: Dist): string {
  const g = PS.calc.goals[k], b = D.base[k];
  const v = g != null && b ? ` (${g >= b ? "+" : "−"}${Math.abs((g - b) / b * 100).toFixed(1)}%)` : "";
  return `En agosto ${e(PS.calc.kam)} tuvo ${fmt(b)}${v}`;
}
function cuadre(D: Dist): string {
  const CORTO: Record<K3, string> = { ad: "AD", sh: "Horas", nr: "N+R" };
  const cargadas = K3.filter(k => PS.calc.goals[k] != null);
  const malas = cargadas.filter(k => D.suma[k] !== PS.calc.goals[k]);
  if (!cargadas.length) return `<div class="pr-cuadre pr-cuadre--none">${iconSvg("minus", { size: 14 })}<span>Carga al menos una meta para ver el reparto.</span></div>`;
  const items = K3.map(k => PS.calc.goals[k] == null ? `<span class="pr-muted">${CORTO[k]}: sin meta</span>`
    : `<span>${CORTO[k]} <b>${fmt(D.suma[k])}</b> / ${fmt(PS.calc.goals[k] as number)}</span>`).join(" · ");
  return malas.length
    ? `<div class="pr-cuadre pr-cuadre--warn">${iconSvg("alert-triangle", { size: 14 })}<span>No cuadra: ${items}. Lo fijado a mano supera la meta de ${malas.map(k => CORTO[k]).join(", ")}.</span></div>`
    : `<div class="pr-cuadre pr-cuadre--ok">${iconSvg("check-circle", { size: 14 })}<span>Cuadra ✓ ${items}</span></div>`;
}
function goalField(k: K3, D: Dist, cls = "pr-goal"): string {
  const g = PS.calc.goals[k];
  return `<div class="${cls}"><label class="ui-field__label" for="prG_${k}">${NOM[k]}</label>
    <input class="ui-input ui-num pr-goal__in" id="prG_${k}" inputmode="numeric" placeholder="p. ej. ${fmt(Math.round(D.base[k] * 1.1))}" value="${num(g)}" data-act-input="prCalcGoal" data-k="${k}">
    <div class="pr-goal__chips">${ATAJOS.map(([l, f]) => `<button type="button" class="pr-qchip" data-act="prCalcAtajo" data-k="${k}" data-f="${f}">${l}</button>`).join("")}</div>
    <div class="ui-field__hint" id="prGh_${k}">${hint(k, D)}</div></div>`;
}
function avanzados(): string {
  const C = PS.calc;
  return `<details class="pr-adv"${C.avanzados ? " open" : ""} data-act-toggle-x="1"><summary data-act="prCalcAdv">Ajustes avanzados</summary><div class="pr-adv__body">
    <div class="ui-field__label">% TukTuk declarado <span class="pr-muted">(opcional, lo baja PnL)</span></div>
    <div class="pr-tkpct">${K3.map(k => `<label class="pr-tkpct__f"><span>${k === "ad" ? "AD" : k === "sh" ? "SH" : "N+R"}</span><span class="calc-suffix"><input class="ui-input ui-input--sm ui-num" value="${e(C.tkPct[k])}" placeholder="0" data-act-change="prCalcTk" data-k="${k}"><span class="calc-suffix__txt">%</span></span></label>`).join("")}</div>
    <div class="ui-field__hint">Si lo declaras, cada meta se parte en Taxi y TukTuk con ese %. Sin declarar no se toca nada.</div>
    <div class="ui-field__label" style="margin-top:var(--space-3)">Cómo guardar</div>
    <label class="pr-radio"><input type="radio" name="prModo" ${C.modo === "edits" ? "checked" : ""} data-act-change="prCalcModo" data-value="edits"><span><b>Solo lo que cambié</b><br><small>Escribe solo las celdas distintas de lo guardado.</small></span></label>
    <label class="pr-radio"><input type="radio" name="prModo" ${C.modo === "full" ? "checked" : ""} data-act-change="prCalcModo" data-value="full"><span><b>Reparto completo</b><br><small>Reescribe la meta de todos los partners del reparto.</small></span></label>
  </div></details>`;
}
const acciones = () => `<div class="pr-calc__actions"><button type="button" class="ui-btn ui-btn--primary" data-act="prCalcGuardar">${iconSvg("save", { size: 16 })}<span>Guardar metas</span></button>
  <button type="button" class="ui-btn ui-btn--secondary" data-act="prToast" data-msg="Abriría las tarjetas compartibles por partner (ES / EN / RU)">${iconSvg("image", { size: 16 })}<span>Tarjetas para partners</span></button></div>`;
const kamSel = (cls = "ui-select") => `<select class="${cls}" id="prCalcKam" data-act-change="prCalcKam">${KAMS.map(k => `<option value="${k}"${k === PS.calc.kam ? " selected" : ""}>${k}</option>`).join("")}</select>`;
const mesTxt = `<div class="calc-mes">${iconSvg("calendar", { size: 16 })}<span class="calc-mes__val">Septiembre 2026</span><span class="calc-mes__sub">reparto según Agosto 2026</span></div>`;

// ── Tabla de reparto (compartida; el marcado cambia por clase) ─────────────
export function tablaReparto(D: Dist, cls = "ui-table-wrap pr-dist-wrap"): string {
  const C = PS.calc;
  if (C.vista === "fleet") {
    const fl = D.us.filter(u => u.fleet);
    return `<div class="${cls}"><table class="ui-table pr-dist"><thead><tr><th>Partner</th><th>Ciudad</th><th class="ui-num">SH/Auto (3m)</th><th class="ui-num">Meta SH/Auto</th><th class="ui-num">Aceptación (3m)</th><th class="ui-num">Meta acept. %</th><th class="ui-num">Meta utiliz. %</th></tr></thead><tbody>` +
      (fl.map(u => { const rs = FILAS.filter(f => f.clid === u.clid && f.city === u.city && f.fleet); const oc = rs.reduce((s, r) => s + r.oc, 0), tr = rs.reduce((s, r) => s + r.tr, 0);
        const sh = oc ? rs.reduce((s, r) => s + r.ish, 0) / oc : 0, ac = tr ? rs.reduce((s, r) => s + r.acc * r.tr, 0) / tr * 100 : 0;
        return `<tr><th class="calc-cell-partner">${e(u.partner)} ${badge("Fleet", "neutral", { icon: "car" })}</th><td>${cityLabel(u.city)}</td><td class="ui-num">${sh.toFixed(1)}</td>
        <td class="ui-num"><input class="ui-input ui-input--sm ui-num pr-cell" placeholder="meta" data-act-change="prToastIn" data-msg="Meta SH/Auto guardada en el borrador"></td><td class="ui-num">${pct1(ac)}</td>
        <td class="ui-num"><input class="ui-input ui-input--sm ui-num pr-cell" placeholder="meta %"></td><td class="ui-num"><input class="ui-input ui-input--sm ui-num pr-cell" value="85"></td></tr>`; }).join("") ||
        `<tr><td colspan="7" class="pr-muted">${e(C.kam)} no tiene partners Fleet.</td></tr>`) + `</tbody></table></div>`;
  }
  const rows = D.us.map((u, i) => {
    const f = C.fijos[u.key] || {};
    const manual = Object.keys(f).length > 0;
    const cell = (k: K3) => {
      const v = D.vals[k][i], tkv = D.tk[k][i];
      return `<td class="ui-num${f[k] != null ? " pr-cell--fija" : ""}"><input class="ui-input ui-input--sm ui-num pr-cell" value="${num(v)}" placeholder="—" aria-label="${COL[k]} de ${e(u.partner)} ${cityLabel(u.city)}" data-act-change="prCalcCell" data-key="${e(u.key)}" data-k="${k}">` +
        (tkv ? `<div class="calc-tk-sub">TukTuk ${fmt(tkv)}</div>` : "") + `</td>`;
    };
    return `<tr class="${manual ? "calc-row--manual pr-row--fija" : ""}"><th class="calc-cell-partner"><div class="pr-dist__p">${dot(hashColor(u.partner))}<span>${e(u.partner)}</span></div>
      <div class="pr-dist__tags">${u.fleet ? badge("Fleet", "neutral", { icon: "car" }) : ""}${u.tieneMeta ? badge("Ya tiene meta", "info") : ""}${manual ? `<button type="button" class="ui-link-btn pr-soltar" data-act="prCalcSoltar" data-key="${e(u.key)}">Soltar</button>` : ""}</div></th>
      <td class="calc-cell-city">${cityLabel(u.city)}</td>${cell("ad")}<td class="ui-num">${fmt(u.base.ad)}</td><td class="ui-num">${cambio(D.vals.ad[i], u.base.ad)}</td>${cell("sh")}${cell("nr")}</tr>`;
  }).join("");
  const tot = `<tr class="pr-dist__tot"><th>Total ${e(C.kam)}</th><td></td><td class="ui-num">${fmt(D.suma.ad)}</td><td class="ui-num">${fmt(D.base.ad)}</td><td class="ui-num">${cambio(D.suma.ad || null, D.base.ad)}</td><td class="ui-num">${fmt(D.suma.sh)}</td><td class="ui-num">${fmt(D.suma.nr)}</td></tr>`;
  return `<div class="${cls}"><table class="ui-table pr-dist"><thead><tr><th>Partner</th><th>Ciudad</th><th class="ui-num">Meta AD</th><th class="ui-num">Real ago</th><th class="ui-num">Cambio</th><th class="ui-num">Meta SH</th><th class="ui-num">Meta N+R</th></tr></thead><tbody>${rows}${tot}</tbody></table></div>`;
}
function referencia(D: Dist): string {
  const tot = D.base.ad || 1;
  return `<details class="pr-adv pr-ref"${PS.calc.refAbierta ? " open" : ""}><summary data-act="prCalcRef">Ver referencia · % de la cartera y promedio de 3 meses</summary><div class="pr-adv__body">
    <table class="ui-table pr-dist pr-dist--ref"><thead><tr><th>Partner</th><th>Ciudad</th><th class="ui-num">% cartera (AD)</th><th class="ui-num">AD ago</th><th class="ui-num">N+R ago</th><th class="ui-num">Horas ago</th><th>Últimas 8 semanas</th></tr></thead><tbody>` +
    D.us.map(u => `<tr><th>${e(u.partner)}</th><td>${cityLabel(u.city)}</td><td class="ui-num">${pct1(u.base.ad / tot * 100)}</td><td class="ui-num">${fmt(u.base.ad)}</td><td class="ui-num">${fmt(u.base.nr)}</td><td class="ui-num">${fmt(Math.round(u.base.sh))}</td><td>${spark(u.semanas, 96, 20)}</td></tr>`).join("") +
    `</tbody></table></div></details>`;
}
const vistaToggle = () => segmented({ ariaLabel: "Tabla", act: "prCalcVista", value: PS.calc.vista, options: [{ value: "agg", label: "Agregador", icon: "taxi" }, { value: "fleet", label: "Fleet", icon: "car" }] });
const leyenda = `<span class="pr-legend"><span class="pr-legend__sw"></span>fijado a mano: el resto se reparte entre las demás filas</span>`;

// ── ELEGIDA: C + atajos de B ───────────────────────────────────────────────
function elegida(D: Dist): string {
  return `<div class="pr-calc">
    <aside class="pr-calc__side ui-card">
      <div class="pr-calc__who"><div class="ui-field"><label class="ui-field__label" for="prCalcKam">KAM</label>${kamSel()}</div>
        <div class="ui-field"><span class="ui-field__label">Mes</span>${mesTxt}</div></div>
      <div class="pr-calc__block"><div class="pr-calc__h">Metas del mes</div>${K3.map(k => goalField(k, D)).join("")}</div>
      ${avanzados()}
      <div class="pr-calc__block" id="prCuadre">${cuadre(D)}</div>
      ${acciones()}
    </aside>
    <section class="pr-calc__main">
      <div class="pr-calc__mainhead"><div><h2 class="rd-sec__title">Reparto entre los partners de ${e(PS.calc.kam)}</h2>
        <div class="rd-sec__sub">${D.us.length} partner-ciudad · proporcional a su peso de agosto · edita una celda para fijarla</div></div>${vistaToggle()}</div>
      ${PS.calc.vista === "agg" ? leyenda : ""}
      <div id="prDist">${tablaReparto(D)}</div>
      ${referencia(D)}
    </section></div>`;
}

// ── A · LIENZO ABIERTO ─────────────────────────────────────────────────────
function versionA(D: Dist): string {
  return `<div class="pr-a pr-calc-a">
    <div class="pr-a-h"><div><h2>Metas de ${kamSel("ui-select pr-a-inline")} para Septiembre 2026</h2><p>Se reparten entre sus partners según su peso de agosto.</p></div></div>
    <div class="pr-a-goals">${K3.map(k => goalField(k, D, "pr-a-goal")).join("")}</div>
    <div class="pr-a-cuadre" id="prCuadre">${cuadre(D)}</div>
    <div class="pr-a-h"><div><h2>Reparto</h2><p>${leyenda}</p></div>${vistaToggle()}</div>
    <div id="prDist">${tablaReparto(D, "pr-a-table")}</div>
    ${referencia(D)}${avanzados()}
    <div class="pr-a-foot">${acciones()}</div></div>`;
}

// ── B · SUAVE: un paso a la vez, con vista previa en vivo ──────────────────
function versionB(D: Dist): string {
  const C = PS.calc;
  const pasos = ["¿Para qué KAM?", "Conductores activos", "Horas de conexión", "Nuevos + Reactivados", "Revisa y guarda"];
  const p = C.paso;
  let q = "";
  if (p === 0) q = `<div class="pr-b-q__t">¿Para qué KAM armas las metas de septiembre?</div><div class="pr-b-kams">${KAMS.map(k => `<button type="button" class="pr-b-kam" aria-pressed="${C.kam === k}" data-act="prCalcKamBtn" data-value="${k}">${e(k)}</button>`).join("")}</div>`;
  else if (p <= 3) {
    const k = K3[p - 1];
    q = `<div class="pr-b-q__t">¿Cuál es la meta de ${NOM[k].toLowerCase()} de ${e(C.kam)} para septiembre?</div>
      <input class="ui-input ui-num pr-b-big" id="prG_${k}" inputmode="numeric" value="${num(C.goals[k])}" placeholder="${fmt(Math.round(D.base[k] * 1.1))}" data-act-input="prCalcGoal" data-k="${k}">
      <div class="pr-goal__chips">${ATAJOS.map(([l, f]) => `<button type="button" class="pr-qchip" data-act="prCalcAtajo" data-k="${k}" data-f="${f}">${l}</button>`).join("")}</div>
      <div class="ui-field__hint" id="prGh_${k}">${hint(k, D)}</div>`;
  } else q = `<div class="pr-b-q__t">Todo listo. Revisa el cuadre y guarda.</div><div id="prCuadre">${cuadre(D)}</div>${avanzados()}${acciones()}`;
  const k = p >= 1 && p <= 3 ? K3[p - 1] : "ad";
  const vals = D.vals[k];
  const max = Math.max(1, ...vals.map(v => v || 0), ...D.us.map(u => u.base[k]));
  const prev = `<div class="pr-b-prev"><div class="pr-b-prev__h">Vista previa · ${NOM[k]}</div>${D.us.map((u, i) => `<div class="pr-b-bar"><span class="pr-b-bar__n">${e(u.partner)} <small>${cityLabel(u.city)}</small></span>
    <span class="pr-b-bar__track"><span class="pr-b-bar__base" style="width:${(u.base[k] / max * 100).toFixed(1)}%"></span><span class="pr-b-bar__fill" style="width:${((vals[i] || 0) / max * 100).toFixed(1)}%"></span></span>
    <span class="pr-b-bar__v">${vals[i] == null ? "—" : fmt(vals[i])}</span></div>`).join("")}<div class="pr-b-prev__leg"><span class="pr-b-bar__base pr-b-leg"></span>agosto <span class="pr-b-bar__fill pr-b-leg"></span>meta</div></div>`;
  return `<div class="pr-b pr-calc-b"><div class="pr-b-steps">${pasos.map((s, i) => `<button type="button" class="pr-b-step${i === p ? " is-cur" : i < p ? " is-done" : ""}" data-act="prCalcPaso" data-value="${i}"><span>${i < p ? iconSvg("check", { size: 12 }) : i + 1}</span>${s}</button>`).join("")}</div>
    <div class="pr-b-grid2 pr-b-grid2--calc"><div class="pr-b-q">${q}
      <div class="pr-b-nav">${p > 0 ? `<button type="button" class="ui-btn ui-btn--ghost" data-act="prCalcPaso" data-value="${p - 1}">${iconSvg("chevron-left", { size: 16 })}<span>Atrás</span></button>` : "<span></span>"}
      ${p < 4 ? `<button type="button" class="ui-btn ui-btn--secondary" data-act="prCalcPaso" data-value="${p + 1}"><span>Siguiente</span>${iconSvg("chevron-right", { size: 16 })}</button>` : ""}</div></div>
    <div id="prDist">${prev}</div></div>
    ${p === 4 ? `<h2 class="pr-b-h">Reparto final</h2>${tablaReparto(D, "pr-b-table")}` : ""}</div>`;
}

// ── C · MESA DE TRABAJO ────────────────────────────────────────────────────
function versionC(D: Dist): string {
  const C = PS.calc;
  const sel = D.us.find(u => u.key === C.sel) || D.us[0];
  const i = D.us.indexOf(sel);
  const bar = `<div class="pr-c-goalbar">${`<label class="pr-c-goalbar__kam">KAM ${kamSel("ui-select ui-select--sm")}</label>`}${K3.map(k => `<label class="pr-c-goalbar__f"><span>${COL[k]}</span><input class="ui-input ui-input--sm ui-num" id="prG_${k}" value="${num(C.goals[k])}" data-act-input="prCalcGoal" data-k="${k}"></label>`).join("")}
    <div class="pr-c-goalbar__st" id="prCuadre">${cuadre(D)}</div>${acciones()}</div>`;
  const list = `<div class="pr-c-list"><div class="pr-c-list__head"><span>${D.us.length} partner-ciudad</span>${vistaToggle()}</div><div class="pr-c-list__body" id="prDist">${D.us.map((u, j) =>
    `<button type="button" class="pr-c-row${u === sel ? " is-sel" : ""}${C.fijos[u.key] ? " pr-row--fija" : ""}" data-act="prCalcSel" data-key="${e(u.key)}"><span class="pr-c-row__name">${dot(hashColor(u.partner))}<span>${e(u.partner)}</span></span><span class="pr-c-row__kam">${cityLabel(u.city)}</span>
     ${spark(u.semanas, 60, 18)}<span class="pr-c-row__num">${D.vals.ad[j] == null ? "—" : fmt(D.vals.ad[j])}</span><span class="pr-c-row__d">${cambio(D.vals.ad[j], u.base.ad)}</span></button>`).join("")}</div></div>`;
  const det = sel ? `<div class="pr-c-detail"><div class="pr-c-detail__head"><div><div class="pr-c-detail__name">${dot(hashColor(sel.partner))}${e(sel.partner)} <span class="pr-muted">· ${cityLabel(sel.city)}</span></div>
    <div class="pr-c-detail__meta">${sel.fleet ? "Fleet · " : ""}${sel.tieneMeta ? "ya tiene meta de septiembre" : "sin meta de septiembre"} · peso ${pct1(sel.base.ad / (D.base.ad || 1) * 100)} de la cartera</div></div>
    ${C.fijos[sel.key] ? `<button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" data-act="prCalcSoltar" data-key="${e(sel.key)}">Soltar (volver al reparto)</button>` : ""}</div>
    <table class="ui-table pr-c-table"><thead><tr><th>Indicador</th><th class="ui-num">Agosto</th><th class="ui-num">Meta sept.</th><th class="ui-num">Cambio</th></tr></thead><tbody>${K3.map(k =>
      `<tr><td>${NOM[k]}</td><td class="ui-num">${fmt(Math.round(sel.base[k]))}</td><td class="ui-num${C.fijos[sel.key]?.[k] != null ? " pr-cell--fija" : ""}"><input class="ui-input ui-input--sm ui-num pr-cell" value="${num(D.vals[k][i])}" data-act-change="prCalcCell" data-key="${e(sel.key)}" data-k="${k}"></td><td class="ui-num">${cambio(D.vals[k][i], sel.base[k])}</td></tr>`).join("")}</tbody></table>
    <div class="pr-c-panel pr-c-panel--flat"><div class="pr-c-panel__t">Conductores activos · últimas 8 semanas (${d2s(SEMANAS[0])} – ${d2s(SEMANAS[SEMANAS.length - 1])})</div>${spark(sel.semanas, 520, 80)}</div>
    ${leyenda}${avanzados()}</div>` : "";
  const detalle = C.vista === "fleet" ? `<div class="pr-c-detail"><div class="pr-c-panel__t">Metas Fleet (KPIs propios)</div>${tablaReparto(D, "pr-c-table")}</div>` : det;
  return `<div class="pr-c pr-calc-c">${bar}<div class="pr-c-split">${list}${detalle}</div></div>`;
}

export function renderCalc(): string {
  const D = dist();
  return PS.v === "a" ? versionA(D) : PS.v === "b" ? versionB(D) : PS.v === "c" ? versionC(D) : elegida(D);
}

/** Refresco parcial al tipear una meta (no se pierde el foco del input). */
export function refrescarCalc(): boolean {
  if (PS.v === "c" || PS.v === "b") return false;       // B/C repintan entero (sin inputs dentro de la zona que cambia)
  const D = dist();
  const t = document.getElementById("prDist"); if (t) t.innerHTML = tablaReparto(D, PS.v === "a" ? "pr-a-table" : "ui-table-wrap pr-dist-wrap");
  const c = document.getElementById("prCuadre"); if (c) c.innerHTML = cuadre(D);
  K3.forEach(k => { const h = document.getElementById("prGh_" + k); if (h) h.innerHTML = hint(k, D); });
  return true;
}
export { ring };
