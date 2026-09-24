// dev/proto/chrome.ts — Estructura de la app en el prototipo ?ui=proto.
//
// Mismo marcado y MISMAS clases que index.html + shell.ts (barra superior,
// navegación agrupada, panel de "Filtros", encabezado de página con chips del
// alcance y frescura), para que lo que se ve sea lo que la app pinta. Los ids
// de la app NO se repiten (app.ts/data.ts los leen): acá llevan prefijo pr.

import { sideNav, pageHeader, rawHtml, segmented, type Html } from "../../shared/ui";
import { iconSvg } from "../../shared/icons";
import { escapeHTML as e } from "../../core/security";
import { hashColor } from "../../core/format";
import { PS, VERSIONES, type Pagina } from "./state";
import { SEMANAS, PARTNERS, KAMS, SIN_KAM, CIUDADES, cityLabel, d2s, partnersDeKam, filtrosPorDefecto, semanasRango } from "./model";

const NAV = [
  { label: "Análisis", items: [
    { id: "rend", label: "Rendimiento", icon: "chart-line" as const },
    { id: "metas", label: "Metas", icon: "target" as const }] },
  { label: "Planificación", items: [
    { id: "calculator", label: "Calculadora", icon: "calculator" as const },
    { id: "seguimiento", label: "Seguimiento", icon: "list-check" as const }] },
  { label: "Entregables", items: [
    { id: "present2", label: "Presentación", icon: "presentation" as const }] },
  { label: "Datos", items: [
    { id: "rawdata", label: "Data Raw", icon: "table" as const },
    { id: "config", label: "Configuración", icon: "settings" as const }] }
];
export const NAV_ID: Record<Pagina, string> = { rend: "rend", metas: "metas", calc: "calculator", config: "config" };
export const PAGE_DE_NAV: Record<string, Pagina> = { rend: "rend", metas: "metas", calculator: "calc", config: "config" };

const LOGO = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;

export function topbar(): string {
  const up = PS.menu === "upload", us = PS.menu === "user";
  const item = (ico: string, txt: string) => `<button type="button" class="upload-menu-item" data-act="prToast" data-msg="Abriría el selector de archivo (${e(txt)})">${iconSvg(ico, { size: 16 })}<span>${e(txt)}</span></button>`;
  const tema = (pref: string, ico: string, txt: string) => {
    const on = PS.theme === pref;
    return `<button type="button" class="user-menu-item user-menu-item--opt" data-act="prTheme" data-value="${pref}" aria-pressed="${on}">${iconSvg(ico, { size: 16 })}<span>${txt}</span>${on ? `<span class="user-menu-check">${iconSvg("check", { size: 14 })}</span>` : ""}</button>`;
  };
  return `<header class="topbar">
    <button type="button" class="shell-icon-btn shell-hamburger" data-act="prToast" data-msg="En pantallas chicas abre la navegación" aria-label="Abrir menú">${iconSvg("menu", { size: 20 })}</button>
    <div class="shell-brand"><div class="logo">${LOGO}</div>
      <div class="shell-brand__text" translate="no"><div class="brand">YANGO <span>Dashboard</span></div><div class="brand-sub">Partner Performance Analytics</div></div></div>
    <div class="topbar-right">
      <div class="upload-dropdown">
        <button type="button" class="shell-icon-btn upload-main-btn" data-act="prMenu" data-value="upload" aria-haspopup="true" aria-expanded="${up}" title="Subir datos">${iconSvg("upload", { size: 18 })}<span class="ui-sr-only">Subir datos</span></button>
        <div class="upload-menu${up ? " open" : ""}">
          <div class="upload-menu-title">Subir datos</div>
          ${item("activity", "Rendimiento semanal")}${item("calendar", "Rendimiento mensual")}${item("clock", "Rendimiento diario")}
          ${item("target", "Metas")}${item("users", "Partners")}${item("car", "Flotas")}${item("trending-up", "Conversión (país)")}
          <button type="button" class="upload-menu-item upload-menu-more" data-act="prIrCfg" data-value="cargas">${iconSvg("arrow-right", { size: 16 })}<span>Ver todas las cargas</span></button>
        </div>
      </div>
      <select class="lang-select" data-act-change="prLang" title="Idioma de la interfaz"><option value="es" selected>🇪🇸 Español</option><option value="en">🇬🇧 English</option><option value="ru">🇷🇺 Русский</option></select>
      <div class="user-menu-wrap">
        <button type="button" class="user-badge" data-act="prMenu" data-value="user" aria-haspopup="true" aria-expanded="${us}" title="admin@local.test"><span class="user-badge-ico">${iconSvg("user", { size: 16 })}</span><span class="user-badge-mail">admin@local.test</span><span class="user-badge-chev">${iconSvg("chevron-down", { size: 14 })}</span></button>
        <div class="user-menu${us ? " open" : ""}">
          <div class="user-menu-group" role="group" aria-label="Tema"><div class="user-menu-title" aria-hidden="true">Tema</div>
            ${tema("light", "sun", "Claro")}${tema("dark", "moon", "Oscuro")}
            <button type="button" class="user-menu-item user-menu-item--opt" data-act="prToast" data-msg="Sistema: sigue el tema del sistema operativo" aria-pressed="false">${iconSvg("monitor", { size: 16 })}<span>Sistema</span></button>
          </div><div class="user-menu-sep" role="separator"></div>
          <button type="button" class="user-menu-item" data-act="prToast" data-msg="En el prototipo no se cierra sesión">${iconSvg("log-out", { size: 16 })}<span>Salir</span></button>
        </div>
      </div>
    </div>
  </header>`;
}

export function nav(): string {
  const lbl = PS.rail ? "Expandir menú" : "Contraer menú";
  return `<div class="shell-nav">${sideNav(NAV, NAV_ID[PS.page], "prNav", "Secciones", { itemTitles: true })}
    <div class="shell-nav__foot"><button type="button" class="shell-nav__collapse" data-act="prRail" aria-expanded="${!PS.rail}" aria-label="${lbl}" title="${lbl}">${iconSvg(PS.rail ? "chevron-right" : "chevron-left", { size: 18 })}<span class="ui-sidenav__text">${lbl}</span></button></div></div>`;
}

/** Panel de "Filtros" (solo Rendimiento y Metas, como en la app). */
export function filtros(): string {
  const F = PS.F;
  const opt = (v: string, t: string, on: boolean) => `<option value="${e(v)}"${on ? " selected" : ""}>${e(t)}</option>`;
  const semOpts = (cur: string) => SEMANAS.map(w => opt(w, d2s(w), w === cur)).join("");
  const q = F.buscar.trim().toLowerCase();
  const lista = (F.kam === "all" ? PARTNERS : partnersDeKam(F.kam)).filter(p => !q || p.toLowerCase().includes(q));
  const sinKam = partnersDeKam(SIN_KAM).length;
  const plist = lista.map(p => {
    const id = "prc_" + p.replace(/[^A-Za-z0-9]/g, "_");
    return `<div class="pi" style="height:28px"><input type="checkbox" id="${id}" data-act-change="prPart" data-p="${e(p)}"${F.sel.has(p) ? " checked" : ""}>` +
      `<label for="${id}" title="${e(p)}"><span class="pdot" style="background:${hashColor(p)}"></span>${e(p)}</label></div>`;
  }).join("");
  return `<div class="sidebar-wrap"><aside class="sidebar${PS.filtros ? "" : " collapsed"}" aria-label="Filtros">
    <div class="fp-head"><div class="fp-title">${iconSvg("filter", { size: 16 })}<span>Filtros</span></div>
      <button type="button" class="shell-icon-btn shell-icon-btn--sm fp-close" data-act="prFiltros" title="Ocultar filtros" aria-label="Ocultar filtros">${iconSvg("chevron-left", { size: 16 })}</button></div>
    <div class="fp-group"><div class="sb-label">Escala</div><div class="mode-toggle-row" role="group" aria-label="Escala">
      ${(["diario", "semanal", "mensual"] as const).map(m => `<button type="button" class="mode-btn${F.escala === m ? " active" : ""}" data-act="prEscala" data-value="${m}">${m.charAt(0).toUpperCase() + m.slice(1)}</button>`).join("")}
    </div></div>
    <div class="fp-group"><div class="sb-label">Rango de fechas</div>
      <div class="date-grid"><div><label for="prDesde">Desde</label><select class="sb-sel" id="prDesde" data-act-change="prDesde">${semOpts(F.desde)}</select></div>
        <div><label for="prHasta">Hasta</label><select class="sb-sel" id="prHasta" data-act-change="prHasta">${semOpts(F.hasta)}</select></div></div>
      <div class="fp-presets">
        <button class="preset-btn" data-act="prPreset" data-value="week">Esta semana</button>
        <button class="preset-btn" data-act="prPreset" data-value="fortnight">Quincena</button>
        <button class="preset-btn" data-act="prPreset" data-value="month">Este mes</button>
      </div></div>
    <div class="fp-group"><label class="sb-label" for="prCity">Ciudad</label>
      <select class="sb-sel" id="prCity" data-act-change="prCiudad">${opt("all", "Total Perú", F.ciudad === "all")}${CIUDADES.map(c => opt(c, cityLabel(c), F.ciudad === c)).join("")}</select></div>
    <div class="fp-group"><label class="sb-label" for="prKam">KAM</label>
      <select class="sb-sel" id="prKam" data-act-change="prKam">${opt("all", "Todos", F.kam === "all")}${KAMS.map(k => opt(k, k, F.kam === k)).join("")}${opt(SIN_KAM, `Sin KAM (${sinKam})`, F.kam === SIN_KAM)}</select></div>
    <div class="fp-group"><label class="sb-label" for="prBuscar">Buscar partner</label>
      <input class="sb-inp" id="prBuscar" type="text" placeholder="Filtrar..." value="${e(F.buscar)}" data-act-input="prBuscar"></div>
    <div class="fp-group"><div class="sb-label">Partners</div>
      <div class="sb-row"><button type="button" data-act="prTodos">Todos</button><button type="button" data-act="prNinguno">Ninguno</button></div>
      <div class="plist">${plist || `<div class="pr-muted" style="padding:6px">Ningún partner coincide</div>`}</div></div>
  </aside></div>`;
}

// ── Encabezado de página ────────────────────────────────────────────────────
const TIT: Record<Pagina, [string, string]> = {
  rend: ["Rendimiento", "Conductores activos, N+R, horas y viajes del período"],
  metas: ["Metas", "Avance contra las metas mensuales"],
  calc: ["Calculadora", "Reparte la meta del KAM entre sus partners"],
  config: ["Configuración", "Partners, usuarios, monitoreo y mantenimiento"]
};
const LINEA_LBL = { comb: "Combinado", agg: "Agregador", fleet: "Fleet", tk: "TukTuk" };

export function chipsAlcance() {
  const F = PS.F, D = filtrosPorDefecto();
  const line = PS.page === "metas" ? PS.metasLine : PS.rendLine;
  const ws = semanasRango(F);
  const chips: { label?: string; value: string; removeAct?: string; removeData?: any }[] = [];
  const q = (k: string, cond: boolean) => cond ? { removeAct: "prQuitarChip", removeData: { k } } : {};
  chips.push({ label: "Escala", value: F.escala.charAt(0).toUpperCase() + F.escala.slice(1), ...q("escala", F.escala !== "semanal") });
  chips.push({ label: "Rango", value: `${d2s(ws[0] || F.desde)} – ${d2s(ws[ws.length - 1] || F.hasta)}`, ...q("rango", F.desde !== D.desde || F.hasta !== D.hasta) });
  if (F.ciudad !== "all") chips.push({ label: "Ciudad", value: cityLabel(F.ciudad), ...q("ciudad", true) });
  if (F.kam !== "all") chips.push({ label: "KAM", value: F.kam, ...q("kam", true) });
  if (line !== "comb") chips.push({ label: "Línea", value: LINEA_LBL[line], ...q("linea", true) });
  const universo = F.kam === "all" ? PARTNERS : partnersDeKam(F.kam);
  const n = universo.filter(p => F.sel.has(p)).length;
  if (n !== universo.length) chips.push({ value: `${n} de ${universo.length} partners`, ...q("partners", true) });
  const recorte = chips.some(c => c.removeAct);
  return { chips, recorte };
}

export function encabezado(): Html {
  const [title, subtitle] = TIT[PS.page];
  const conPanel = PS.page === "rend" || PS.page === "metas";
  const { chips, recorte } = conPanel ? chipsAlcance() : { chips: [], recorte: false };
  const acciones = conPanel
    ? rawHtml(`<button type="button" class="ui-btn ui-btn--secondary ui-btn--sm shell-filtros-btn" data-act="prFiltros" aria-expanded="${PS.filtros}" title="${PS.filtros ? "Ocultar filtros" : "Mostrar filtros"}">${iconSvg("filter", { size: 14 })}<span>Filtros</span></button>`)
    : undefined;
  return pageHeader({
    title, subtitle, actions: acciones,
    chips: chips.map(c => ({ ...c, removeLabel: `Quitar filtro ${c.label ? c.label + ": " : ""}${c.value}` })),
    resetAct: recorte ? "prReset" : undefined, resetLabel: "Restablecer",
    freshness: PS.page === "config" ? undefined : { text: "datos hasta 2026-09-14" },
    footer: rawHtml(`<div class="shell-slot shell-slot--banner"><div class="ds-banner" style="display:flex" role="status"><span class="ds-dot"></span><span>Datos cargados · 8:16 a. m.</span></div></div>`)
  });
}

// ── Selector de versión (flotante, NO es parte de la app) ──────────────────
export function selector(): string {
  const pages: [Pagina, string][] = [["rend", "Rendimiento"], ["metas", "Metas"], ["calc", "Calculadora"], ["config", "Configuración"]];
  if (!PS.switchAbierto) {
    return `<div class="pr-switch pr-switch--min"><button type="button" class="pr-switch__pill" data-act="prSwitch" title="Abrir el selector de versión">${iconSvg("eye", { size: 14 })}<span>${e(VERSIONES.find(v => v.id === PS.v)!.label)}</span></button></div>`;
  }
  return `<div class="pr-switch" role="region" aria-label="Selector del prototipo">
    <div class="pr-switch__head"><strong>Prototipo</strong><span class="pr-switch__hint">nada se guarda</span>
      <button type="button" class="pr-switch__x" data-act="prSwitch" title="Minimizar" aria-label="Minimizar">${iconSvg("minus", { size: 14 })}</button></div>
    <div class="pr-switch__row">${segmented({ ariaLabel: "Versión", act: "prVer", value: PS.v, options: VERSIONES.map(v => ({ value: v.id, label: v.label })) })}</div>
    <div class="pr-switch__row">${segmented({ ariaLabel: "Página", act: "prPage", value: PS.page, options: pages.map(([v, l]) => ({ value: v, label: l })) })}
      ${segmented({ ariaLabel: "Tema", act: "prTheme", value: PS.theme, options: [{ value: "light", label: "Claro", icon: "sun" }, { value: "dark", label: "Oscuro", icon: "moon" }] })}
      <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" data-act="prCerrar">${iconSvg("x", { size: 14 })}<span>Cerrar</span></button></div>
    <div class="pr-switch__desc">${e(VERSIONES.find(v => v.id === PS.v)!.desc)}</div>
  </div>`;
}
