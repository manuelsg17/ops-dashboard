// dev/proto/pMetas.ts — Metas en las 4 versiones del prototipo.

import { escapeHTML as e } from "../../core/security";
import { fmt, fmtSmart, hashColor } from "../../core/format";
import { iconSvg } from "../../shared/icons";
import { segmented, alertBox, badge } from "../../shared/ui";
import { buildLineChart } from "../../charts";
import { chartTokens, seriesColor } from "../../shared/chartTheme";
import { PS } from "./state";
import { modeloMetas, mesLargo, mesNombre, cityLabel, MESES_META, CIUDADES, KAMS, pct1, FILAS, metasDelMes, partnerDe, SEMANAS, mesDeSemana, d2s, type ModeloMetas, type UnidadMeta } from "./model";
import { dot, catVar, bar, ring, toneTxt, tone, dlPct, spark } from "./bits";

type K3 = "ad" | "nr" | "sh";
const K3: K3[] = ["ad", "nr", "sh"];
const NOM: Record<K3, string> = { ad: "Active Drivers", nr: "Nuevos + React", sh: "Horas Conexión" };
const fv = (k: K3, v: number | null) => v == null ? "—" : k === "sh" ? fmtSmart(v) : fmt(Math.round(v));
const fproj = (k: K3, v: number) => k === "sh" ? fmtSmart(v) : fmt(Math.round(v * 10) / 10);
const LINEAS = [
  { value: "comb", label: "Combinado", icon: "activity" as const }, { value: "agg", label: "Agregador", icon: "taxi" as const },
  { value: "fleet", label: "Fleet", icon: "car" as const }, { value: "tk", label: "TukTuk", icon: "tuktuk" as const }
];
let M: ModeloMetas;

function controles(primarioCls = "ui-btn ui-btn--primary"): string {
  const mesSel = `<label class="mt-field"><span class="mt-field__label">Mes de la meta</span><select class="ui-select ui-select--sm" data-act-change="prMetasMes">${MESES_META.map(ym =>
    `<option value="${ym}"${ym === PS.metasMes ? " selected" : ""}>${mesLargo(ym)}</option>`).join("")}</select></label>`;
  const menu = `<div class="mt-menu-wrap"><button type="button" class="ui-btn ui-btn--ghost ui-btn--icon mt-menu-btn" data-act="prMenu" data-value="metas" aria-haspopup="true" aria-expanded="${PS.menu === "metas"}" title="Más acciones"><span>⋯</span></button>
    <div class="mt-menu"${PS.menu === "metas" ? "" : " hidden"}><button type="button" class="mt-menu__item" data-act="prToast" data-msg="Descargaría el CSV de metas">${iconSvg("download", { size: 14 })}<span>Descargar CSV de metas</span></button>
    <button type="button" class="mt-menu__item mt-menu__item--danger" data-act="prBorrarMetas">${iconSvg("trash", { size: 14 })}<span>Eliminar metas de ${mesLargo(PS.metasMes)}</span></button></div></div>`;
  return `<div class="mt-controls"><div class="mt-controls__left">${segmented({ ariaLabel: "Línea de negocio", act: "prMetasLine", value: PS.metasLine, options: LINEAS }).replace('class="ui-segmented"', 'class="ui-segmented mt-lines"')}${mesSel}</div>
    <div class="mt-controls__right"><button type="button" class="${primarioCls}" data-act="prPdf">${iconSvg("download", { size: 16 })}<span>Descargar PDF</span></button>${menu}</div></div>`;
}
function avisos(): string {
  const out = [];
  if (PS.F.escala !== "mensual") out.push(alertBox({ tone: "warn", title: "El % de cumplimiento no es comparable en esta escala", text: "La meta es mensual y Conductores activos se mide en una semana, así que su % sale bajo aunque el mes vaya bien. N+R y Horas sí acumulan. Para el cumplimiento real, cambia a escala Mensual." }));
  if (M.nSinMeta) out.push(alertBox({ tone: "info", title: `${M.nSinMeta} cuentas operaron sin meta en ${mesNombre(M.ym)}`, text: "Su actual suma al total (por eso cuadra con Rendimiento), pero no a la meta: el % de cumplimiento queda algo más alto. Cárgales la meta en la Calculadora." }));
  return out.length ? `<div class="mt-alerts">${out.join("")}</div>` : "";
}
const pais = (k: K3) => M.pais.find(p => p.k === k)!.a;
function kpiResumen(k: K3): string {
  const a = pais(k);
  if (!a) return "";
  return `<div class="ui-kpi mt-kpi"><div class="ui-kpi__label">${NOM[k]} <span class="mt-kpi__sub">· ${k === "ad" ? "último período" : "acumulado"}</span></div>
    <div class="ui-kpi__row"><span class="ui-kpi__value">${fv(k, a.actual)}</span><span class="ui-kpi__delta">${dlPct(M.deltaPais[k])}<span class="ui-kpi__prev">vs ${mesNombre(M.ymPrev)} al mismo punto</span></span></div>
    <div class="ui-kpi__goal">${bar(a.pct, a.projPct, "mt-bar")}
      <div class="ui-kpi__caption">${toneTxt(a.pct)} de la meta de ${mesNombre(M.ym)} (${fv(k, a.meta)})</div>
      <div class="ui-kpi__caption mt-proj">Proyección al cierre: <strong>${fproj(k, a.proj)}</strong> (${toneTxt(a.projPct)})</div></div></div>`;
}
function tablaGrupo(titulo: string, grupos: any[], color: (g: string) => string, cls = "ui-table-wrap"): string {
  return `<div class="${cls}"><table class="ui-table mt-gtable"><thead><tr><th>${titulo}</th><th>Indicador</th><th class="ui-num">Actual</th><th class="ui-num">Meta</th><th>% meta</th><th class="ui-num">Proyección</th></tr></thead><tbody>` +
    grupos.map(g => g.kp.map((kp, i) => `<tr${i === 0 ? ` class="mt-grp-first"` : ""}>` +
      (i === 0 ? `<th class="mt-ent" rowspan="3"><div class="mt-ent__name"><span class="mt-dot" style="background:${color(g.g)}"></span>${e(titulo === "Ciudad" ? cityLabel(g.g) : g.g)}</div><div class="mt-sub">${g.n} cuentas</div></th>` : "") +
      `<td class="mt-kpiname">${NOM[kp.k]}</td><td class="ui-num">${fv(kp.k, kp.actual)}</td><td class="ui-num">${kp.meta ? fv(kp.k, kp.meta) : "—"}</td>
       <td class="mt-pctcell"><div class="mt-pctwrap">${kp.meta ? badge(pct1(kp.pct), tone(kp.pct) as any) : `<span class="mt-muted">—</span>`}${kp.meta ? bar(kp.pct, kp.projPct, "mt-bar") : ""}</div></td>
       <td class="ui-num">${kp.meta ? `${fproj(kp.k, kp.proj)} <span class="mt-sub">(${pct1(kp.projPct)})</span>` : "—"}</td></tr>`).join("")).join("") + `</tbody></table></div>`;
}
const ESTADOS = [["todos", "Todos"], ["bajo", "Bajo meta"], ["en", "En meta"], ["sobre", "Sobre meta"], ["sin", "Sin meta"]] as const;
function unidadesFiltradas(): UnidadMeta[] {
  const us = M.unidades.filter(u => PS.metasFiltro === "todos" || u.estado === PS.metasFiltro);
  const { col, dir } = PS.metasSort, s = dir === "asc" ? 1 : -1;
  const val = (u: UnidadMeta) => col === "partner" ? u.partner : col === "city" ? u.city : col === "kam" ? u.kam : col === "peor" ? (u.peor ?? 9999)
    : col.endsWith("_pct") ? (u.pct[col.slice(0, 2)] ?? -1) : col.endsWith("_meta") ? (u.meta[col.slice(0, 2)] ?? -1) : (u.act[col.slice(0, 2)] ?? 0);
  return us.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number)) * s; });
}
function chips(cls = "mt-fchips", chipCls = "mt-fchip"): string {
  const cnt: Record<string, number> = { todos: M.unidades.length, bajo: 0, en: 0, sobre: 0, sin: 0 };
  M.unidades.forEach(u => cnt[u.estado]++);
  return `<div class="${cls}">${ESTADOS.map(([k, l]) => `<button type="button" class="${chipCls} mt-fchip--${k}" aria-pressed="${PS.metasFiltro === k}" data-act="prMetasFiltro" data-value="${k}">` +
    (k === "todos" ? "" : `<span class="mt-fchip__dot"></span>`) + `<span>${l}</span><span class="mt-fchip__n">${cnt[k]}</span></button>`).join("")}</div>`;
}
function sortTh(col: string, label: string, cls = "") {
  const on = PS.metasSort.col === col;
  return `<th class="${cls}" aria-sort="${on ? (PS.metasSort.dir === "asc" ? "ascending" : "descending") : "none"}"><button type="button" class="mt-sortbtn" data-act="prMetasSort" data-col="${col}">${label}${on ? iconSvg(PS.metasSort.dir === "asc" ? "arrow-up" : "arrow-down", { size: 12 }) : ""}</button></th>`;
}
function tablaPartners(wrap = "ui-table-wrap mt-ptable-wrap"): string {
  const us = unidadesFiltradas();
  if (!us.length) return `<div class="mt-filtro-vacio">Ningún partner en este filtro.</div>`;
  const head1 = `<tr>${sortTh("partner", "Partner", "mt-sticky")}${sortTh("city", "Ciudad")}${sortTh("kam", "KAM")}${K3.map(k => `<th class="mt-grp" colspan="3">${NOM[k]}</th>`).join("")}</tr>`;
  const head2 = `<tr><th class="mt-sticky"></th><th></th><th></th>${K3.map(k => sortTh(k + "_act", "Actual", "ui-num mt-grp-start") + sortTh(k + "_meta", "Meta", "ui-num") + sortTh(k + "_pct", "% meta")).join("")}</tr>`;
  const rows = us.map(u => `<tr${u.sinMeta ? ` class="mt-row--sinmeta"` : ""}><th class="mt-pname mt-sticky"><span class="mt-dot" style="background:${hashColor(u.partner)}"></span><span class="mt-pname__txt">${e(u.partner)}</span>${u.sinMeta ? badge("Sin meta", "neutral") : ""}</th>
    <td class="mt-nowrap">${cityLabel(u.city)}</td><td class="mt-nowrap">${e(u.kam)}</td>` +
    K3.map(k => `<td class="ui-num">${fv(k, u.act[k])}</td><td class="ui-num">${u.meta[k] ? fv(k, u.meta[k]) : "—"}</td><td class="mt-pctcell">${u.meta[k] ? badge(pct1(u.pct[k]), tone(u.pct[k]) as any) : `<span class="mt-muted">—</span>`}</td>`).join("") + `</tr>`).join("");
  return `<div class="${wrap}"><table class="ui-table mt-ptable"><thead>${head1}${head2}</thead><tbody>${rows}</tbody></table></div>`;
}
function tarjetas(): string {
  return `<div class="mt-pgrid">${unidadesFiltradas().map(u => `<div class="mt-pcard${u.sinMeta ? " mt-pcard--sinmeta" : ""}"><div class="mt-pname"><span class="mt-dot" style="background:${hashColor(u.partner)}"></span><span class="mt-pname__txt">${e(u.partner)}</span></div>
    <div class="mt-pcard__sub">${cityLabel(u.city)} · ${e(u.kam)}${u.sinMeta ? " · sin meta" : ""}</div>` +
    K3.map(k => `<div class="mt-pk"><div class="mt-pk__top"><span class="mt-pk__label">${NOM[k]}</span><span class="mt-pk__val">${u.meta[k] ? toneTxt(u.pct[k]) : "—"}</span></div>
      ${u.meta[k] ? bar(u.pct[k], null, "mt-bar") : ""}<div class="mt-pk__nums"><strong>${fv(k, u.act[k])}</strong> de ${u.meta[k] ? fv(k, u.meta[k]) : "—"}</div></div>`).join("") + `</div>`).join("")}</div>`;
}

// ── Fleet (KPIs propios; misma estructura simplificada) ────────────────────
function fleetUnidades() {
  const ult = M.ult;
  return metasDelMes(PS.metasMes).filter(m => m.shAuto != null || m.acc != null || m.util != null).map(m => {
    const p = partnerDe(m.clid);
    const rs = FILAS.filter(f => f.clid === m.clid && f.city === m.city && f.fleet && f.week === ult);
    const oc = rs.reduce((s, r) => s + r.oc, 0), ish = rs.reduce((s, r) => s + r.ish, 0), tr = rs.reduce((s, r) => s + r.tr, 0);
    const acc = tr ? rs.reduce((s, r) => s + r.acc * r.tr, 0) / tr * 100 : null;
    return { partner: p.name, city: m.city, kam: p.kam, shCar: oc ? ish / oc : null, acc, mSh: m.shAuto, mAcc: m.acc, mUtil: m.util };
  });
}
function fleetVista(): string {
  const us = fleetUnidades();
  return `<section class="mt-sec"><h2 class="mt-h2">Cumplimiento Fleet de ${mesLargo(PS.metasMes)}</h2>
    <div class="ui-table-wrap"><table class="ui-table mt-ptable"><thead><tr><th>Partner</th><th>Ciudad</th><th>KAM</th><th class="ui-num">SH por auto</th><th class="ui-num">Meta</th><th>%</th><th class="ui-num">Aceptación</th><th class="ui-num">Meta</th><th>%</th><th class="ui-num">Utilización (meta)</th></tr></thead><tbody>` +
    us.map(u => { const p1 = u.shCar && u.mSh ? u.shCar / u.mSh * 100 : null, p2 = u.acc && u.mAcc ? u.acc / u.mAcc * 100 : null;
      return `<tr><th class="mt-pname"><span class="mt-dot" style="background:${hashColor(u.partner)}"></span>${e(u.partner)}</th><td>${cityLabel(u.city)}</td><td>${e(u.kam)}</td>
      <td class="ui-num">${u.shCar == null ? "—" : fmt(u.shCar)}</td><td class="ui-num">${u.mSh ?? "—"}</td><td>${p1 == null ? "—" : badge(pct1(p1), tone(p1) as any)}</td>
      <td class="ui-num">${pct1(u.acc)}</td><td class="ui-num">${u.mAcc == null ? "—" : pct1(u.mAcc)}</td><td>${p2 == null ? "—" : badge(pct1(p2), tone(p2) as any)}</td>
      <td class="ui-num">${u.mUtil == null ? "—" : pct1(u.mUtil)} <span class="mt-sub">sin actual medible</span></td></tr>`; }).join("") +
    `</tbody></table></div></section>`;
}

// ── ELEGIDA ────────────────────────────────────────────────────────────────
function elegida(): string {
  let h = `<div class="pr-metas">` + controles() + avisos();
  if (PS.metasLine === "fleet") return h + fleetVista() + `</div>`;
  h += `<section class="mt-sec"><h2 class="mt-h2">Cumplimiento de ${mesLargo(M.ym)} <span class="mt-info" title="Active Drivers: nivel del último período. N+R y Horas: acumulado del mes.">${iconSvg("info", { size: 14 })}</span></h2>
    <div class="ui-kpi-grid mt-kpis">${K3.map(kpiResumen).join("")}</div></section>`;
  h += `<section class="mt-sec"><h2 class="mt-h2">Por ciudad</h2>${tablaGrupo("Ciudad", M.ciudades, g => catVar(CIUDADES.indexOf(g)))}</section>`;
  h += `<section class="mt-sec"><h2 class="mt-h2">Por KAM</h2>${tablaGrupo("KAM", M.kams, g => catVar(KAMS.indexOf(g)))}</section>`;
  h += `<section class="mt-sec"><h2 class="mt-h2">Por partner</h2><div class="mt-ptools">${chips()}${segmented({ ariaLabel: "Vista", act: "prMetasVista", value: PS.metasVista, options: [{ value: "tabla", label: "Tabla", icon: "table" }, { value: "tarjetas", label: "Tarjetas", icon: "chart-bar" }] })}</div>
    ${PS.metasVista === "tabla" ? tablaPartners() : tarjetas()}</section>`;
  return h + `</div>`;
}

// ── A · LIENZO ABIERTO ─────────────────────────────────────────────────────
function versionA(): string {
  let h = `<div class="pr-a pr-metas">` + controles() + avisos();
  if (PS.metasLine === "fleet") return h + fleetVista() + `</div>`;
  h += `<div class="pr-a-h"><div><h2>Cumplimiento de ${mesLargo(M.ym)}</h2><p>Active Drivers: último período · N+R y Horas: acumulado del mes</p></div></div>`;
  h += `<div class="pr-a-kpis pr-a-kpis--3">${K3.map(k => { const a = pais(k); return a ? `<div class="pr-a-kpi"><div class="pr-a-kpi__lbl">${NOM[k]}</div>
    <div class="pr-a-kpi__val">${fv(k, a.actual)} <span class="pr-a-kpi__of">/ ${fv(k, a.meta)}</span></div>${bar(a.pct, a.projPct, "pr-a-line")}
    <div class="pr-a-kpi__cap">${toneTxt(a.pct)} de la meta · proyección ${toneTxt(a.projPct)} · ${dlPct(M.deltaPais[k])} vs ${mesNombre(M.ymPrev, false)}</div></div>` : ""; }).join("")}</div>`;
  const compacta = (titulo: string, gs: any[], col: (g: string) => string) => `<table class="ui-table pr-a-flat"><thead><tr><th>${titulo}</th>${K3.map(k => `<th class="ui-num">${NOM[k]}</th>`).join("")}<th class="ui-num">Cuentas</th></tr></thead><tbody>` +
    gs.map(g => `<tr><th>${dot(col(g.g))}${e(titulo === "Ciudad" ? cityLabel(g.g) : g.g)}</th>${g.kp.map(kp => `<td class="ui-num"><div class="pr-a-cell">${fv(kp.k, kp.actual)} <span class="pr-muted">/ ${kp.meta ? fv(kp.k, kp.meta) : "—"}</span></div>${kp.meta ? `<div class="pr-a-cell2">${bar(kp.pct, null, "pr-a-line")}${toneTxt(kp.pct)}</div>` : ""}</td>`).join("")}<td class="ui-num">${g.n}</td></tr>`).join("") + `</tbody></table>`;
  h += `<div class="pr-a-h"><div><h2>Por ciudad</h2><p>Actual / meta del mes y % de avance</p></div></div>${compacta("Ciudad", M.ciudades, g => catVar(CIUDADES.indexOf(g)))}`;
  h += `<div class="pr-a-h"><div><h2>Por KAM</h2></div></div>${compacta("KAM", M.kams, g => catVar(KAMS.indexOf(g)))}`;
  h += `<div class="pr-a-h"><div><h2>Por partner</h2><p>Ordena con un clic en la columna</p></div>${chips("pr-a-chips", "pr-a-chip")}</div>${tablaPartners("pr-a-table pr-a-table--scroll")}`;
  return h + `</div>`;
}

// ── B · SUAVE ──────────────────────────────────────────────────────────────
function versionB(): string {
  let h = `<div class="pr-b pr-metas">` + controles() + avisos();
  if (PS.metasLine === "fleet") return h + fleetVista() + `</div>`;
  h += `<h2 class="pr-b-h">Cumplimiento de ${mesLargo(M.ym)}</h2><div class="pr-b-kpis pr-b-kpis--3">${K3.map(k => { const a = pais(k); return a ? `<div class="pr-b-kpi pr-b-kpi--big">${ring(a.pct, 96, 10)}
    <div class="pr-b-kpi__body"><div class="pr-b-kpi__lbl">${NOM[k]}</div><div class="pr-b-kpi__val">${fv(k, a.actual)}</div><div class="pr-b-kpi__cap">de ${fv(k, a.meta)} · proyección ${toneTxt(a.projPct)}</div>
    <div class="pr-b-kpi__delta">${dlPct(M.deltaPais[k])}<span>vs ${mesNombre(M.ymPrev, false)} al mismo punto</span></div></div></div>` : ""; }).join("")}</div>`;
  h += `<h2 class="pr-b-h">Por ciudad</h2><div class="pr-b-cities">${M.ciudades.map(g => `<div class="pr-b-city"><div class="pr-b-city__name">${dot(catVar(CIUDADES.indexOf(g.g)))}${cityLabel(g.g)} <span class="pr-muted">· ${g.n} cuentas</span></div>
    <div class="pr-b-rings">${g.kp.map(kp => `<div class="pr-b-ringcell">${ring(kp.meta ? kp.pct : null, 60, 7)}<span>${NOM[kp.k]}</span><small>${fv(kp.k, kp.actual)} / ${kp.meta ? fv(kp.k, kp.meta) : "—"}</small></div>`).join("")}</div></div>`).join("")}</div>`;
  h += `<h2 class="pr-b-h">Por KAM</h2><div class="pr-b-list">${M.kams.map(g => `<div class="pr-b-li"><div class="pr-b-li__name">${dot(catVar(KAMS.indexOf(g.g)))}${e(g.g)} <span class="pr-muted">· ${g.n} cuentas</span></div>` +
    g.kp.map(kp => `<div class="pr-b-li__kpi"><span>${NOM[kp.k]}</span>${bar(kp.meta ? kp.pct : null, null, "pr-b-pill")}<b>${kp.meta ? pct1(kp.pct) : "—"}</b></div>`).join("") + `</div>`).join("")}</div>`;
  h += `<div class="pr-b-hrow"><h2 class="pr-b-h">Por partner</h2>${chips("pr-b-chips", "pr-b-chip")}</div>`;
  h += `<div class="pr-b-pgrid">${unidadesFiltradas().map(u => `<div class="pr-b-pcard"><div class="pr-b-pcard__head">${ring(u.peor, 52, 6, "peor KPI")}<div><div class="pr-b-pcard__name">${e(u.partner)}</div><div class="pr-muted">${cityLabel(u.city)} · ${e(u.kam)}${u.sinMeta ? " · sin meta" : ""}</div></div></div>` +
    K3.map(k => `<div class="pr-b-li__kpi"><span>${NOM[k]}</span>${bar(u.meta[k] ? u.pct[k] : null, null, "pr-b-pill")}<b>${u.meta[k] ? pct1(u.pct[k]) : "—"}</b></div>`).join("") + `</div>`).join("") || `<div class="mt-filtro-vacio">Ningún partner en este filtro.</div>`}</div>`;
  return h + `</div>`;
}

// ── C · MESA DE TRABAJO ────────────────────────────────────────────────────
function versionC(): string {
  let h = `<div class="pr-c pr-metas">` + controles() + avisos();
  if (PS.metasLine === "fleet") return h + fleetVista() + `</div>`;
  h += `<div class="pr-c-strip pr-c-strip--3">${K3.map(k => { const a = pais(k); return a ? `<div class="pr-c-stat"><div class="pr-c-stat__lbl">${NOM[k]} · ${mesNombre(M.ym, false)}</div>
    <div class="pr-c-stat__row"><span class="pr-c-stat__val">${fv(k, a.actual)}</span><span class="pr-muted">/ ${fv(k, a.meta)}</span>${toneTxt(a.pct)}</div>${bar(a.pct, a.projPct)}
    <div class="pr-c-stat__meta">proyección ${toneTxt(a.projPct)}</div></div>` : ""; }).join("")}</div>`;
  const us = unidadesFiltradas();
  const sel = us.find(u => u.key === PS.mSel) || us.find(u => u.act.ad > 0) || us[0];
  h += `<div class="pr-c-split"><div class="pr-c-list"><div class="pr-c-list__head"><span>${us.length} cuentas · peor primero</span></div>
    <div class="pr-c-list__chips">${chips("pr-c-chips", "pr-c-chip")}</div>
    <div class="pr-c-list__body">${us.map(u => `<button type="button" class="pr-c-row pr-c-row--meta${u === sel ? " is-sel" : ""}" data-act="prMSel" data-p="${e(u.key)}">
      <span class="pr-c-row__name">${dot(hashColor(u.partner))}<span>${e(u.partner)}</span></span><span class="pr-c-row__kam">${cityLabel(u.city)}</span>
      <span class="pr-c-row__bar">${bar(u.peor, null)}</span><span class="pr-c-row__num">${u.sinMeta ? `<span class="pr-muted">sin meta</span>` : toneTxt(u.peor)}</span></button>`).join("")}</div></div>`;
  if (sel) {
    const semanas = SEMANAS.filter(w => mesDeSemana(w) === M.ym || mesDeSemana(w) === M.ymPrev);
    const serie = semanas.map(w => FILAS.filter(f => f.partner === sel.partner && f.city === sel.city && f.week === w).reduce((s, f) => s + f.ad, 0));
    h += `<div class="pr-c-detail"><div class="pr-c-detail__head"><div><div class="pr-c-detail__name">${dot(hashColor(sel.partner))}${e(sel.partner)} <span class="pr-muted">· ${cityLabel(sel.city)}</span></div>
      <div class="pr-c-detail__meta">KAM ${e(sel.kam)} · ${sel.sinMeta ? "operó sin meta este mes" : "peor KPI " + pct1(sel.peor)}</div></div>
      <button type="button" class="ui-btn ui-btn--secondary ui-btn--sm" data-act="prNav" data-tab="calculator">${iconSvg("calculator", { size: 14 })}<span>Abrir en la Calculadora</span></button></div>
      <table class="ui-table pr-c-table pr-c-kpitable"><thead><tr><th>Indicador</th><th class="ui-num">Actual</th><th class="ui-num">Meta</th><th>% meta</th><th class="ui-num">8 sem.</th></tr></thead><tbody>` +
      K3.map(k => `<tr><td>${NOM[k]}</td><td class="ui-num">${fv(k, sel.act[k])}</td><td class="ui-num">${sel.meta[k] ? fv(k, sel.meta[k]) : "—"}</td><td><div class="mt-pctwrap">${bar(sel.meta[k] ? sel.pct[k] : null, null, "mt-bar")}${toneTxt(sel.pct[k])}</div></td><td class="ui-num">${k === "ad" ? spark(serie, 64, 20) : ""}</td></tr>`).join("") +
      `</tbody></table>
      <div class="ui-card rd-chart pr-c-panel pr-c-panel--flat"><div class="rd-chart__head"><span class="rd-chart__title">Conductores activos por semana · ${mesNombre(M.ymPrev, false)} y ${mesNombre(M.ym, false)}</span></div><div id="prMd_ad" class="rd-chart__plot"></div>
      <div class="rd-chart__caption">La línea punteada es la meta de ${mesNombre(M.ym, false)} (${fv("ad", sel.meta.ad)}). Semanas: ${semanas.map(d2s).join(", ")}.</div></div></div>`;
  }
  return h + `</div></div>`;
}

export function renderMetas(): string {
  M = modeloMetas(PS.metasLine, PS.F, PS.metasMes);
  if (!M.semMes.length) return controles() + `<div class="ui-empty"><div class="ui-empty__title">El rango no incluye ningún período de ${mesLargo(PS.metasMes)}</div><div class="ui-empty__text">Amplía el rango de fechas en Filtros.</div></div>`;
  return PS.v === "a" ? versionA() : PS.v === "b" ? versionB() : PS.v === "c" ? versionC() : elegida();
}

export function chartsMetas(): void {
  const el = document.getElementById("prMd_ad");
  if (!el || !M) return;
  const us = unidadesFiltradas();
  const sel = us.find(u => u.key === PS.mSel) || us.find(u => u.act.ad > 0) || us[0];
  if (!sel) return;
  const semanas = SEMANAS.filter(w => mesDeSemana(w) === M.ym || mesDeSemana(w) === M.ymPrev);
  const serie = semanas.map(w => FILAS.filter(f => f.partner === sel.partner && f.city === sel.city && f.week === w).reduce((s, f) => s + f.ad, 0));
  const tk = chartTokens();
  const series: any[] = [{ name: "Conductores activos", data: serie }];
  if (sel.meta.ad) series.push({ name: "Meta " + mesNombre(M.ym, false), data: semanas.map(w => mesDeSemana(w) === M.ym ? sel.meta.ad : null) });
  buildLineChart("prMd_ad", semanas, series, [seriesColor(0, tk), tk.textMuted], { stroke: { dashArray: [0, 5] } });
}
