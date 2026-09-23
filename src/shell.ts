//@ts-nocheck
// shell.ts — Estructura de la app (Ola 5, sep-2026): navegación lateral,
// encabezado de página con el alcance activo, y los toggles de la estructura.
//
// Lo que NO hace: pintar el contenido de las vistas (eso es de cada módulo y se
// rediseña en la Ola 6) ni leer datos. Solo LEE el estado de los filtros por
// las mismas vías que las vistas (getCurrentFilters, STATE.curMode,
// STATE.rendLine/metasLine) y, para quitar un filtro, dispara los MISMOS
// eventos/acciones que usa el panel de filtros — así la lógica de filtrado de
// app.ts/data.ts sigue siendo una sola.
//
// Las funciones de app.ts/data.ts se usan como globales (window) a propósito:
// app.ts importa este módulo, y un import en sentido contrario sería circular.

import { STATE } from "./core/config.js";
import { t, kamLabel, getLang } from "./core/i18n";
import { cityLabel, d2s } from "./core/format.js";
import { escapeHTML } from "./core/security.js";
import { sideNav, pageHeader, rawHtml } from "./shared/ui";
import { iconSvg } from "./shared/icons";
import { chipsAlcance, hayRecorte, ESCALA_DEF, LINEA_DEF } from "./shared/chipsAlcance";
import { registerActions } from "./shared/actions.js";

// ── Navegación ───────────────────────────────────────────────────────────────
// Grupos y orden de la dirección A (plan sep-2026, decisión 1). Los ids son los
// data-tab de siempre: switchTab() no cambió.
export const NAV_GROUPS = [
  { label: "nav.analisis", items: [
    { id: "rend",        label: "nav.rendimiento",  icon: "chart-line" },
    { id: "metas",       label: "nav.metas",        icon: "target" }
  ] },
  { label: "nav.grupo.planificacion", items: [
    { id: "calculator",  label: "nav.calculadora",  icon: "calculator" },
    { id: "seguimiento", label: "nav.seguimiento",  icon: "list-check" }
  ] },
  { label: "nav.grupo.entregables", items: [
    { id: "present2",    label: "nav.present2",     icon: "presentation" }
  ] },
  { label: "nav.grupo.datos", items: [
    { id: "rawdata",     label: "nav.dataRaw",      icon: "table" },
    { id: "config",      label: "nav.config",       icon: "settings" }
  ] }
];

// Visibilidad por rol: ESPEJO del gating que ya existía (auth._applyRoleGate):
// los tres roles internos (admin/kam/viewer) ven las 8 secciones —lo que cada
// uno puede HACER adentro lo decide cada vista y, de verdad, RLS—; un partner
// no ve ninguna (su única vista es el portal). No es seguridad: es no ofrecer
// UI que no corresponde.
export function tabsVisibles(rol) {
  if (rol === "partner") return [];
  return NAV_GROUPS.flatMap(g => g.items.map(i => i.id));
}

const _LS_RAIL = "yangoNavRail";
const _mqDrawer = () => window.matchMedia && window.matchMedia("(max-width: 1023.98px)").matches;

function _lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function _lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* privado */ } }

export function renderShellNav() {
  const el = document.getElementById("appNav");
  if (!el) return;
  const vis = new Set(tabsVisibles(STATE.userRole));
  const groups = NAV_GROUPS
    .map(g => ({ label: t(g.label), items: g.items.filter(i => vis.has(i.id)).map(i => ({ id: i.id, label: t(i.label), icon: i.icon })) }))
    .filter(g => g.items.length);
  const rail = document.body.classList.contains("nav-rail");
  const lbl = t(rail ? "shell.nav.expandir" : "shell.nav.contraer");
  el.innerHTML =
    sideNav(groups, STATE.curTab || "rend", "switchTab", t("shell.nav.aria"), { id: "appNavList", itemTitles: true }) +
    `<div class="shell-nav__foot">` +
    `<button type="button" class="shell-nav__collapse" data-act="toggleNavRail" aria-controls="appNav" ` +
    `aria-expanded="${!rail}" aria-label="${escapeHTML(lbl)}" title="${escapeHTML(lbl)}">` +
    iconSvg(rail ? "chevron-right" : "chevron-left", { size: 18 }) +
    `<span class="ui-sidenav__text">${escapeHTML(lbl)}</span></button></div>`;
}

/** Marca la sección activa (aria-current) sin repintar la navegación. */
export function syncNavActive(tab) {
  document.querySelectorAll("#appNav .ui-sidenav__item[data-tab]").forEach(b => {
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
}

/** Contraer/expandir la navegación a una barra de iconos (preferencia guardada). */
export function toggleNavRail() {
  // El botón se vuelve a crear al repintar: si tenía el foco (teclado), se le
  // devuelve para no perder la posición.
  const teniaFoco = !!document.activeElement?.closest?.(".shell-nav__collapse");
  const rail = document.body.classList.toggle("nav-rail");
  _lsSet(_LS_RAIL, rail ? "1" : "0");
  renderShellNav();
  if (teniaFoco) document.querySelector("#appNav .shell-nav__collapse")?.focus();
  // El ResizeObserver de .main (charts.ts) ya re-mide las gráficas; el resize
  // de window cubre a quien escuche solo ese evento (mismo patrón que el panel
  // de filtros).
  setTimeout(() => window.dispatchEvent(new Event("resize")), 220);
}

/** Estado inicial de la barra: la preferencia guardada, o contraída por defecto
 *  en pantallas medianas (1024–1279 px), donde el ancho hace falta para datos. */
export function restoreNavState() {
  const pref = _lsGet(_LS_RAIL);
  const rail = pref === "1" || (pref === null && window.innerWidth < 1280);
  document.body.classList.toggle("nav-rail", rail);
}

// Cajón (< 1024 px): la hamburguesa lo abre, el velo / Escape / elegir una
// sección lo cierran.
export function toggleNavDrawer(force) {
  const open = typeof force === "boolean" ? force : !document.body.classList.contains("nav-open");
  document.body.classList.toggle("nav-open", open);
  const hb = document.getElementById("navHamburger");
  if (hb) {
    hb.setAttribute("aria-expanded", String(open));
    const k = open ? "shell.nav.cerrar" : "shell.nav.abrir";
    hb.setAttribute("aria-label", t(k));
    hb.setAttribute("data-i18n-aria", k);
  }
  if (open) {
    // Después del cambio de visibilidad (el cajón sale de visibility:hidden).
    setTimeout(() => {
      const cur = document.querySelector('#appNav [aria-current="page"]') || document.querySelector("#appNav .ui-sidenav__item");
      cur?.focus();
    }, 30);
  }
}
export function closeNavDrawer() {
  if (document.body.classList.contains("nav-open")) toggleNavDrawer(false);
}

// ── Panel de filtros: aria-expanded de todos sus disparadores ────────────────
export function syncFiltrosAria() {
  const sb = document.getElementById("mainSidebar");
  const abierto = !!sb && !sb.classList.contains("collapsed");
  document.querySelectorAll('[data-act="toggleSidebar"][aria-controls="mainSidebar"]').forEach(b => {
    b.setAttribute("aria-expanded", String(abierto));
  });
  const hb = document.querySelector(".shell-filtros-btn");
  if (hb) {
    const k = abierto ? "shell.filtros.ocultar" : "shell.filtros.mostrar";
    hb.setAttribute("title", t(k));
  }
}

// ── Encabezado de página ─────────────────────────────────────────────────────
const _CHIPS_FILTRO = ["escala", "rango", "ciudad", "kam", "linea", "partners"];
const TAB_META = {
  rend:        { title: "nav.rendimiento",  sub: "shell.sub.rend",        chips: _CHIPS_FILTRO, line: () => STATE.rendLine || LINEA_DEF },
  metas:       { title: "nav.metas",        sub: "shell.sub.metas",       chips: _CHIPS_FILTRO, line: () => STATE.metasLine || LINEA_DEF },
  calculator:  { title: "nav.calculadora",  sub: "shell.sub.calculator" },
  seguimiento: { title: "nav.seguimiento",  sub: "shell.sub.seguimiento" },
  rawdata:     { title: "nav.dataRaw",      sub: "shell.sub.rawdata" },
  config:      { title: "nav.config",       sub: "shell.sub.config" },
  portal:      { title: "shell.portal.titulo" }
};
// Pestañas que muestran el panel de filtros (las demás están en NO_SIDEBAR_TABS
// de app.ts; Presentación va a pantalla completa y no lleva encabezado).
const _TABS_CON_PANEL = new Set(["rend", "metas", "portal"]);

const _TABS_CON_FRESCURA = new Set(["rend", "metas", "calculator", "rawdata"]);

const _LINEA_LBL = { comb: () => t("rend.linea.comb"), agg: () => t("rend.linea.agg"), fleet: () => "Fleet", tk: () => "TukTuk" };

/** Foto del alcance, leída de los MISMOS lugares que leen las vistas. */
export function fotoAlcance(tab) {
  const meta = TAB_META[tab] || {};
  const f = typeof window.getCurrentFilters === "function" ? window.getCurrentFilters()
    : { city: "all", from: "", to: "", kam: "all", selected: [] };
  const def = typeof window.rangoPorDefecto === "function" ? window.rangoPorDefecto() : { from: "", to: "" };
  const universo = (STATE.sidebarPartners && STATE.sidebarPartners.length) ? STATE.sidebarPartners : (STATE.allPartners || []);
  const deKam = f.kam && f.kam !== "all" && STATE.KAM_PARTNERS ? STATE.KAM_PARTNERS[f.kam] || null : null;
  return {
    claves: meta.chips || [],
    escala: STATE.curMode || ESCALA_DEF,
    desde: f.from, hasta: f.to, desdeDef: def.from, hastaDef: def.to,
    ciudad: f.city, kam: f.kam,
    linea: meta.line ? meta.line() : null,
    seleccion: f.selected || [], universo, deKam
  };
}

function _chipTexto(c, foto) {
  switch (c.k) {
    case "escala":   return { label: t("shell.chip.escala"), value: t(`mode.${foto.escala}`) };
    case "rango":    return { label: t("shell.chip.rango"),
                              value: foto.desde === foto.hasta ? d2s(foto.desde) : `${d2s(foto.desde)} – ${d2s(foto.hasta)}` };
    case "ciudad":   return { label: t("sidebar.ciudad"), value: cityLabel(foto.ciudad) };
    case "kam":      return { label: t("sidebar.kam"), value: kamLabel(foto.kam) };
    case "linea":    return { label: t("shell.chip.linea"), value: (_LINEA_LBL[foto.linea] || (() => foto.linea))() };
    case "partners": return { label: "", value: t("alcance.partners", { n: c.n, total: c.total }) };
  }
  return { label: "", value: "" };
}

function _nombresPartner() {
  const rows = (STATE.rawDataFull && STATE.rawDataFull.length) ? STATE.rawDataFull : (STATE.rawData || []);
  const set = new Set();
  for (const r of rows) { if (r && r.partner) set.add(r.partner); if (set.size > 6) break; }
  const arr = [...set].sort();
  if (arr.length <= 3) return arr.join(" · ");
  return arr.slice(0, 3).join(" · ") + ` +${arr.length - 3}`;
}

// Nodos persistentes: data.ts/app.ts los muestran/ocultan por id con
// .style.display (y huella.js lee #dataRefreshing para saber si la app está
// quieta), así que NO se recrean: se rescatan antes de repintar y se vuelven a
// colgar en su lugar del encabezado.
const _PERSISTENTES = [["dataRefreshing", "refresh"], ["dsBanner", "banner"]];

export function renderPageHeader() {
  const host = document.getElementById("pageHeader");
  if (!host) return;
  const persist = document.getElementById("shellPersist");
  for (const [id] of _PERSISTENTES) {
    const n = document.getElementById(id);
    if (n && persist && n.parentNode !== persist) persist.appendChild(n);
  }
  const tab = STATE.curTab || "rend";
  const meta = TAB_META[tab];
  const esPartner = STATE.userRole === "partner";
  const pn = document.getElementById("shellPartnerName");
  if (pn) pn.textContent = esPartner ? _nombresPartner() : "";
  if (!meta) { host.innerHTML = ""; return; }

  const conPanel = _TABS_CON_PANEL.has(tab);
  let chips = [], reset = false;
  if (conPanel && !esPartner) {
    const foto = fotoAlcance(tab);
    const cs = chipsAlcance(foto);
    reset = hayRecorte(cs);
    chips = cs.map(c => {
      const tx = _chipTexto(c, foto);
      const full = tx.label ? `${tx.label}: ${tx.value}` : tx.value;
      return {
        label: tx.label || undefined, value: tx.value,
        removeAct: c.quitable ? "shellQuitarChip" : undefined,
        removeData: c.quitable ? { k: c.k } : undefined,
        removeLabel: t("shell.chip.quitar", { f: full })
      };
    });
  }

  let acciones = "";
  if (conPanel) {
    const sb = document.getElementById("mainSidebar");
    const abierto = !!sb && !sb.classList.contains("collapsed");
    acciones = `<button type="button" class="ui-btn ui-btn--secondary ui-btn--sm shell-filtros-btn" data-act="toggleSidebar" ` +
      `aria-controls="mainSidebar" aria-expanded="${abierto}" title="${escapeHTML(t(abierto ? "shell.filtros.ocultar" : "shell.filtros.mostrar"))}">` +
      `${iconSvg("filter", { size: 14 })}<span>${escapeHTML(t("shell.filtros"))}</span></button>`;
  }

  // Frescura: solo en las vistas que muestran datos de rendimiento (en
  // Seguimiento o Configuración no responde a ninguna pregunta de la pantalla).
  // Nunca al partner: "faltan N períodos" es información interna.
  const fr = !esPartner && _TABS_CON_FRESCURA.has(tab) && STATE._frescuraUI ? STATE._frescuraUI : null;
  host.innerHTML = pageHeader({
    title: t(meta.title),
    subtitle: esPartner ? _nombresPartner() : (meta.sub ? t(meta.sub) : undefined),
    actions: acciones ? rawHtml(acciones) : undefined,
    chips,
    chipsLabel: t("shell.chips.aria"),
    resetAct: reset ? "shellRestablecer" : undefined,
    resetLabel: t("shell.restablecer"),
    freshness: fr ? { text: fr.text, stale: fr.stale, title: fr.title || undefined } : undefined,
    metaExtra: rawHtml(`<span class="shell-slot" data-slot="refresh"></span>`),
    footer: rawHtml(`<div class="shell-slot shell-slot--banner" data-slot="banner"></div>`)
  });
  for (const [id, slot] of _PERSISTENTES) {
    const n = document.getElementById(id);
    const s = host.querySelector(`[data-slot="${slot}"]`);
    if (n && s) s.appendChild(n);
  }
  // setUiLang repinta el encabezado: el estado de la carga va en el idioma nuevo.
  refrescarEstadoCarga();
}

// ── Estado de la carga ("Datos cargados · 4:31 p. m.") ───────────────────────
// Se guarda la RECETA (hora y cantidad de avisos) además del texto, para poder
// re-traducirlo al cambiar de idioma: antes quedaba en el idioma en que se cargó.
// Solo se re-escribe si el aviso visible sigue siendo ESE (un error posterior
// de showBanner no se pisa).
const _LOCALE_HORA = { es: "es-PE", en: "en-US", ru: "ru-RU" };
let _estadoOk = null;   // { at, nWarn, msg }
function _textoEstadoCarga(at, nWarn) {
  const warn = nWarn ? ` · ⚠ ${t("datos.camposInvalidos", { n: nWarn })}` : "";
  return t("estado.datosCargados") + " · " +
    new Date(at).toLocaleTimeString(_LOCALE_HORA[getLang()] || "es-PE") + warn;
}
/** Pinta "Datos cargados · hh:mm" (lo llama data.ts al terminar una carga). */
export function mostrarEstadoCarga(nWarn = 0) {
  const at = Date.now();
  const msg = _textoEstadoCarga(at, nWarn);
  _estadoOk = { at, nWarn, msg };
  if (typeof window.showBanner === "function") window.showBanner(true, msg);
}
/** Re-traduce el estado de la carga si es lo que se está mostrando. */
export function refrescarEstadoCarga() {
  if (!_estadoOk) return;
  const el = document.getElementById("dsBanner");
  const span = el && el.lastElementChild;
  if (!span || el.classList.contains("err") || span.textContent !== _estadoOk.msg) return;
  const msg = _textoEstadoCarga(_estadoOk.at, _estadoOk.nWarn);
  span.textContent = msg;
  _estadoOk.msg = msg;
}

let _phTimer = null;
/** Repinta el encabezado en el próximo tick (junta varios cambios seguidos). */
export function schedulePageHeader() {
  clearTimeout(_phTimer);
  _phTimer = setTimeout(renderPageHeader, 0);
}

// ── Quitar un chip / Restablecer ─────────────────────────────────────────────
function _disparar(el, ev = "change") {
  if (el) el.dispatchEvent(new Event(ev, { bubbles: true }));
}

export function quitarChipAlcance(k) {
  const w = window;
  const $ = id => document.getElementById(id);
  switch (k) {
    case "escala":
      // El mismo botón del panel (misma acción switchMode).
      document.querySelector('#mainSidebar .mode-btn[data-mode="' + ESCALA_DEF + '"]')?.click();
      break;
    case "rango": {
      const def = typeof w.rangoPorDefecto === "function" ? w.rangoPorDefecto() : null;
      if (!def || !def.from) break;
      if ($("dateFrom")) $("dateFrom").value = def.from;
      if ($("dateTo"))   $("dateTo").value   = def.to;
      _disparar($("dateTo"));          // listener change → applyFilters (debounced)
      break;
    }
    case "ciudad":
      if ($("cityFilter")) { $("cityFilter").value = "all"; _disparar($("cityFilter")); }
      break;
    case "kam":
      // data-act-change="onKAMChange" del mismo <select>.
      if ($("kamFilter")) { $("kamFilter").value = "all"; _disparar($("kamFilter")); }
      break;
    case "linea": {
      const act = STATE.curTab === "metas" ? "setMetasLine" : "setRendLine";
      const b = document.querySelector(`#tab-${STATE.curTab} [data-act="${act}"][data-line="${LINEA_DEF}"]`);
      if (b) b.click();
      else if (typeof w[act] === "function") w[act](LINEA_DEF);
      break;
    }
    case "partners": {
      const kam = $("kamFilter")?.value || "all";
      if (kam === "all") document.querySelector('#mainSidebar [data-act="selectAll"]')?.click();
      else if (typeof w.onKAMChange === "function") w.onKAMChange();   // vuelve a los del KAM
      break;
    }
  }
  schedulePageHeader();
}

/** Todo el alcance a sus valores por defecto: Total Perú, todos los KAMs y
 *  partners, rango por defecto, línea Combinado y escala semanal. */
export function restablecerAlcance() {
  const w = window;
  const $ = id => document.getElementById(id);
  if (STATE.curTab === "rend")  STATE.rendLine  = LINEA_DEF;
  if (STATE.curTab === "metas") STATE.metasLine = LINEA_DEF;
  if ($("cityFilter")) $("cityFilter").value = "all";
  if ($("kamFilter"))  $("kamFilter").value  = "all";
  if ($("partnerSearch") && $("partnerSearch").value) {
    $("partnerSearch").value = "";
    if (typeof w.filterPList === "function") w.filterPList();
  }
  document.querySelectorAll("#pList input").forEach(c => { c.checked = true; });
  const def = typeof w.rangoPorDefecto === "function" ? w.rangoPorDefecto() : null;
  if (def && def.from) { $("dateFrom").value = def.from; $("dateTo").value = def.to; }
  if (typeof w._debouncedApplyCancel === "function") w._debouncedApplyCancel();
  if (typeof w.saveFilters === "function") w.saveFilters();
  if ((STATE.curMode || ESCALA_DEF) !== ESCALA_DEF && typeof w.switchMode === "function") {
    w.switchMode(ESCALA_DEF);      // repuebla el panel y renderiza al terminar
  } else if (typeof w.applyFilters === "function") {
    w.applyFilters();
  }
  schedulePageHeader();
}

// ── Listeners de la estructura (una vez) ─────────────────────────────────────
let _listos = false;
export function instalarShell() {
  if (_listos) return;
  _listos = true;
  restoreNavState();
  renderShellNav();

  // Cambios en el panel que todavía no pasaron por applyFilters (debounce de
  // 250 ms): el chip se actualiza en el acto.
  document.addEventListener("change", e => {
    const el = e.target;
    if (el && el.closest && el.closest("#mainSidebar")) schedulePageHeader();
  });
  // Línea de negocio: setRendLine/setMetasLine fijan STATE.*Line de forma
  // sincrónica antes de su primer await.
  document.addEventListener("click", e => {
    if (e.target.closest && e.target.closest('[data-act="setRendLine"],[data-act="setMetasLine"]')) schedulePageHeader();
  });

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || document.querySelector(".ui-dialog-backdrop")) return;
    if (document.body.classList.contains("nav-open")) {
      toggleNavDrawer(false);
      document.getElementById("navHamburger")?.focus();
      return;
    }
    let cerro = false;
    ["uploadMenu", "userMenu"].forEach(id => {
      const m = document.getElementById(id);
      if (m && m.classList.contains("open")) { m.classList.remove("open"); cerro = true; }
    });
    if (cerro) { syncMenusAria(); return; }
    // Panel de filtros flotante (tablet): Escape lo cierra.
    const sb = document.getElementById("mainSidebar");
    if (sb && !sb.classList.contains("collapsed") && typeof window._esLayoutTablet === "function"
        && window._esLayoutTablet() && typeof window.toggleSidebar === "function") {
      window.toggleSidebar();
    }
  });

  // Al pasar de cajón a escritorio no puede quedar el velo puesto.
  if (window.matchMedia) {
    const mq = window.matchMedia("(max-width: 1023.98px)");
    const alCambiar = () => { if (!mq.matches) closeNavDrawer(); };
    if (mq.addEventListener) mq.addEventListener("change", alCambiar);
  }
}

/** aria-expanded de los botones de menú según su menú esté abierto. */
export function syncMenusAria() {
  [["uploadMenu", '[data-act="toggleUploadMenu"]'], ["userMenu", '[data-act="toggleUserMenu"]']].forEach(([id, sel]) => {
    const m = document.getElementById(id);
    const b = document.querySelector(sel);
    if (b) b.setAttribute("aria-expanded", String(!!(m && m.classList.contains("open"))));
  });
}

export function esCajonNav() { return _mqDrawer(); }

registerActions({
  toggleNavRail,
  toggleNavDrawer: () => toggleNavDrawer(),
  shellQuitarChip: d => quitarChipAlcance(d.k),
  shellRestablecer: () => restablecerAlcance()
});
