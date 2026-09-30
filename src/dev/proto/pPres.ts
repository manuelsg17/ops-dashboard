// dev/proto/pPres.ts — Descarga MASIVA de presentaciones por KAM (SOLO prototipo).
//
// Pedido de Manuel (30-sep-2026): "descargar masivamente las presentaciones de
// las cuentas del KAM… selecciona el KAM, y luego para cada partner que esté en
// automático, pero te permita cambiar si es fleet, agregador y otro filtro para
// seleccionar las páginas ya sea para quitar o agregar… muy fácil de usar".
//
// Tres propuestas sobre los partners del seed, con las MISMAS reglas del deck
// real (presentacion2.p2Deck): hojas por vertical que el partner opera, N+R por
// origen solo en Taxi, Proyección nunca va al PDF, vista automática = Fleet si
// el partner está marcado Fleet. La generación es simulada (no baja nada).
//   b1 · Panel de cartera: un panel lateral sobre la Presentación de siempre.
//   b2 · Modo cartera: la Presentación cambia a "cartera del KAM", con lista
//        de partners a la izquierda y la vista previa de sus hojas a la derecha.
//   b3 · Matriz: partners × tipos de hoja, un clic por celda o por columna.

import { escapeHTML as e } from "../../core/security";
import { fmt } from "../../core/format";
import { iconSvg } from "../../shared/icons";
import { segmented, badge, infoTip } from "../../shared/ui";
import { PS } from "./state";
import { FILAS, KAMS, partnersDeKam, cityLabel, partnerDe } from "./model";
import { FX } from "./fixture";
import { dot } from "./bits";

// ── Modelo de un partner para el deck ───────────────────────────────────────
export type VistaP = "auto" | "taxi" | "fleet";
interface PP { name: string; clid: string; cities: string[]; taxi: boolean; tk: boolean; fleet: boolean; dl: boolean; cg: boolean; conv: boolean; seg: boolean; ad: number }
interface Hoja { key: string; tipo: string; label: string; ds: string }

// Tipos de hoja (lo que el KAM prende o apaga). Orden = orden del deck.
export const TIPOS: { k: string; l: string; corto: string; tip: string; grupo: "base" | "lineas" | "extra" | "anexo" }[] = [
  { k: "portada",  l: "Carátula",            corto: "Carátula",  tip: "Portada con el nombre del partner y el período", grupo: "base" },
  { k: "ejec",     l: "Ejecutivo",           corto: "Ejecutivo", tip: "Lectura ejecutiva, señales y embudo de captación", grupo: "base" },
  { k: "resumen",  l: "Resumen",             corto: "Resumen",   tip: "KPIs del período por línea y avance contra la meta", grupo: "base" },
  { k: "kpis",     l: "KPIs por nivel",      corto: "KPIs",      tip: "Gráficas por nivel (Perú y cada ciudad), una hoja por línea que opera", grupo: "lineas" },
  { k: "nrorigen", l: "N+R por origen",      corto: "N+R origen", tip: "Nuevos del partner, del servicio (leads Yango) y reactivados. Solo Taxi", grupo: "lineas" },
  { k: "alertas",  l: "Alertas",             corto: "Alertas",   tip: "Caídas, riesgos y oportunidades en una sola hoja", grupo: "extra" },
  { k: "embudo",   l: "Embudo de conversión", corto: "Embudo",   tip: "Registro → 100 viajes contra su cohorte. Solo si hay datos del último mes", grupo: "extra" },
  { k: "canal",    l: "Adquisición por canal", corto: "Canal",   tip: "De dónde vienen los nuevos. Solo si hay datos del último mes", grupo: "extra" },
  { k: "seg",      l: "Seguimiento",         corto: "Seguim.",   tip: "Tareas del proyecto con el partner. Solo si tiene tareas cargadas", grupo: "extra" },
  { k: "raw",      l: "Data Raw (# y %)",    corto: "Data Raw",  tip: "Anexo con los números crudos por ciudad, dos hojas por línea", grupo: "anexo" }
];
const TIPO = Object.fromEntries(TIPOS.map(x => [x.k, x]));

export const PRESETS: { k: string; l: string; off: string[] }[] = [
  { k: "completo", l: "Deck completo", off: [] },
  { k: "ejecutivo", l: "Resumen ejecutivo", off: ["kpis", "nrorigen", "embudo", "canal", "seg", "raw"] },
  { k: "sinanexo", l: "Sin anexos", off: ["raw"] }
];

const _flota = new Map<string, { dl: boolean; cg: boolean }>();
for (const f of (FX.fleetrooms || [])) {
  const o = _flota.get(f[1]) || { dl: false, cg: false };
  o.dl = o.dl || !!f[6]; o.cg = o.cg || !!f[7]; _flota.set(f[1], o);
}
let _cache: Record<string, PP[]> = {};
export function cartera(kam: string): PP[] {
  if (_cache[kam]) return _cache[kam];
  const out = partnersDeKam(kam).map((name, i) => {
    const fs = FILAS.filter(f => f.partner === name);
    const clid = fs[0]?.clid || "";
    const ult = fs.reduce((m, f) => f.week > m ? f.week : m, "");
    const pd = partnerDe(clid), fl = _flota.get(clid) || { dl: false, cg: false };
    return {
      name, clid, cities: [...new Set(fs.map(f => f.city))],
      taxi: fs.some(f => !f.tk), tk: fs.some(f => f.tk), fleet: pd.fleet || fs.some(f => f.fleet),
      dl: fl.dl, cg: fl.cg, conv: i % 3 !== 2, seg: i % 4 === 0,
      ad: fs.filter(f => f.week === ult).reduce((s, f) => s + f.ad, 0)
    };
  }).sort((a, b) => b.ad - a.ad);
  return (_cache[kam] = out);
}
const vistaEf = (p: PP, v: VistaP) => v === "auto" ? (p.fleet ? "fleet" : "taxi") : v;
const lineas = (p: PP) => [p.taxi && "Taxi", p.tk && "TukTuk", p.dl && "Delivery", p.cg && "Cargo"].filter(Boolean) as string[];

/** Hojas del deck de un partner (misma regla que presentacion2.p2Deck). */
export function deckDe(p: PP, vista: VistaP): Hoja[] {
  const v = vistaEf(p, vista);
  const hs: Hoja[] = [];
  const add = (tipo: string, label: string, ds = "base") => hs.push({ key: `${tipo}|${ds}|${label}`, tipo, label, ds });
  add("portada", "Carátula"); add("ejec", "Ejecutivo"); add("resumen", "Resumen");
  lineas(p).forEach(l => {
    add("kpis", `KPIs · ${l === "Taxi" && v === "fleet" ? "Fleet" : l}`, l);
    if (l === "Taxi") add("nrorigen", "N+R por origen · Taxi", l);
  });
  add("alertas", "Alertas");
  if (p.conv) { add("embudo", "Embudo"); add("canal", "Canal"); }
  lineas(p).forEach(l => { add("raw", `Data Raw # · ${l}`, l); add("raw", `Data Raw % · ${l}`, l); });
  if (p.seg) add("seg", "Seguimiento");
  return hs;
}

// ── Estado ──────────────────────────────────────────────────────────────────
type Fase = "config" | "generando" | "listo";
export const PR = {
  kam: "Ana", lang: "es", mes: "auto", preset: "completo",
  off: new Set<string>(),                              // tipos apagados para TODOS
  offKeys: new Set<string>(),                          // hojas sueltas apagadas para TODOS (misma clave entre partners)
  offP: {} as Record<string, Set<string>>,             // hojas apagadas por partner (claves de hoja)
  onP: {} as Record<string, Set<string>>,              // hojas prendidas por partner aunque el tipo esté apagado
  vista: {} as Record<string, VistaP>,
  sel: null as Set<string> | null,                     // null = todos los de la cartera
  foco: "" as string,
  abierto: true,                                       // b1: panel abierto
  expand: "" as string,                                // b1: partner con hojas desplegadas
  modo: "cartera" as "uno" | "cartera",                // b2
  hojaFoco: 0,
  formato: "zip" as "zip" | "separados",
  fase: "config" as Fase, prog: {} as Record<string, number>
};
const partners = () => cartera(PR.kam);
const selSet = () => PR.sel || new Set(partners().map(p => p.name));
const vistaDe = (n: string): VistaP => PR.vista[n] || "auto";
export function hojaOn(p: PP, h: Hoja): boolean {
  if (PR.offP[p.name]?.has(h.key)) return false;
  if (PR.onP[p.name]?.has(h.key)) return true;
  if (PR.offKeys.has(h.key)) return false;
  return !PR.off.has(h.tipo);
}
const hojasDe = (p: PP) => deckDe(p, vistaDe(p.name));
const hojasOn = (p: PP) => hojasDe(p).filter(h => hojaOn(p, h));
const personalizado = (p: PP) => !!(PR.offP[p.name]?.size || PR.onP[p.name]?.size || PR.vista[p.name]);
function totales() {
  const ps = partners().filter(p => selSet().has(p.name));
  const hojas = ps.reduce((s, p) => s + hojasOn(p).length, 0);
  return { n: ps.length, hojas, seg: Math.round(hojas * 0.9 + ps.length * 2) };
}
const dur = (s: number) => s < 90 ? `~${s} s` : `~${Math.round(s / 60)} min`;
export function prResetKam(k: string) { PR.kam = k; PR.sel = null; PR.offKeys = new Set(); PR.offP = {}; PR.onP = {}; PR.vista = {}; PR.foco = ""; PR.expand = ""; PR.fase = "config"; PR.prog = {}; PR.hojaFoco = 0; }

// ── Acciones (las registra proto.ts) ────────────────────────────────────────
export const accionesPres = {
  bxKam: (v: string) => prResetKam(v),
  bxLang: (v: string) => { PR.lang = v; },
  bxPreset: (v: string) => { const p = PRESETS.find(x => x.k === v); if (!p) return; PR.preset = v; PR.off = new Set(p.off); PR.offKeys = new Set(); PR.offP = {}; PR.onP = {}; },
  bxTipo: (k: string) => {
    if (PR.off.has(k)) PR.off.delete(k); else PR.off.add(k);
    [...PR.offKeys].forEach(x => { if (x.startsWith(k + "|")) PR.offKeys.delete(x); });
    PR.preset = "";
  },
  bxSel: (n: string) => { const s = new Set(selSet()); if (s.has(n)) s.delete(n); else s.add(n); PR.sel = s; },
  bxSelTodos: () => { const all = partners().map(p => p.name); PR.sel = selSet().size === all.length ? new Set() : new Set(all); },
  bxVista: (n: string, v: string) => { if (v === "auto") delete PR.vista[n]; else PR.vista[n] = v as VistaP; },
  bxHoja: (n: string, key: string) => {
    const p = partners().find(x => x.name === n); if (!p) return;
    const h = hojasDe(p).find(x => x.key === key); if (!h) return;
    const on = hojaOn(p, h);
    const off = PR.offP[n] || (PR.offP[n] = new Set()), onS = PR.onP[n] || (PR.onP[n] = new Set());
    const generalOff = PR.off.has(h.tipo) || PR.offKeys.has(key);
    if (on) { onS.delete(key); if (!generalOff) off.add(key); }
    else { off.delete(key); if (generalOff) onS.add(key); }
  },
  bxCelda: (n: string, tipo: string) => {         // b3: todas las hojas de ese tipo para ese partner
    const p = partners().find(x => x.name === n); if (!p) return;
    const hs = hojasDe(p).filter(h => h.tipo === tipo); if (!hs.length) return;
    const on = hs.some(h => hojaOn(p, h));
    hs.forEach(h => { if (hojaOn(p, h) === on) accionesPres.bxHoja(n, h.key); });
  },
  bxRestaurar: (n: string) => { delete PR.offP[n]; delete PR.onP[n]; delete PR.vista[n]; },
  bxAplicarATodos: (n: string) => {                // b2: la selección de un partner como regla para todos
    const p = partners().find(x => x.name === n); if (!p) return;
    const hs = hojasDe(p);
    const tipos = new Set(hs.map(h => h.tipo));
    const offTipos = [...tipos].filter(t => !hs.some(h => h.tipo === t && hojaOn(p, h)));
    PR.offKeys = new Set(hs.filter(h => !hojaOn(p, h) && !offTipos.includes(h.tipo)).map(h => h.key));
    PR.off = new Set(offTipos);
    PR.offP = {}; PR.onP = {}; PR.preset = "";
  },
  bxFoco: (n: string) => { PR.foco = n; PR.hojaFoco = 0; },
  bxHojaFoco: (i: string) => { PR.hojaFoco = +i || 0; },
  bxExpand: (n: string) => { PR.expand = PR.expand === n ? "" : n; },
  bxAbrir: () => { PR.abierto = !PR.abierto; },
  bxModo: (v: string) => { PR.modo = v === "uno" ? "uno" : "cartera"; },
  bxFormato: (v: string) => { PR.formato = v === "separados" ? "separados" : "zip"; },
  bxNuevo: () => { PR.fase = "config"; PR.prog = {}; }
};
/** Simula la generación: avanza partner por partner (la llama proto.ts con su render). */
export function simularDescarga(render: () => void) {
  const ps = partners().filter(p => selSet().has(p.name));
  if (!ps.length) return;
  PR.fase = "generando"; PR.prog = {};
  ps.forEach(p => { PR.prog[p.name] = 0; });
  let i = 0;
  const paso = () => {
    if (PR.fase !== "generando") return;
    const p = ps[i]; if (!p) { PR.fase = "listo"; render(); return; }
    const tot = hojasOn(p).length || 1;
    PR.prog[p.name] = Math.min(tot, (PR.prog[p.name] || 0) + Math.ceil(tot / 4));
    if (PR.prog[p.name] >= tot) i++;
    render();
    setTimeout(paso, 260);
  };
  render(); setTimeout(paso, 300);
}

// ── Piezas comunes ──────────────────────────────────────────────────────────
const kamSel = () => `<label class="bx-field"><span class="bx-field__lbl">KAM</span>
  <select class="ui-select ui-select--sm bx-select" data-act-change="bxKam">${KAMS.map(k => `<option value="${e(k)}"${k === PR.kam ? " selected" : ""}>${e(k)}</option>`).join("")}</select></label>`;
const langSeg = () => `<div class="bx-field"><span class="bx-field__lbl">Idioma del deck</span>${segmented({ ariaLabel: "Idioma", act: "bxLang", value: PR.lang, options: [{ value: "es", label: "ES" }, { value: "en", label: "EN" }, { value: "ru", label: "RU" }] })}</div>`;
const mesSel = () => `<label class="bx-field"><span class="bx-field__lbl">Mes de la meta</span>
  <select class="ui-select ui-select--sm bx-select"><option>Automático (septiembre)</option><option>Agosto 2026</option></select></label>`;
const presetChips = () => `<div class="bx-presets" role="group" aria-label="Plantillas de hojas">${PRESETS.map(p =>
  `<button type="button" class="bx-pill${PR.preset === p.k ? " is-on" : ""}" data-act="bxPreset" data-value="${p.k}" aria-pressed="${PR.preset === p.k}">${e(p.l)}</button>`).join("")}</div>`;
function tipoChips(): string {
  const ps = partners().filter(p => selSet().has(p.name));
  return `<div class="bx-tipos" role="group" aria-label="Hojas para todos">${TIPOS.map(x => {
    const n = ps.filter(p => hojasDe(p).some(h => h.tipo === x.k)).length;
    const on = !PR.off.has(x.k);
    return `<button type="button" class="bx-chip${on ? " is-on" : ""}${n ? "" : " is-na"}" data-act="bxTipo" data-value="${x.k}" aria-pressed="${on}" title="${e(x.tip + (n ? ` · aplica a ${n} partner${n === 1 ? "" : "s"}` : " · ningún partner la tiene"))}">
      ${iconSvg(on ? "check" : "plus", { size: 12 })}<span>${e(x.corto)}</span></button>`;
  }).join("")}</div>`;
}
const lineaBadges = (p: PP, v: VistaP) => {
  const ef = vistaEf(p, v);
  return `<span class="bx-lineas">${lineas(p).map(l => `<span class="bx-tag bx-tag--${l === "TukTuk" ? "tk" : "tx"}">${iconSvg(l === "TukTuk" ? "tuktuk" : l === "Taxi" ? (ef === "fleet" ? "car" : "taxi") : "package", { size: 12 })}${e(l === "Taxi" && ef === "fleet" ? "Fleet" : l === "Taxi" ? "Agregador" : l)}</span>`).join("")}</span>`;
};
const vistaSeg = (p: PP) => segmented({ ariaLabel: `Vista de ${p.name}`, act: "bxVista", data: { partner: p.name }, value: vistaDe(p.name),
  options: [{ value: "auto", label: "Auto", note: p.fleet ? "Fleet" : "Agr." }, { value: "taxi", label: "Agregador" }, { value: "fleet", label: "Fleet" }] });
function estadoFila(p: PP): string {
  if (PR.fase === "config") return "";
  const tot = hojasOn(p).length, v = PR.prog[p.name];
  if (v == null) return "";
  if (v >= tot) return `<span class="bx-est bx-est--ok">${iconSvg("check-circle", { size: 13 })}Listo</span>`;
  if (v > 0) return `<span class="bx-est bx-est--run"><span class="bx-est__bar"><span style="width:${Math.round(v / tot * 100)}%"></span></span>${v}/${tot}</span>`;
  return `<span class="bx-est">En cola</span>`;
}
function pie(): string {
  const T = totales();
  if (PR.fase === "listo") return `<div class="bx-foot bx-foot--ok">${iconSvg("check-circle", { size: 16 })}
    <span><b>${PR.formato === "zip" ? `Cartera_${e(PR.kam)}_2026-09.zip` : `${T.n} PDF`}</b> descargado · ${T.n} presentaciones · ${T.hojas} hojas</span>
    <span class="bx-foot__sp"></span><button type="button" class="ui-btn ui-btn--secondary ui-btn--sm" data-act="bxNuevo">Armar otro lote</button></div>`;
  const gen = PR.fase === "generando";
  const hechos = Object.entries(PR.prog).filter(([n, v]) => { const p = partners().find(x => x.name === n); return p && v >= hojasOn(p).length; }).length;
  return `<div class="bx-foot">
    <div class="bx-foot__sum"><b>${T.n}</b> presentaciones · <b>${T.hojas}</b> hojas · ${e(dur(T.seg))}${infoTip("Se generan una detrás de otra en este navegador; puedes seguir mirando la pantalla mientras tanto.")}</div>
    <span class="bx-foot__sp"></span>
    ${segmented({ ariaLabel: "Formato", act: "bxFormato", value: PR.formato, options: [{ value: "zip", label: "Un .zip" }, { value: "separados", label: "PDF separados" }] })}
    ${gen ? `<button type="button" class="ui-btn ui-btn--secondary ui-btn--sm" data-act="bxNuevo">${iconSvg("x", { size: 14 })}<span>Cancelar (${hechos}/${T.n})</span></button>`
      : `<button type="button" class="ui-btn ui-btn--primary ui-btn--sm" data-act="bxDescargar"${T.n ? "" : " disabled"}>${iconSvg("download", { size: 14 })}<span>Descargar ${T.n} presentaciones</span></button>`}
  </div>`;
}
// Hoja simulada 16:9 (vista previa): lo justo para reconocerla.
function hojaMock(p: PP, h: Hoja | undefined): string {
  if (!h) return `<div class="bx-slide bx-slide--vacia">Sin hojas elegidas</div>`;
  const barras = [62, 48, 71, 55, 80, 67].map((v, i) => `<span style="height:${v - (i * 7 + p.name.length) % 20}%"></span>`).join("");
  const off = !hojaOn(p, h);
  return `<div class="bx-slide${off ? " is-off" : ""}">
    <div class="bx-slide__top"><span class="bx-slide__brand">Yango</span><span>${e(p.name)} · ${e(h.label)}</span><span>${PR.lang.toUpperCase()}</span></div>
    ${h.tipo === "portada" ? `<div class="bx-slide__cover"><div class="bx-slide__h">${e(p.name)}</div><div class="bx-slide__s">Desempeño · septiembre 2026 · ${e(p.cities.map(cityLabel).join(" · "))}</div></div>`
      : `<div class="bx-slide__h2">${e(h.label)}</div><div class="bx-slide__chart">${barras}</div>`}
    ${off ? `<div class="bx-slide__off">${iconSvg("eye", { size: 14 })}Fuera del PDF</div>` : ""}
  </div>`;
}
function hojaPills(p: PP, act = "bxHoja"): string {
  return `<div class="bx-hojas">${hojasDe(p).map(h => {
    const on = hojaOn(p, h);
    return `<button type="button" class="bx-hoja${on ? " is-on" : ""}" data-act="${act}" data-partner="${e(p.name)}" data-key="${e(h.key)}" aria-pressed="${on}" title="${on ? "Va en el PDF · clic para quitarla" : "Fuera del PDF · clic para agregarla"}">${e(h.label)}</button>`;
  }).join("")}</div>`;
}
// Barra de la Presentación de siempre (contexto: esto vive ahí).
function barraPres(extra = ""): string {
  return `<div class="bx-bar">
    <div class="bx-field bx-field--grow"><span class="bx-field__lbl">Partner</span><div class="bx-search">${iconSvg("search", { size: 14 })}<span>ANDINA MOVILIDAD</span></div></div>
    <div class="bx-field"><span class="bx-field__lbl">Idioma</span>${segmented({ ariaLabel: "Idioma", act: "prToast", value: "es", options: [{ value: "es", label: "ES" }, { value: "en", label: "EN" }, { value: "ru", label: "RU" }] })}</div>
    <div class="bx-field"><span class="bx-field__lbl">Vista</span>${segmented({ ariaLabel: "Vista", act: "prToast", value: "auto", options: [{ value: "auto", label: "Automática" }, { value: "taxi", label: "Taxi" }, { value: "fleet", label: "Fleet" }] })}</div>
    <span class="bx-bar__sp"></span>${extra}
    <button type="button" class="ui-btn ui-btn--secondary ui-btn--sm" data-act="prToast" data-msg="Hojas del PDF de este partner">${iconSvg("file-text", { size: 14 })}<span>Hojas (14)</span></button>
    <button type="button" class="ui-btn ui-btn--primary ui-btn--sm" data-act="prToast" data-msg="Descargaría el PDF de ANDINA MOVILIDAD">${iconSvg("download", { size: 14 })}<span>Descargar PDF</span></button>
  </div>`;
}

// ── B1 · Panel de cartera (sobre la Presentación de siempre) ────────────────
function b1(): string {
  const ps = partners(), s = selSet();
  const fondo = partners()[0];
  const lista = ps.map(p => {
    const on = s.has(p.name), hs = hojasOn(p).length, open = PR.expand === p.name;
    return `<div class="bx-row${on ? "" : " is-off"}${open ? " is-open" : ""}">
      <div class="bx-row__main">
        <input type="checkbox" class="bx-card__chk" aria-label="Incluir ${e(p.name)}" data-act-change="bxSel" data-value="${e(p.name)}"${on ? " checked" : ""}${PR.fase !== "config" ? " disabled" : ""}>
        <div class="bx-row__who"><span class="bx-row__name">${e(p.name)}</span>${lineaBadges(p, vistaDe(p.name))}</div>
        <span class="bx-row__sp"></span>
        ${estadoFila(p) || `<button type="button" class="bx-link" data-act="bxExpand" data-value="${e(p.name)}" aria-expanded="${open}">${hs} hojas${personalizado(p) ? ` <span class="bx-dot-edit" title="Personalizado">·</span>` : ""}${iconSvg("chevron-down", { size: 13 })}</button>`}
      </div>
      ${open ? `<div class="bx-row__det">
        <div class="bx-row__line"><span class="bx-mini">Vista</span>${vistaSeg(p)}${personalizado(p) ? `<button type="button" class="bx-link bx-link--muted" data-act="bxRestaurar" data-value="${e(p.name)}">Volver a lo general</button>` : ""}</div>
        <div class="bx-mini">Hojas de ${e(p.name)} <span class="pr-muted">· clic para quitar o agregar</span></div>${hojaPills(p)}
      </div>` : ""}
    </div>`;
  }).join("");
  const panel = PR.abierto ? `<aside class="bx-drawer" aria-label="Descargar la cartera del KAM">
    <div class="bx-drawer__head"><div><div class="bx-drawer__t">Descargar la cartera de un KAM</div><div class="bx-drawer__s">Una presentación por partner, con las hojas que elijas</div></div>
      <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm ui-btn--icon" data-act="bxAbrir" aria-label="Cerrar">${iconSvg("x", { size: 16 })}</button></div>
    <div class="bx-drawer__body">
      <div class="bx-step"><span class="bx-step__n">1</span><span class="bx-step__t">Cartera</span></div>
      <div class="bx-grid2">${kamSel()}${langSeg()}</div>
      <div class="bx-step"><span class="bx-step__n">2</span><span class="bx-step__t">Hojas para todos</span>${presetChips()}</div>
      ${tipoChips()}
      <div class="bx-step"><span class="bx-step__n">3</span><span class="bx-step__t">Partners</span><span class="bx-row__sp"></span>
        <button type="button" class="bx-link" data-act="bxSelTodos">${s.size === ps.length ? "Quitar todos" : "Elegir todos"}</button></div>
      <p class="bx-hint">La vista sale sola (Fleet si el partner es Fleet). Abre un partner para cambiarla o sumar y quitar hojas solo para él.</p>
      <div class="bx-list">${lista}</div>
    </div>
    ${pie()}
  </aside>` : "";
  return `<div class="bx bx--b1">
    ${barraPres(`<button type="button" class="ui-btn ui-btn--secondary ui-btn--sm${PR.abierto ? " is-active" : ""}" data-act="bxAbrir">${iconSvg("users", { size: 14 })}<span>Cartera del KAM</span></button>`)}
    <div class="bx-stage">${hojaMock(fondo, deckDe(fondo, "auto")[0])}</div>
    ${panel}
  </div>`;
}

// ── B2 · Modo cartera (la Presentación cambia de modo) ──────────────────────
function b2(): string {
  const ps = partners(), s = selSet();
  if (!PR.foco || !ps.some(p => p.name === PR.foco)) PR.foco = ps[0]?.name || "";
  const f = ps.find(p => p.name === PR.foco)!;
  const modo = segmented({ ariaLabel: "Modo", act: "bxModo", value: PR.modo, options: [{ value: "uno", label: "Un partner", icon: "user" }, { value: "cartera", label: "Cartera de un KAM", icon: "users" }] });
  if (PR.modo === "uno") return `<div class="bx bx--b2"><div class="bx-modo">${modo}</div>${barraPres()}<div class="bx-stage">${hojaMock(f, deckDe(f, "auto")[0])}</div></div>`;
  const hs = hojasDe(f);
  if (PR.hojaFoco >= hs.length) PR.hojaFoco = 0;
  const lista = ps.map(p => {
    const on = s.has(p.name), act = p.name === PR.foco;
    return `<div class="bx-card${act ? " is-act" : ""}${on ? "" : " is-off"}">
      <input type="checkbox" class="bx-card__chk" aria-label="Incluir ${e(p.name)}" data-act-change="bxSel" data-value="${e(p.name)}"${on ? " checked" : ""}>
      <button type="button" class="bx-card__main" data-act="bxFoco" data-value="${e(p.name)}">
        <span class="bx-card__name">${e(p.name)}${personalizado(p) ? ` <span class="bx-edit" title="Personalizado">${iconSvg("edit", { size: 11 })}</span>` : ""}</span>
        <span class="bx-card__meta">${lineaBadges(p, vistaDe(p.name))}<span class="bx-card__n">${hojasOn(p).length} hojas</span></span>
      </button>${estadoFila(p)}
    </div>`;
  }).join("");
  const tira = hs.map((h, i) => `<button type="button" class="bx-thumb${i === PR.hojaFoco ? " is-act" : ""}${hojaOn(f, h) ? "" : " is-off"}" data-act="bxHojaFoco" data-value="${i}" title="${e(h.label)}">
      <span class="bx-thumb__n">${i + 1}</span><span class="bx-thumb__l">${e(h.label)}</span></button>`).join("");
  const hf = hs[PR.hojaFoco];
  return `<div class="bx bx--b2">
    <div class="bx-modo">${modo}</div>
    <div class="bx-bar">${kamSel()}${langSeg()}${mesSel()}<span class="bx-bar__sp"></span><div class="bx-field"><span class="bx-field__lbl">Hojas para todos</span>${presetChips()}</div></div>
    <div class="bx-b2">
      <div class="bx-b2__list"><div class="bx-b2__head"><span><b>${s.size}</b> de ${ps.length} partners de ${e(PR.kam)}</span><button type="button" class="bx-link" data-act="bxSelTodos">${s.size === ps.length ? "Ninguno" : "Todos"}</button></div>${lista}</div>
      <div class="bx-b2__prev">
        <div class="bx-b2__ph"><div><div class="bx-b2__pt">${e(f.name)}</div><div class="bx-b2__ps">${e(f.cities.map(cityLabel).join(" · "))} · ${hojasOn(f).length} de ${hs.length} hojas en el PDF</div></div>
          <span class="bx-row__sp"></span><div class="bx-field"><span class="bx-field__lbl">Vista</span>${vistaSeg(f)}</div></div>
        <div class="bx-tira">${tira}</div>
        <div class="bx-b2__slide">${hojaMock(f, hf)}
          <div class="bx-b2__acts">
            ${hf ? `<button type="button" class="ui-btn ui-btn--secondary ui-btn--sm" data-act="bxHoja" data-partner="${e(f.name)}" data-key="${e(hf.key)}">${iconSvg(hojaOn(f, hf) ? "x" : "plus", { size: 14 })}<span>${hojaOn(f, hf) ? "Quitar esta hoja" : "Agregar esta hoja"}</span></button>` : ""}
            <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" data-act="bxAplicarATodos" data-value="${e(f.name)}" title="Las hojas que dejaste en este partner pasan a ser la regla para toda la cartera">${iconSvg("copy", { size: 14 })}<span>Usar estas hojas en todos</span></button>
            ${personalizado(f) ? `<button type="button" class="bx-link bx-link--muted" data-act="bxRestaurar" data-value="${e(f.name)}">Volver a lo general</button>` : ""}
          </div>
        </div>
      </div>
    </div>
    ${pie()}
  </div>`;
}

// ── B3 · Matriz partners × hojas ────────────────────────────────────────────
function b3(): string {
  const ps = partners(), s = selSet();
  const cols = TIPOS.filter(x => ps.some(p => hojasDe(p).some(h => h.tipo === x.k)));
  const head = cols.map(x => {
    const on = !PR.off.has(x.k);
    return `<th scope="col" class="bx-mx__th"><button type="button" class="bx-mx__col${on ? " is-on" : ""}" data-act="bxTipo" data-value="${x.k}" aria-pressed="${on}" title="${e(x.tip)} · clic para ${on ? "quitarla de" : "agregarla a"} todos">${e(x.corto)}</button></th>`;
  }).join("");
  const filas = ps.map(p => {
    const on = s.has(p.name), hs = hojasDe(p);
    const celdas = cols.map(x => {
      const del = hs.filter(h => h.tipo === x.k);
      if (!del.length) return `<td class="bx-mx__td"><span class="bx-mx__na" title="${e(p.name)} no tiene esta hoja">—</span></td>`;
      const n = del.filter(h => hojaOn(p, h)).length;
      const st = n === 0 ? "off" : n === del.length ? "on" : "mix";
      return `<td class="bx-mx__td"><button type="button" class="bx-mx__cell bx-mx__cell--${st}" data-act="bxCelda" data-partner="${e(p.name)}" data-value="${x.k}" aria-pressed="${st !== "off"}" title="${e(del.map(h => h.label).join(" · "))}">${st === "on" ? iconSvg("check", { size: 13 }) : st === "mix" ? `${n}/${del.length}` : ""}</button></td>`;
    }).join("");
    return `<tr class="${on ? "" : "is-off"}">
      <th scope="row" class="bx-mx__p"><label class="bx-check"><input type="checkbox" data-act-change="bxSel" data-value="${e(p.name)}"${on ? " checked" : ""}><span class="bx-row__name">${e(p.name)}</span></label>
        <div class="bx-mx__sub">${lineaBadges(p, vistaDe(p.name))}</div></th>
      <td class="bx-mx__vista"><select class="ui-select ui-select--sm bx-select bx-select--mini" aria-label="Vista de ${e(p.name)}" data-act-change="bxVistaSel" data-partner="${e(p.name)}">
        ${[["auto", `Auto (${p.fleet ? "Fleet" : "Agregador"})`], ["taxi", "Agregador"], ["fleet", "Fleet"]].map(([v, l]) => `<option value="${v}"${vistaDe(p.name) === v ? " selected" : ""}>${l}</option>`).join("")}</select></td>${celdas}
      <td class="bx-mx__n">${estadoFila(p) || `<b>${hojasOn(p).length}</b> hojas`}</td></tr>`;
  }).join("");
  return `<div class="bx bx--b3">
    <div class="bx-bar">${kamSel()}${langSeg()}${mesSel()}<span class="bx-bar__sp"></span><div class="bx-field"><span class="bx-field__lbl">Plantilla</span>${presetChips()}</div></div>
    <p class="bx-hint">Clic en el nombre de una columna la prende o apaga para todos; clic en una celda, solo para ese partner. "—" = ese partner no tiene esa hoja.</p>
    <div class="ui-table-wrap bx-mx"><table class="ui-table"><thead><tr><th scope="col" class="bx-mx__p"><button type="button" class="bx-link" data-act="bxSelTodos">${s.size === ps.length ? "Quitar todos" : "Elegir todos"}</button></th><th scope="col">Vista</th>${head}<th scope="col" class="bx-mx__n">PDF</th></tr></thead><tbody>${filas}</tbody></table></div>
    ${pie()}
  </div>`;
}

export function renderPres(): string {
  const v = PS.pres.v;
  return v === "b2" ? b2() : v === "b3" ? b3() : b1();
}
export { fmt, badge, dot, TIPO };
