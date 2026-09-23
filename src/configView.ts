//@ts-nocheck
// configView.ts — Configuración (Ola 6, sep-2026)
//
// Arquitectura de información nueva de Configuración, en un chunk propio que
// app.ts (renderConfig) importa bajo demanda: nadie paga este código en el
// arranque.
//
//   Datos maestros · Partners (tabla única por CLID, pendientes de alta,
//                               reasignar KAM en bloque, panel lateral)
//                  · Clasificación (sub-flotas CLID → db_id con valor
//                               EFECTIVO y si es explícito o heredado; flotas;
//                               conciliación — se mudó desde Data Raw)
//                  · Cargas (los Excel como tarjetas; el menú de la barra
//                               sigue siendo un atajo a los MISMOS inputs)
//   Accesos        · Usuarios (adminUsers.ts) · Monitoreo (monitoreo.ts)
//   Sistema        · Preferencias (alerta de declive) · Mantenimiento (borrado)
//
// Reglas que se conservan de la Ola 1: la UI es ESPEJO de RLS (domain/
// permisosUI.ts), toda escritura pide `.select()` y trata 0 filas como "no se
// guardó", y después de escribir datos maestros se refresca con
// refrescarTrasEscritura() (que además invalida mensual/diario/conversión).

import { registerActions } from "./shared/actions.js";
import { t, kamLabel, mesLabel } from "./core/i18n";
import { STATE, SIN_KAM } from "./core/config.js";
import { escapeHTML } from "./core/security";
import { fmt, fmt5, cityLabel, d2s } from "./core/format";
import { mesIndice } from "./core/meses";
import { sb } from "./auth.js";
import {
  guardarLogoPartner, borrarLogoPartner, ensurePartnerLogos, refrescarTrasEscritura,
  setFleetroomFlags, setPartnerFlag, updateFlotaField, createFlota, fetchAllPeriods,
  rowIsFleet, rowIsTuktuk, rowExcludedFromTaxi, dropLegacyAggregateRows
} from "./data.js";
import { puede as puedeUI, msgSinFilas } from "./domain/permisosUI";
import { filtroMetasDeMes } from "./domain/borrarDatos";
import {
  armarFilasPartners, esPendiente, kamsCanonicos, kamDuplicado,
  clasifSubflota, patchMaterializar
} from "./domain/partnersMaestro";
import { btn, badge, alertBox, emptyState, icon, segmented } from "./shared/ui";
import { confirmDialog, alertDialog } from "./shared/confirmDialog";
import { logAccess } from "./shared/accessLog.js";
import { filaCSV } from "./shared/csv";
import { fechaLimaISO } from "./core/dates";
import { CONFIG_STATE, CARGAS_SESION, showBanner, showLoad, lsSet, renderConfig } from "./app.js";

const e = s => escapeHTML(s == null ? "" : String(s));
const CIUDADES = ["LIMA", "TRUJILLO", "AREQUIPA"];
const _puede = accion => puedeUI(accion, { rol: STATE.userRole, perms: STATE.perms });

// ── Secciones y visibilidad por rol ──────────────────────────────────────────
function _secciones() {
  const interno = STATE.userRole !== "partner";
  const def = [
    { grupo: "cfg6.grupo.datos", items: [
      { k: "partners",      icon: "users",     ok: interno },
      { k: "clasificacion", icon: "filter",    ok: interno },
      { k: "cargas",        icon: "upload",    ok: interno && !!STATE.canWrite }
    ] },
    { grupo: "cfg6.grupo.accesos", items: [
      { k: "usuarios",  icon: "lock",     ok: !!STATE.isAdmin },
      { k: "monitoreo", icon: "activity", ok: !!STATE.isAdmin }
    ] },
    { grupo: "cfg6.grupo.sistema", items: [
      { k: "preferencias",  icon: "settings", ok: interno },
      { k: "mantenimiento", icon: "database", ok: _puede("datos.borrar") }
    ] }
  ];
  return def.map(g => ({ ...g, items: g.items.filter(i => i.ok) })).filter(g => g.items.length);
}

function _subnavHTML(sec) {
  const grupos = _secciones().map(g => `
    <div class="cfgx-subnav__group" role="group" aria-label="${e(t(g.grupo))}">
      <div class="cfgx-subnav__label" aria-hidden="true">${e(t(g.grupo))}</div>
      ${g.items.map(i => `
        <button type="button" class="cfgx-subnav__item"${i.k === sec ? ' aria-current="page"' : ""}
                data-act="cfgSetSection" data-section="${i.k}">
          ${icon(i.icon, { size: 16 })}<span>${e(t(`cfg6.sec.${i.k}`))}</span>
        </button>`).join("")}
    </div>`).join("");
  return `<nav class="cfgx-subnav" aria-label="${e(t("cfg6.subnavAria"))}">${grupos}</nav>`;
}

function _head(titulo, sub, acciones = "") {
  return `<div class="cfgx-head">
    <div class="cfgx-head__txt"><h2 class="cfgx-head__title">${e(titulo)}</h2>${sub ? `<p class="cfgx-head__sub">${e(sub)}</p>` : ""}</div>
    ${acciones ? `<div class="cfgx-head__actions">${acciones}</div>` : ""}
  </div>`;
}

// ── ENTRADA ──────────────────────────────────────────────────────────────────
export function renderConfigView(content) {
  const visibles = _secciones().flatMap(g => g.items.map(i => i.k));
  if (!visibles.includes(CONFIG_STATE.section)) CONFIG_STATE.section = "partners";
  const sec = CONFIG_STATE.section;

  content.innerHTML = `<div class="cfgx">${_subnavHTML(sec)}<div class="cfgx-body" id="cfgBody"></div></div>`;
  const body = document.getElementById("cfgBody");

  if (sec === "partners")           _renderPartners(body);
  else if (sec === "clasificacion") _renderClasificacion(body);
  else if (sec === "cargas")        _renderCargas(body);
  else if (sec === "usuarios") {
    body.innerHTML = _head(t("cfg6.sec.usuarios"), t("cfg.usuariosSub")) + `<div id="adminUsersBox"></div>`;
    if (typeof window.renderAdminUsers === "function") window.renderAdminUsers();
  } else if (sec === "monitoreo") {
    body.innerHTML = _head(t("cfg6.sec.monitoreo"), t("cfg.monitoreoSub")) + `<div id="monitoreoBox"></div>`;
    if (typeof window.renderMonitoreo === "function") window.renderMonitoreo();
  } else if (sec === "preferencias")  body.innerHTML = _preferenciasHTML();
  else if (sec === "mantenimiento")   body.innerHTML = _mantenimientoHTML();
}

// ═════════════════════════════════════════════════════════════════════════════
// PARTNERS (datos maestros)
// ═════════════════════════════════════════════════════════════════════════════
function* _datosFilas() {
  for (const src of [STATE.rawDataFull, STATE.rawDataMensualFull, STATE.rawDataDiarioFull]) {
    for (const r of (src || [])) {
      if (!r || !r.clid) continue;
      yield { clid: r.clid, partnerExcel: r._partnerExcel || r._partnerOriginal || r.partner,
              kam: r.kam, city: r.city, dbId: r.db_id };
    }
  }
}

function _partnersDB() {
  const out = {};
  for (const clid of Object.keys(STATE.CLID_MAP || {})) {
    out[clid] = {
      partner: STATE.CLID_MAP[clid], kam: (STATE.KAM_MAP || {})[clid] || "",
      isFleet: !!(STATE.CLID_IS_FLEET || {})[clid], isTuktuk: !!(STATE.CLID_IS_TUKTUK || {})[clid]
    };
  }
  return out;
}

export function filasMaestro() {
  return armarFilasPartners(_partnersDB(), STATE.flotasMap || {}, _datosFilas());
}

function _kamsLista() {
  return kamsCanonicos(Object.values(STATE.KAM_MAP || {}),
                       Object.values(STATE.flotasMap || {}).map(f => f.kam));
}

const _kamDe = f => f.kam || SIN_KAM;

function _renderPartners(body) {
  const filas = filasMaestro();
  if (!filas.length) {
    body.innerHTML = _head(t("cfg6.sec.partners"), "") + emptyState({
      icon: "users", title: t("cfg6.p.vacioTitulo"), text: t("cfg.cargaPartnersSub"),
      action: STATE.canWrite ? btn({ label: t("cfg6.cargas.ir"), icon: "upload", act: "cfgSetSection", data: { section: "cargas" } }) : undefined
    });
    return;
  }
  const altas = filas.filter(f => f.alta).length;
  const pend = filas.filter(esPendiente);
  const puedeEsc = _puede("partners.escribir");

  const kams = [...new Set(filas.map(_kamDe))]
    .sort((a, b) => (a === SIN_KAM) - (b === SIN_KAM) || a.localeCompare(b));
  if (CONFIG_STATE.kamFilter !== "all" && !kams.includes(CONFIG_STATE.kamFilter)) CONFIG_STATE.kamFilter = "all";
  const cuenta = k => filas.filter(f => _kamDe(f) === k).length;
  const kamOpts = kams.map(k => `<option value="${e(k)}"${CONFIG_STATE.kamFilter === k ? " selected" : ""}>${e(kamLabel(k))} (${cuenta(k)})</option>`).join("");

  const acciones = puedeEsc ? btn({ label: t("cfg6.p.agregar"), icon: "plus", act: "cfgPanelAlta" }) : "";
  let html = _head(t("cfg6.sec.partners"),
    t("cfg6.p.sub", { n: fmt(filas.length), a: fmt(altas), p: fmt(pend.length) }), acciones);

  html += _pendientesHTML(pend, puedeEsc);

  html += `
    <div class="cfgx-toolbar">
      <input class="ui-input cfgx-search" type="search" id="configSearch" placeholder="${e(t("cfg.buscarCPK"))}"
             value="${e(CONFIG_STATE.search)}" data-act-input="cfgSearch" autocomplete="off" aria-label="${e(t("cfg.buscarCPK"))}"/>
      <select class="ui-select cfgx-sel" id="configKamFilter" data-act-change="cfgKamFilter" aria-label="${e(t("sidebar.kam"))}">
        <option value="all"${CONFIG_STATE.kamFilter === "all" ? " selected" : ""}>${e(t("calc.todosKam"))}</option>
        ${kamOpts}
      </select>
      ${segmented({ ariaLabel: t("cfg6.p.estadoAria"), act: "cfgEstado", value: CONFIG_STATE.estado || "todos",
        options: [{ value: "todos", label: t("cfg6.p.todos") }, { value: "pendientes", label: t("cfg6.p.soloPendientes", { n: pend.length }) }] })}
      <span id="configCount" class="cfgx-count"></span>
    </div>
    <div id="configResults"></div>`;
  body.innerHTML = html;
  renderConfigResults();
}

function _motivosBadges(f) {
  const b = [];
  if (f.pendiente.sinAlta) b.push(badge(t("cfg6.p.sinAlta"), "warn"));
  if (f.pendiente.sinKam) b.push(badge(t("metas.sinKam"), "warn"));
  if (f.pendiente.nombreEsClid) b.push(badge(t("cfg6.p.nombreEsClid"), "warn"));
  return b.join(" ");
}

function _pendientesHTML(pend, puedeEsc) {
  if (!pend.length) return "";
  const MAX = 6;
  const items = pend.slice(0, MAX).map(f => `
    <li class="cfgx-pend__item">
      <div class="cfgx-pend__who">
        <span class="cfgx-pend__name">${e(f.nombre)}</span>
        <span class="cfgx-mono cfgx-muted">${e(f.clid)}</span>
      </div>
      <div class="cfgx-pend__why">${_motivosBadges(f)}</div>
      <div class="cfgx-pend__act">${puedeEsc
        ? btn({ label: f.alta ? t("cfg6.p.completar") : t("cfg6.p.darAlta"), size: "sm", variant: f.alta ? "secondary" : "secondary",
                act: f.alta ? "cfgPanelEditar" : "cfgPanelAlta", data: { clid: f.clid } })
        : ""}</div>
    </li>`).join("");
  const mas = pend.length > MAX
    ? `<button type="button" class="ui-link-btn" data-act="cfgEstado" data-value="pendientes">${e(t("cfg6.p.verTodosPend", { n: pend.length }))}</button>` : "";
  return `<section class="cfgx-pend" aria-label="${e(t("cfg6.p.pendTitulo"))}">
    <div class="cfgx-pend__head">${icon("alert-triangle", { size: 16 })}<strong>${e(t("cfg6.p.pendTitulo"))}</strong>
      <span class="cfgx-muted">${e(t("cfg6.p.pendSub", { n: pend.length }))}</span></div>
    <ul class="cfgx-pend__list">${items}</ul>${mas}
  </section>`;
}

// Repinta SOLO bloque masivo + tabla + panel + paginación: el buscador no se
// re-crea y conserva el foco al tipear (patrón de siempre, "fix Fase 7").
export function renderConfigResults() {
  const box = document.getElementById("configResults");
  if (!box) return;
  const filas = filasMaestro();
  const q = (CONFIG_STATE.search || "").toLowerCase().trim();
  const kf = CONFIG_STATE.kamFilter;
  const soloPend = CONFIG_STATE.estado === "pendientes";
  const vis = filas.filter(f => {
    if (kf !== "all" && _kamDe(f) !== kf) return false;
    if (soloPend && !esPendiente(f)) return false;
    if (q && ![f.clid, f.nombre, f.kam].some(s => (s || "").toLowerCase().includes(q))) return false;
    return true;
  });
  const total = Math.max(1, Math.ceil(vis.length / CONFIG_STATE.PAGE_SIZE));
  if (CONFIG_STATE.page >= total) CONFIG_STATE.page = 0;
  const pagina = vis.slice(CONFIG_STATE.page * CONFIG_STATE.PAGE_SIZE, (CONFIG_STATE.page + 1) * CONFIG_STATE.PAGE_SIZE);
  const cnt = document.getElementById("configCount");
  if (cnt) cnt.textContent = t(vis.length === 1 ? "cfg.resultados1" : "cfg.resultadosN", { n: vis.length });

  const puedeEsc = _puede("partners.escribir");
  const puedeBorrar = _puede("partners.borrar");
  // La selección solo vive para CLIDs con alta (reasignar = UPDATE de partners).
  const sel = CONFIG_STATE.sel;
  for (const c of sel) if (!STATE.CLID_MAP[c]) sel.delete(c);

  let html = "";
  if (puedeEsc && sel.size) html += _bulkHTML(sel.size);

  const altasPag = pagina.filter(f => f.alta);
  const todosSel = altasPag.length > 0 && altasPag.every(f => sel.has(f.clid));
  const rows = pagina.map(f => {
    const clidH = e(f.clid);
    const selCell = puedeEsc
      ? (f.alta ? `<input type="checkbox" class="cfgx-cb" data-act-change="cfgSel" data-clid="${clidH}" ${sel.has(f.clid) ? "checked" : ""} aria-label="${e(t("cfg6.p.selAria", { p: f.nombre }))}"/>` : "")
      : null;
    const fuenteNom = f.nombreFuente === "partners" ? "" : `<div class="cfgx-hint">${e(t(`cfg6.fuente.${f.nombreFuente}`))}</div>`;
    const kamCell = f.kam
      ? `${e(f.kam)}${f.kamFuente !== "partners" ? `<div class="cfgx-hint">${e(t(`cfg6.fuente.${f.kamFuente}`))}</div>` : ""}`
      : `<span class="cfgx-muted">${e(kamLabel(SIN_KAM))}</span>`;
    const lineas = f.tieneSubflotas
      ? `<span class="cfgx-muted" title="${e(t("cfg6.p.segunSubTip"))}">${e(t("cfg6.p.segunSub"))}</span>`
      : [f.isFleet ? badge("Fleet", "neutral", { icon: "car" }) : "", f.isTuktuk ? badge("TukTuk", "neutral", { icon: "tuktuk" }) : ""]
          .filter(Boolean).join(" ") || `<span class="cfgx-muted">${e(t("cfg6.p.soloTaxi"))}</span>`;
    const logoUrl = (STATE.partnerLogos || {})[f.nombre];
    const logo = logoUrl ? `<img src="${e(logoUrl)}" alt="" class="cfgx-logo-mini">` : `<span class="cfgx-muted">—</span>`;
    const fl = (STATE.flotasMap || {})[f.clid];
    const estado = [!f.alta ? badge(t("cfg6.p.sinAlta"), "warn") : "", fl && fl.activo === false ? badge(t("raw.inactiva"), "neutral") : ""]
      .filter(Boolean).join(" ") || `<span class="cfgx-muted">${e(t("cfg6.p.alta"))}</span>`;
    const acc = !f.alta
      ? (puedeEsc ? btn({ label: t("cfg6.p.darAlta"), size: "sm", act: "cfgPanelAlta", data: { clid: f.clid } }) : "")
      : (puedeEsc ? btn({ label: t("cfg.editar"), size: "sm", variant: "ghost", icon: "edit", act: "cfgPanelEditar", data: { clid: f.clid } }) : "") +
        (puedeBorrar ? btn({ label: t("cfg6.p.eliminarTip", { p: f.nombre }), iconOnly: true, icon: "trash", size: "sm", variant: "ghost", act: "kamCrudDelete", data: { clid: f.clid } }) : "");
    const abierto = CONFIG_STATE.panel && CONFIG_STATE.panel.clid === f.clid;
    return `<tr data-clid="${clidH}"${abierto ? ' class="cfgx-row--open"' : ""}>
      ${selCell == null ? "" : `<td class="cfgx-td-cb">${selCell}</td>`}
      <td class="cfgx-mono">${clidH}</td>
      <td><span class="cfgx-strong">${e(f.nombre)}</span>${fuenteNom}</td>
      <td>${kamCell}</td>
      <td>${f.ciudades.length ? e(f.ciudades.map(cityLabel).join(", ")) : `<span class="cfgx-muted">—</span>`}</td>
      <td>${lineas}</td>
      <td>${logo}</td>
      <td>${estado}</td>
      <td class="cfgx-td-acc">${acc || `<span class="cfgx-muted">—</span>`}</td>
    </tr>`;
  }).join("");

  const th = s => `<th scope="col">${e(s)}</th>`;
  const tabla = `
    <div class="ui-table-wrap">
      <table class="ui-table cfgx-table" id="crudTable">
        <thead><tr>
          ${puedeEsc ? `<th scope="col" class="cfgx-td-cb"><input type="checkbox" class="cfgx-cb" data-act-change="cfgSelPagina" ${todosSel ? "checked" : ""} ${altasPag.length ? "" : "disabled"} aria-label="${e(t("cfg6.p.selPagina"))}"/></th>` : ""}
          ${th("CLID")}${th(t("calc.col.partner"))}${th(t("sidebar.kam"))}${th(t("cfg6.col.ciudades"))}
          ${th(t("cfg6.col.lineas"))}${th(t("cfg.col.logo"))}${th(t("raw.col.estado"))}<th scope="col" class="cfgx-td-acc">${e(t("cfg.col.acciones"))}</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="9" class="cfgx-empty-row">${e(t("cfg6.sinCoincidencias"))}</td></tr>`}</tbody>
      </table>
    </div>`;

  const pag = total > 1 ? `
    <div class="cfgx-pager">
      ${btn({ label: t("cfg6.anterior"), size: "sm", icon: "chevron-left", act: "cfgPagePrev", disabled: CONFIG_STATE.page === 0 })}
      <span>${t("raw.pagina", { a: `<strong>${CONFIG_STATE.page + 1}</strong>`, b: `<strong>${total}</strong>` })}</span>
      ${btn({ label: t("cfg6.siguiente"), size: "sm", act: "cfgPageNext", data: { total }, disabled: CONFIG_STATE.page === total - 1 })}
    </div>` : "";

  const panel = CONFIG_STATE.panel ? _panelHTML(CONFIG_STATE.panel, filas) : "";
  html += `<div class="cfgx-split${panel ? " cfgx-split--panel" : ""}"><div class="cfgx-split__main">${tabla}${pag}</div>${panel}</div>`;
  box.innerHTML = html;
}

function _bulkHTML(n) {
  const opts = _kamsLista().map(k => `<option value="${e(k)}">${e(k)}</option>`).join("");
  return `<div class="cfgx-bulk" role="region" aria-label="${e(t("cfg6.p.bulkAria"))}">
    <strong>${e(t("cfg6.p.nSel", { n }))}</strong>
    <label class="cfgx-bulk__lbl" for="cfgBulkKam">${e(t("cfg6.p.reasignarA"))}</label>
    <select class="ui-select ui-select--sm cfgx-sel" id="cfgBulkKam">
      <option value="">${e(t("cfg6.p.elegirKam"))}</option>${opts}
      <option value="__sin__">${e(kamLabel(SIN_KAM))}</option>
    </select>
    ${btn({ label: t("cfg6.p.aplicar"), size: "sm", variant: "primary", act: "cfgBulkReasignar" })}
    ${btn({ label: t("cfg6.p.limpiarSel"), size: "sm", variant: "ghost", act: "cfgSelLimpiar" })}
  </div>`;
}

// ── Panel lateral (editar / dar de alta) ─────────────────────────────────────
// Panel y no fila en línea: el formulario creció (nombre, KAM con aviso de
// duplicado, líneas o "según sub-flotas", logo, ciudad al dar de alta y las
// consecuencias de borrar) y en una fila de tabla no entra sin romper el ancho
// de las columnas. Además el mismo panel sirve para editar y para dar de alta
// con los valores sugeridos, y la tabla no se re-maqueta al abrirlo.
function _kamSelectHTML(id, actual, conSinKam = true) {
  const lista = _kamsLista();
  const enLista = !actual || lista.includes(actual);
  const opts = (conSinKam ? `<option value=""${!actual ? " selected" : ""}>${e(kamLabel(SIN_KAM))}</option>` : "") +
    lista.map(k => `<option value="${e(k)}"${k === actual ? " selected" : ""}>${e(k)}</option>`).join("") +
    `<option value="__new__"${!enLista ? " selected" : ""}>${e(t("cfg6.p.otroKam"))}</option>`;
  return `<select class="ui-select" id="${id}" data-act-change="cfgKamSel">${opts}</select>
    <input class="ui-input cfgx-kam-new" id="${id}_new" placeholder="${e(t("cfg.nuevoKam"))}" value="${enLista ? "" : e(actual)}"
           data-act-input="cfgKamNuevo" data-for="${id}" ${enLista ? "hidden" : ""}/>
    <div class="ui-field__hint cfgx-kam-dup" id="${id}_dup" role="status"></div>`;
}

function _panelHTML(p, filas) {
  const f = p.clid ? filas.find(x => x.clid === p.clid) : null;
  const alta = p.modo === "alta";
  const clid = f ? f.clid : "";
  const nombre = alta ? (f ? f.sugerido.nombre : "") : (f ? f.nombre : "");
  const kam = alta ? (f ? f.sugerido.kam : "") : (f ? f.kam : "");
  const ciudad = alta && f ? f.sugerido.ciudad : "";
  const tieneSub = f && f.tieneSubflotas;
  const titulo = alta ? t("cfg6.p.panelAlta") : t("cfg6.p.panelEditar");

  const lineas = tieneSub
    ? `<div class="cfgx-note">${icon("info", { size: 14 })}<span>${e(t("cfg6.p.segunSubTip"))}</span>
         <button type="button" class="ui-link-btn" data-act="cfgSetSection" data-section="clasificacion">${e(t("cfg6.p.irClasif"))}</button></div>`
    : `<label class="cfgx-check"><input type="checkbox" id="cfgPanFleet" ${f && f.isFleet ? "checked" : ""}/> Fleet</label>
       <label class="cfgx-check"><input type="checkbox" id="cfgPanTuktuk" ${f && f.isTuktuk ? "checked" : ""}/> TukTuk</label>
       <div class="ui-field__hint">${e(t("cfg6.p.lineasHint"))}</div>`;

  const sugerido = alta && f
    ? alertBox({ tone: "info", text: t("cfg6.p.sugeridoTxt") }) : "";

  let logo = "";
  if (!alta && f) {
    const url = (STATE.partnerLogos || {})[f.nombre];
    const puedeLogo = STATE.isAdmin || !!(STATE.perms && STATE.perms.has && STATE.perms.has("write:config"));
    logo = `<div class="ui-field"><span class="ui-field__label">${e(t("cfg.col.logo"))}</span>
      <div class="cfgx-logo">
        ${url ? `<img src="${e(url)}" alt="" class="cfgx-logo-img">` : `<span class="cfgx-muted">${e(t("cfg6.p.sinLogo"))}</span>`}
        ${puedeLogo ? `<input type="file" accept="image/png,image/jpeg,image/webp" class="cfgx-file" id="logoIn_${e(clid)}" data-act-change="cfgSubirLogo" data-clid="${e(clid)}">
          ${btn({ label: url ? t("cfg.logo.cambiar") : t("cfg.logo.subir"), size: "sm", icon: "image", act: "cfgPedirLogo", data: { clid }, title: t("cfg.logo.subirTip") })}
          ${url ? btn({ label: t("cfg.eliminarBtn"), size: "sm", variant: "ghost", act: "cfgBorrarLogo", data: { clid } }) : ""}` : ""}
      </div></div>`;
  }

  const ciudadSel = alta ? `<div class="ui-field"><label class="ui-field__label" for="cfgPanCity">${e(t("calc.col.ciudad"))}</label>
      <select class="ui-select" id="cfgPanCity"><option value="">${e(t("raw.sinCiudad"))}</option>
        ${CIUDADES.map(c => `<option value="${c}"${c === ciudad ? " selected" : ""}>${e(cityLabel(c))}</option>`).join("")}</select>
      <div class="ui-field__hint">${e(t("cfg6.p.ciudadHint"))}</div></div>` : "";

  const borrar = !alta && f && f.alta && _puede("partners.borrar")
    ? `<div class="cfgx-panel__danger">${btn({ label: t("cfg6.p.eliminarClid"), variant: "danger", size: "sm", icon: "trash", act: "kamCrudDelete", data: { clid } })}</div>` : "";

  return `<aside class="cfgx-panel" id="cfgPanel" aria-labelledby="cfgPanelTitle">
    <div class="cfgx-panel__head">
      <h3 class="cfgx-panel__title" id="cfgPanelTitle">${e(titulo)}</h3>
      ${btn({ label: t("cfg.cancelar"), iconOnly: true, icon: "x", size: "sm", variant: "ghost", act: "cfgPanelCerrar" })}
    </div>
    ${sugerido}
    <div class="ui-field"><label class="ui-field__label" for="cfgPanClid">CLID</label>
      <input class="ui-input cfgx-mono" id="cfgPanClid" value="${e(clid)}" ${f ? "readonly" : ""} autocomplete="off"/></div>
    <div class="ui-field"><label class="ui-field__label" for="cfgPanNombre">${e(t("cfg.nombrePartner"))}</label>
      <input class="ui-input" id="cfgPanNombre" value="${e(nombre)}" autocomplete="off"/></div>
    <div class="ui-field"><label class="ui-field__label" for="cfgPanKam">${e(t("sidebar.kam"))}</label>${_kamSelectHTML("cfgPanKam", kam)}</div>
    ${ciudadSel}
    <div class="ui-field"><span class="ui-field__label">${e(t("cfg6.col.lineas"))}</span>${lineas}</div>
    ${logo}
    <div class="cfgx-panel__actions">
      ${btn({ label: alta ? t("cfg6.p.darAlta") : t("cfg.guardar"), variant: "primary", icon: "save", act: "cfgPanelGuardar" })}
      ${btn({ label: t("cfg.cancelar"), variant: "ghost", act: "cfgPanelCerrar" })}
    </div>
    ${borrar}
  </aside>`;
}

function _leerKam(id) {
  const v = document.getElementById(id)?.value ?? "";
  if (v === "__new__") return { valor: (document.getElementById(id + "_new")?.value || "").trim(), nuevo: true };
  return { valor: v.trim(), nuevo: false };
}

// Aviso EN VIVO mientras se tipea un KAM nuevo que ya existe con otras
// mayúsculas/tildes; al guardar se vuelve a preguntar (confirmDialog).
function _avisoKamDup(id) {
  const out = document.getElementById(id + "_dup");
  if (!out) return;
  const { valor, nuevo } = _leerKam(id);
  const dup = nuevo ? kamDuplicado(valor, _kamsLista()) : null;
  out.textContent = dup ? t("cfg6.p.kamDupVivo", { k: dup }) : "";
  out.classList.toggle("cfgx-warn-txt", !!dup);
}

async function _resolverKamNuevo(k) {
  if (!k.nuevo || !k.valor) return k.valor;
  const dup = kamDuplicado(k.valor, _kamsLista());
  if (!dup) return k.valor;
  const usar = await confirmDialog({
    title: t("cfg6.p.kamDupTitulo"),
    body: t("cfg6.p.kamDupBody", { n: k.valor, k: dup }),
    confirmLabel: t("cfg6.p.kamDupUsar", { k: dup }),
    cancelLabel: t("cfg6.p.kamDupRevisar")
  });
  return usar ? dup : null;
}

async function cfgPanelGuardar() {
  const p = CONFIG_STATE.panel;
  if (!p) return;
  if (!_puede("partners.escribir")) { showBanner(false, msgSinFilas()); return; }
  const clid = (document.getElementById("cfgPanClid")?.value || "").trim();
  const partner = (document.getElementById("cfgPanNombre")?.value || "").trim();
  if (!clid || !partner) { showBanner(false, t("cfg6.p.faltaClidNombre")); return; }
  const kam = await _resolverKamNuevo(_leerKam("cfgPanKam"));
  if (kam == null) return;
  const alta = p.modo === "alta";

  // Alta manual de un CLID que YA existe: se pisaría nombre y KAM.
  if (alta && STATE.CLID_MAP[clid]) {
    const ok = await confirmDialog({
      title: t("cfg6.p.yaExisteTitulo"),
      body: t("cfg.clidYaExiste", { c: clid, e: `${STATE.CLID_MAP[clid]} (KAM: ${kamLabel(STATE.KAM_MAP[clid] || SIN_KAM)})` }),
      confirmLabel: t("cfg6.p.reemplazar")
    });
    if (!ok) return;
  }
  // Renombrar deja huérfanas las tareas de Seguimiento/proyectos (enlazan por
  // NOMBRE, plan §2.3). No se bloquea: se avisa cuántas hay.
  const viejo = STATE.CLID_MAP[clid];
  if (!alta && viejo && viejo !== partner) {
    const nSeg = (STATE.seguimientoData || []).filter(r => (r.partner || "") === viejo).length;
    const nPro = (STATE.proyectosData || []).filter(r => (r.partner || "") === viejo).length;
    if (nSeg || nPro) {
      const ok = await confirmDialog({
        title: t("cfg6.p.renombrarTitulo"),
        body: t("cfg6.p.renombrarBody", { v: viejo, n: partner, s: nSeg, p: nPro }),
        confirmLabel: t("cfg6.p.renombrarOk")
      });
      if (!ok) return;
    }
  }

  const f = filasMaestro().find(x => x.clid === clid);
  const tieneSub = f && f.tieneSubflotas;
  const fila = { clid, partner, kam, activo: true };
  // Con sub-flotas la clasificación vive en `fleetrooms`: no se tocan los flags
  // por CLID desde acá (se conservan los que ya tenía).
  fila.is_fleet  = tieneSub ? !!(STATE.CLID_IS_FLEET || {})[clid]  : !!document.getElementById("cfgPanFleet")?.checked;
  fila.is_tuktuk = tieneSub ? !!(STATE.CLID_IS_TUKTUK || {})[clid] : !!document.getElementById("cfgPanTuktuk")?.checked;
  if (alta) { const c = document.getElementById("cfgPanCity")?.value; if (c) fila.city = c; }

  showLoad(true, t("cfg.guardando"));
  const { data, error } = await sb.from("partners").upsert([fila], { onConflict: "clid" }).select("clid");
  showLoad(false);
  if (error) { showBanner(false, (alta ? t("cfg.errorAgregar") : t("cfg.errorGuardar")) + error.message); return; }
  if (!data || !data.length) { showBanner(false, msgSinFilas()); return; }
  CONFIG_STATE.panel = null;
  if (viejo && viejo !== partner) ensurePartnerLogos(true);
  await _refrescarYAvisar(alta ? t("cfg.clidAgregado") : t("cfg.guardadoOk"),
    alta ? t("cfg.hecho.clidAgregado") : t("cfg.hecho.partnerGuardado"));
}

export async function kamCrudDelete(clid) {
  const partner = STATE.CLID_MAP[clid] || clid;
  if (!_puede("partners.borrar")) { showBanner(false, msgSinFilas()); return; }
  const tieneLogo = !!(STATE.partnerLogos || {})[partner];
  const nMetas = (STATE.metasData || []).filter(m => m.clid === clid).length;
  const fl = (STATE.flotasMap || {})[clid];
  const cons = [
    t("cfg6.del.partners"),
    tieneLogo ? t("cfg6.del.logo") : t("cfg6.del.logoNo"),
    t("cfg6.del.metas", { n: nMetas }),
    fl && fl.kam ? t("cfg6.del.fallbackFlotas", { k: fl.kam }) : t("cfg6.del.fallback")
  ].map(s => "• " + s).join("\n");
  const ok = await confirmDialog({
    title: t("cfg6.del.titulo", { p: partner }),
    body: t("cfg6.del.intro", { c: clid }) + "\n\n" + cons + "\n\n" + t("cfg6.del.irreversible"),
    confirmLabel: t("cfg6.del.ok"), danger: true
  });
  if (!ok) return;
  showLoad(true, t("cfg.eliminando"));
  // I3: el DELETE bloqueado por RLS no da error — devuelve 0 filas.
  const { data, error } = await sb.from("partners").delete().eq("clid", clid).select("clid");
  showLoad(false);
  if (error) { showBanner(false, t("cfg.errorEliminar") + error.message); return; }
  if (!data || !data.length) { showBanner(false, msgSinFilas()); return; }
  if (CONFIG_STATE.panel && CONFIG_STATE.panel.clid === clid) CONFIG_STATE.panel = null;
  CONFIG_STATE.sel.delete(clid);
  await _refrescarYAvisar(t("cfg.eliminadoOk", { p: partner }), t("cfg.hecho.partnerEliminado", { p: partner }));
}

async function cfgBulkReasignar() {
  const raw = document.getElementById("cfgBulkKam")?.value || "";
  if (!raw) { showBanner(false, t("cfg6.p.elegirKamPrimero")); return; }
  const kam = raw === "__sin__" ? "" : raw;
  const clids = [...CONFIG_STATE.sel].filter(c => STATE.CLID_MAP[c]);
  if (!clids.length) return;
  if (!_puede("partners.escribir")) { showBanner(false, msgSinFilas()); return; }
  const nombres = clids.slice(0, 8).map(c => "• " + STATE.CLID_MAP[c]).join("\n") + (clids.length > 8 ? `\n… (+${clids.length - 8})` : "");
  const ok = await confirmDialog({
    title: t("cfg6.p.bulkTitulo", { n: clids.length, k: kamLabel(kam || SIN_KAM) }),
    body: nombres + "\n\n" + t("cfg6.p.bulkBody"),
    confirmLabel: t("cfg6.p.bulkOk", { n: clids.length })
  });
  if (!ok) return;
  showLoad(true, t("cfg.guardando"));
  const { data, error } = await sb.from("partners").update({ kam }).in("clid", clids).select("clid");
  showLoad(false);
  if (error) { showBanner(false, t("cfg.errorGuardar") + error.message); return; }
  const n = (data || []).length;
  if (!n) { showBanner(false, msgSinFilas()); return; }
  CONFIG_STATE.sel.clear();
  const msg = n === clids.length ? t("cfg6.p.bulkHecho", { n, k: kamLabel(kam || SIN_KAM) })
    : t("cfg6.p.bulkParcial", { n, t: clids.length });
  await _refrescarYAvisar(msg, t("cfg6.p.bulkHechoCorto", { n }), n === clids.length);
}

// I4: el verde solo si la pantalla quedó refrescada. refrescarTrasEscritura
// además invalida mensual/diario/conversión (B8).
async function _refrescarYAvisar(msgOk, queSeHizo, okCompleto = true) {
  const ok = await refrescarTrasEscritura();
  if (STATE.curTab === "config") renderConfig();
  showBanner(ok && okCompleto, ok ? msgOk : t("comun.hechoSinRefresco", { q: queSeHizo }));
}

export function cfgPedirLogo(clid) { document.getElementById(`logoIn_${clid}`)?.click(); }
export async function cfgSubirLogo(clid, input) {
  const file = input?.files?.[0];
  if (!file) return;
  input.value = "";   // permite volver a elegir el MISMO archivo tras un error
  try { await guardarLogoPartner(clid, file); renderConfigResults(); }
  catch (err) { await alertDialog({ title: t("cfg.logo.error"), body: String(err?.message || err), tone: "bad" }); }
}
export async function cfgBorrarLogo(clid) {
  try { await borrarLogoPartner(clid); renderConfigResults(); }
  catch (err) { await alertDialog({ title: t("cfg.logo.error"), body: String(err?.message || err), tone: "bad" }); }
}

// ═════════════════════════════════════════════════════════════════════════════
// CLASIFICACIÓN (movida desde Data Raw → Vista Flotas / Conciliación)
// ═════════════════════════════════════════════════════════════════════════════
export const CLASIF_STATE = {
  vista: "subflotas", search: "", city: "all", dateFrom: "", dateTo: "",
  expanded: {}, editingClid: null, soloConSub: false
};

function _renderClasificacion(body) {
  const seg = segmented({ ariaLabel: t("cfg6.cl.vistaAria"), act: "clasifVista", value: CLASIF_STATE.vista,
    options: [{ value: "subflotas", label: t("cfg6.cl.subflotas"), icon: "list-check" },
              { value: "recon", label: t("cfg6.cl.recon"), icon: "table" }] });
  body.innerHTML = _head(t("cfg6.sec.clasificacion"), t("cfg6.cl.sub"), seg) +
    `<div id="clasifBox">${CLASIF_STATE.vista === "recon" ? _reconHTML() : _subflotasHTML()}</div>`;
}
function _repintarClasif() {
  const box = document.getElementById("clasifBox");
  if (!box) { renderConfig(); return; }
  box.innerHTML = CLASIF_STATE.vista === "recon" ? _reconHTML() : _subflotasHTML();
}

function _subflotasPorClid() {
  const m = new Map();
  for (const src of [STATE.rawDataFull, STATE.rawDataMensualFull, STATE.rawDataDiarioFull]) {
    for (const r of (src || [])) {
      if (!r.clid || !r.db_id) continue;
      let s = m.get(r.clid);
      if (!s) { s = new Map(); m.set(r.clid, s); }
      if (!s.has(r.db_id)) s.set(r.db_id, (STATE.FLEETROOM_NAME || {})[r.db_id] || r.fleetroom || "");
      else if (!s.get(r.db_id) && r.fleetroom) s.set(r.db_id, r.fleetroom);
    }
  }
  return m;
}

function _tuktukSugerido(nombre) {
  const pats = (STATE.tuktukPatterns || []).map(w => w.toLowerCase());
  const n = (nombre || "").toLowerCase();
  return pats.some(w => n.includes(w));
}

const _MAPAS = () => ({
  FLEETROOM_IS_FLEET: STATE.FLEETROOM_IS_FLEET, FLEETROOM_IS_TUKTUK: STATE.FLEETROOM_IS_TUKTUK,
  FLEETROOM_EXCLUDE_TAXI: STATE.FLEETROOM_EXCLUDE_TAXI, FLEETROOM_IS_DELIVERY: STATE.FLEETROOM_IS_DELIVERY,
  FLEETROOM_IS_CARGO: STATE.FLEETROOM_IS_CARGO, CLID_IS_FLEET: STATE.CLID_IS_FLEET, CLID_IS_TUKTUK: STATE.CLID_IS_TUKTUK
});

function _subflotasHTML() {
  const filas = filasMaestro();
  const subs = _subflotasPorClid();
  const q = (CLASIF_STATE.search || "").toLowerCase().trim();
  const cf = CLASIF_STATE.city;
  const allCities = [...new Set([...filas.flatMap(f => f.ciudades), ...Object.values(STATE.flotasMap || {}).map(f => f.ciudad)].filter(Boolean))].sort();
  const vis = filas.filter(f => {
    const fl = (STATE.flotasMap || {})[f.clid];
    const ciudad = (fl && fl.ciudad) || f.ciudades[0] || "";
    if (cf !== "all" && ciudad !== cf && !f.ciudades.includes(cf)) return false;
    if (CLASIF_STATE.soloConSub && !subs.has(f.clid)) return false;
    if (q) {
      const nombresSub = [...(subs.get(f.clid)?.values() || [])];
      if (![f.clid, f.nombre, f.kam, ciudad, fl?.nombre_asignado, ...nombresSub].some(s => (s || "").toLowerCase().includes(q))) return false;
    }
    return true;
  });
  const nSub = [...subs.values()].reduce((s, m) => s + m.size, 0);
  const M = _MAPAS();
  let nExpl = 0;
  for (const [clid, m] of subs) for (const id of m.keys()) if (clasifSubflota(id, clid, M).explicito) nExpl++;

  const puedeFr = _puede("fleetrooms.escribir");
  const puedeP = _puede("partners.escribir");
  const puedeFl = _puede("flotas.escribir");

  const cityOpts = allCities.map(c => `<option value="${e(c)}"${cf === c ? " selected" : ""}>${e(cityLabel(c))}</option>`).join("");
  let html = `
    ${alertBox({ tone: "info", text: t("cfg6.cl.explica") })}
    <div class="cfgx-stats">
      <span>${e(t("cfg6.cl.statClids", { n: fmt(filas.length) }))}</span>
      <span>${e(t("cfg6.cl.statSub", { n: fmt(nSub), x: fmt(nExpl), h: fmt(nSub - nExpl) }))}</span>
    </div>
    <div class="cfgx-toolbar">
      <input class="ui-input cfgx-search" type="search" id="clasifSearch" placeholder="${e(t("raw.buscarCPKC"))}"
             value="${e(CLASIF_STATE.search)}" data-act-input="clasifSearch" autocomplete="off" aria-label="${e(t("raw.buscarCPKC"))}"/>
      <select class="ui-select cfgx-sel" data-act-change="clasifCity" aria-label="${e(t("calc.col.ciudad"))}">
        <option value="all"${cf === "all" ? " selected" : ""}>${e(t("raw.todasCiudades"))}</option>${cityOpts}
      </select>
      <label class="cfgx-check"><input type="checkbox" data-act-change="clasifSoloSub" ${CLASIF_STATE.soloConSub ? "checked" : ""}/> ${e(t("cfg6.cl.soloConSub"))}</label>
      <span class="cfgx-toolbar__end">${btn({ label: t("cfg6.exportarCsv"), icon: "download", size: "sm", act: "exportFlotasCSV" })}</span>
    </div>`;

  // Patrones TukTuk: solo sugerencia visual, nunca clasifica solo.
  const pats = (STATE.tuktukPatterns || []).map(w => `
    <span class="ui-chip">${e(w)}<button type="button" class="ui-chip__remove" data-act="removeTuktukPattern" data-word="${e(w)}"
      aria-label="${e(t("raw.quitar"))} ${e(w)}" title="${e(t("raw.quitar"))}">${icon("x", { size: 12 })}</button></span>`).join("");
  html += `<details class="cfgx-details">
    <summary>${e(t("cfg6.cl.patrones", { n: (STATE.tuktukPatterns || []).length }))}</summary>
    <div class="cfgx-details__body">
      <p class="cfgx-hint">${e(t("cfg6.cl.patronesHint"))}</p>
      <div class="ui-chips">${pats}
        <input id="newTuktukPattern" class="ui-input ui-input--sm cfgx-pat-in" placeholder="${e(t("raw.ejMototaxi"))}" data-act-keydown="addTuktukPatternEnter" aria-label="${e(t("cfg6.cl.nuevoPatron"))}"/>
        ${btn({ label: t("cfg6.cl.agregarPatron"), size: "sm", icon: "plus", act: "addTuktukPattern" })}
      </div>
    </div></details>`;

  const cb = (checked, attrs, dis, heredado, lbl) =>
    `<input type="checkbox" class="cfgx-cb${heredado ? " cfgx-cb--her" : ""}" ${attrs} ${checked ? "checked" : ""} ${dis ? "disabled" : ""}
      aria-label="${e(lbl)}" title="${e(heredado ? t("cfg6.cl.heredadoTip") : lbl)}"/>`;
  const taxiCell = v => v ? `<span class="cfgx-yes" title="${e(t("cfg6.cl.cuentaTaxiTip"))}">${icon("check", { size: 14 })}<span class="ui-sr-only">${e(t("cfg6.si"))}</span></span>`
                          : `<span class="cfgx-muted" title="${e(t("cfg6.cl.noCuentaTaxiTip"))}">—</span>`;
  const kamOpts = (actual) => `<option value="">${e(t("raw.sinKamOpt"))}</option>` +
    _kamsLista().map(k => `<option value="${e(k)}"${actual === k ? " selected" : ""}>${e(k)}</option>`).join("");

  const rowsHtml = vis.slice(0, 500).map(f => {
    const clidH = e(f.clid);
    const fl = (STATE.flotasMap || {})[f.clid];
    const activo = !fl || fl.activo !== false;
    const ciudad = (fl && fl.ciudad) || f.ciudades[0] || "";
    const sub = subs.get(f.clid);
    const conSub = !!(sub && sub.size);
    const nomSug = _tuktukSugerido(f.nombre) && !f.isTuktuk;

    if (CLASIF_STATE.editingClid === f.clid) {
      const cOpts = CIUDADES.map(c => `<option value="${c}"${ciudad === c ? " selected" : ""}>${e(cityLabel(c))}</option>`).join("");
      return `<tr class="cfgx-row--edit" data-flota-clid="${clidH}">
        <td class="cfgx-mono">${clidH}</td>
        <td colspan="2">
          <div class="cfgx-edit-grid">
            <label class="ui-field"><span class="ui-field__label">${e(t("cfg6.cl.nombreFallback"))}</span>
              <input id="flEdName_${clidH}" class="ui-input ui-input--sm" value="${e(fl ? fl.nombre_asignado : "")}" placeholder="${e(t("raw.opcionalFallback"))}"/></label>
            <label class="ui-field"><span class="ui-field__label">${e(t("cfg6.cl.kamFallback"))}</span>
              <select id="flEdKam_${clidH}" class="ui-select ui-select--sm">${kamOpts(fl ? fl.kam : "")}</select></label>
            <label class="ui-field"><span class="ui-field__label">${e(t("calc.col.ciudad"))}</span>
              <select id="flEdCity_${clidH}" class="ui-select ui-select--sm"><option value="">${e(t("raw.sinCiudad"))}</option>${cOpts}</select></label>
            <label class="cfgx-check"><input id="flEdActivo_${clidH}" type="checkbox" ${activo ? "checked" : ""}/> ${e(t("raw.activa"))}</label>
          </div>
          <div class="ui-field__hint">${e(f.alta ? t("cfg6.cl.fallbackAviso", { n: f.nombre }) : t("cfg6.cl.fallbackUsa"))}</div>
        </td>
        <td colspan="7" class="cfgx-td-acc">
          ${btn({ label: t("cfg.guardar"), size: "sm", variant: "primary", act: "flotaSaveEdit", data: { clid: f.clid } })}
          ${btn({ label: t("cfg.cancelar"), size: "sm", variant: "ghost", act: "flotaCancelEdit" })}
        </td></tr>`;
    }

    // Fila del CLID. Sus marcas Fleet/TukTuk (partners) son el valor que HEREDAN
    // las sub-flotas sin fila propia; con sub-flotas se muestran de solo lectura.
    const disCLID = !puedeP || !f.alta;
    const tipCLID = !f.alta ? t("cfg6.cl.darAltaPrimero") : "";
    const clidFlag = (key, val, lbl) => conSub
      ? `<span class="cfgx-muted" title="${e(t("cfg6.cl.valorClidTip"))}">${e(val ? t("cfg6.si") : t("cfg6.no"))}</span>`
      : `<span title="${e(tipCLID)}">${cb(val, `data-act-change="flotaSetFlag" data-clid="${clidH}" data-key="${key}"`, disCLID, false, `${lbl} — ${f.nombre}`)}</span>`;
    const estado = !activo ? badge(t("raw.inactiva"), "neutral") : !f.alta ? badge(t("cfg6.p.sinAlta"), "warn") : `<span class="cfgx-muted">${e(t("raw.activa"))}</span>`;
    const acc = puedeFl
      ? btn({ label: t("cfg6.cl.editarFlota"), iconOnly: true, icon: "edit", size: "sm", variant: "ghost", act: "flotaStartEdit", data: { clid: f.clid } }) +
        btn({ label: activo ? t("raw.marcarInactiva") : t("raw.reactivar"), iconOnly: true, icon: activo ? "eye" : "refresh", size: "sm", variant: "ghost",
              act: "flotaToggleActivo", data: { clid: f.clid, activo: activo ? 0 : 1 } })
      : "";
    let h = `<tr class="cfgx-clid-row">
      <td class="cfgx-mono">${clidH}</td>
      <td><span class="cfgx-strong">${e(f.nombre)}</span>${nomSug ? ` ${badge(t("cfg6.cl.sugiereTk"), "warn")}` : ""}
        <div class="cfgx-hint">${e(f.kam ? f.kam : kamLabel(SIN_KAM))}${f.kamFuente !== "partners" && f.kam ? " · " + e(t(`cfg6.fuente.${f.kamFuente}`)) : ""}${ciudad ? " · " + e(cityLabel(ciudad)) : ""}</div></td>
      <td>${conSub ? `<span class="cfgx-muted">${e(t("raw.fleetroomsCount", { n: sub.size }))}</span>` : `<span class="cfgx-muted">${e(t("cfg6.cl.sinSub"))}</span>`}</td>
      <td class="cfgx-c">${conSub ? "" : taxiCell(!f.isTuktuk)}</td>
      <td class="cfgx-c">${clidFlag("is_fleet", f.isFleet, "Fleet")}</td>
      <td class="cfgx-c">${clidFlag("is_tuktuk", f.isTuktuk, "TukTuk")}</td>
      <td class="cfgx-c"><span class="cfgx-muted" title="${e(t("raw.soloFleetroomTip"))}">—</span></td>
      <td class="cfgx-c"><span class="cfgx-muted" title="${e(t("raw.soloFleetroomTip"))}">—</span></td>
      <td class="cfgx-c"><span class="cfgx-muted" title="${e(t("raw.excluirTaxiTip"))}">—</span></td>
      <td>${estado}</td>
      <td class="cfgx-td-acc">${acc || `<span class="cfgx-muted">—</span>`}</td>
    </tr>`;
    if (conSub) {
      const kamCtx = e(f.kam || ""), cityCtx = e(ciudad || "");
      [...sub.entries()].sort((a, b) => (a[1] || a[0]).localeCompare(b[1] || b[0])).forEach(([dbId, name]) => {
        const c = clasifSubflota(dbId, f.clid, M);
        const her = !c.explicito;
        const attrs = key => `data-act-change="fleetroomSetFlag" data-dbid="${e(dbId)}" data-key="${key}" data-name="${e(name)}" data-clid="${clidH}" data-kam="${kamCtx}" data-city="${cityCtx}"`;
        const sugg = !c.tuktuk && _tuktukSugerido(name);
        const lbl = n => `${n} — ${name || dbId}`;
        h += `<tr class="cfgx-sub-row">
          <td class="cfgx-mono cfgx-muted cfgx-sub-id" title="${e(dbId)}">${e(String(dbId).slice(0, 12))}…</td>
          <td><span class="cfgx-sub-name">${icon("arrow-right", { size: 12 })}${e(name || t("raw.sinNombreParen"))}</span>${sugg ? ` ${badge(t("cfg6.cl.sugiereTk"), "warn")}` : ""}</td>
          <td>${her ? badge(t("cfg6.cl.hereda"), "info") : badge(t("cfg6.cl.explicito"), "neutral")}</td>
          <td class="cfgx-c">${taxiCell(c.cuentaEnTaxi)}</td>
          <td class="cfgx-c">${cb(c.fleet, attrs("is_fleet"), !puedeFr, her, lbl("Fleet"))}</td>
          <td class="cfgx-c">${cb(c.tuktuk, attrs("is_tuktuk"), !puedeFr, her, lbl("TukTuk"))}</td>
          <td class="cfgx-c">${cb(c.delivery, attrs("is_delivery"), !puedeFr, false, lbl(t("raw.col.delivery")))}</td>
          <td class="cfgx-c">${cb(c.cargo, attrs("is_cargo"), !puedeFr, false, lbl(t("raw.col.cargo")))}</td>
          <td class="cfgx-c">${cb(c.excluir, attrs("exclude_from_taxi"), !puedeFr, false, lbl(t("raw.excluirTaxi")))}</td>
          <td colspan="2"></td>
        </tr>`;
      });
    }
    return h;
  }).join("");

  const th = (s, c = "") => `<th scope="col"${c ? ` class="${c}"` : ""}>${s}</th>`;
  html += `
    <div class="ui-table-wrap ui-table-wrap--scroll cfgx-tree-wrap">
      <table class="ui-table cfgx-table cfgx-tree">
        <thead><tr>
          ${th("CLID / db_id")}${th(e(t("cfg6.cl.colNombre")))}${th(e(t("cfg6.cl.colOrigen")))}
          ${th(e(t("cfg6.cl.colTaxi")), "cfgx-c")}${th("Fleet", "cfgx-c")}${th("TukTuk", "cfgx-c")}
          ${th(e(t("raw.col.delivery")), "cfgx-c")}${th(e(t("raw.col.cargo")), "cfgx-c")}${th(e(t("cfg6.cl.colExcluir")), "cfgx-c")}
          ${th(e(t("cfg6.cl.colFlota")))}${th(e(t("raw.col.accion")), "cfgx-td-acc")}
        </tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="11" class="cfgx-empty-row">${e(t("cfg6.sinCoincidencias"))}</td></tr>`}</tbody>
      </table>
    </div>
    ${vis.length > 500 ? `<p class="cfgx-hint">${e(t("raw.mostrandoPrimeros", { n: 500, t: fmt(vis.length) }))}</p>` : ""}
    ${!Object.keys(STATE.flotasMap || {}).length ? alertBox({ tone: "info", text: t("cfg6.cl.sinFlotas") }) : ""}`;
  return html;
}

// ── Escrituras de clasificación ─────────────────────────────────────────────
async function _clasifRefrescar(msgOk, queSeHizo) {
  const ok = await refrescarTrasEscritura();
  if (STATE.curTab === "config") renderConfig();
  showBanner(ok, ok ? msgOk : t("comun.hechoSinRefresco", { q: queSeHizo }));
}

async function flotaSetFlagCLID(clid, key, checked) {
  // Solo CLIDs con alta: escribir un flag de un CLID sin fila en `partners`
  // creaba la fila con kam="" y lo dejaba en "Sin KAM" para siempre (§2.3).
  if (!STATE.CLID_MAP[clid]) { showBanner(false, t("cfg6.cl.darAltaPrimero")); renderConfig(); return; }
  showLoad(true, t("raw.guardando"));
  try {
    await setPartnerFlag(clid, key, checked, STATE.CLID_MAP[clid], STATE.KAM_MAP[clid] || "");
    await _clasifRefrescar(t("raw.actualizado"), t("raw.hecho.clasificacion"));
  } catch (err) { showBanner(false, t("raw.error") + err.message); console.error(err); renderConfig(); }
  finally { showLoad(false); }
}

async function fleetroomSetFlag(dbId, key, checked, name, clid, kam, city) {
  showLoad(true, t("raw.guardando"));
  try {
    const c = clasifSubflota(dbId, clid, _MAPAS());
    await setFleetroomFlags(dbId, patchMaterializar(c, key, checked), { clid, name, kam, city });
    await _clasifRefrescar(t("raw.actualizado"), t("raw.hecho.clasificacionSubflota"));
  } catch (err) { showBanner(false, t("raw.error") + err.message); console.error(err); renderConfig(); }
  finally { showLoad(false); }
}

async function flotaSaveEdit(clid) {
  const elActivo = document.getElementById(`flEdActivo_${clid}`);
  if (!elActivo) { showBanner(false, t("raw.errFilaEditada")); return; }
  const payload = {
    ciudad: document.getElementById(`flEdCity_${clid}`)?.value || "",
    nombre_asignado: (document.getElementById(`flEdName_${clid}`)?.value || "").trim(),
    kam: document.getElementById(`flEdKam_${clid}`)?.value || "",
    activo: elActivo.checked
  };
  showLoad(true, t("raw.guardando"));
  try {
    if ((STATE.flotasMap || {})[clid]) await updateFlotaField(clid, payload);
    else await createFlota(clid, payload);
    CLASIF_STATE.editingClid = null;
    await _clasifRefrescar(t("raw.flotaActualizada"), t("raw.hecho.flotaActualizada"));
  } catch (err) { showBanner(false, t("raw.errorGuardar") + err.message); console.error(err); }
  finally { showLoad(false); }
}

async function flotaToggleActivo(clid, nuevo) {
  if (!nuevo) {
    const ok = await confirmDialog({
      title: t("cfg6.cl.inactivarTitulo", { p: STATE.CLID_MAP[clid] || clid }),
      body: t("cfg6.cl.inactivarBody"), confirmLabel: t("raw.marcarInactiva")
    });
    if (!ok) return;
  }
  showLoad(true, nuevo ? t("raw.reactivando") : t("raw.marcandoInactiva"));
  try {
    if ((STATE.flotasMap || {})[clid]) await updateFlotaField(clid, { activo: nuevo });
    else await createFlota(clid, { activo: nuevo, nombre_asignado: STATE.CLID_MAP[clid] || "" });
    await _clasifRefrescar(nuevo ? t("raw.flotaReactivada") : t("raw.flotaInactiva"),
      nuevo ? t("raw.hecho.flotaReactivada") : t("raw.hecho.flotaInactiva"));
  } catch (err) { showBanner(false, t("raw.error") + err.message); console.error(err); }
  finally { showLoad(false); }
}

function addTuktukPattern() {
  const input = document.getElementById("newTuktukPattern");
  const word = (input?.value || "").trim().toLowerCase();
  if (!word) return;
  if ((STATE.tuktukPatterns || []).includes(word)) { showBanner(false, t("raw.yaEnLista", { w: word })); return; }
  STATE.tuktukPatterns.push(word);
  lsSet("yangoTuktukPatterns", JSON.stringify(STATE.tuktukPatterns));
  _repintarClasif();
  showBanner(true, t("raw.agregadoTuktuk", { w: word }));
}
function removeTuktukPattern(word) {
  STATE.tuktukPatterns = (STATE.tuktukPatterns || []).filter(w => w !== word);
  lsSet("yangoTuktukPatterns", JSON.stringify(STATE.tuktukPatterns));
  _repintarClasif();
  showBanner(true, t("raw.eliminadoTuktuk", { w: word }));
}

function exportFlotasCSV() {
  logAccess("download_csv", "flotas");
  const flotasMap = STATE.flotasMap || {};
  const fromRaw = new Map();
  (STATE.rawDataFull || []).forEach(r => {
    if (!r.clid || fromRaw.has(r.clid)) return;
    fromRaw.set(r.clid, { nombre_original: r._partnerOriginal || r.partner, ciudad: r.city,
      kam: r.kam || (typeof window.getKAMForPartner === "function" ? window.getKAMForPartner(r.partner) : "") || "" });
  });
  const clids = new Set([...Object.keys(flotasMap), ...fromRaw.keys()]);
  const lines = [["CLID", "CIUDAD", "NOMBRE_ORIGINAL", "NOMBRE_ASIGNADO", "KAM", "ACTIVO"].join(",")];
  [...clids].forEach(clid => {
    const f = flotasMap[clid], raw = fromRaw.get(clid);
    lines.push(filaCSV([
      clid, (f && f.ciudad) || (raw && raw.ciudad) || "",
      (raw && raw.nombre_original) || (f && f.nombre_original) || "",
      (f && f.nombre_asignado) || "", (f && f.kam) || (raw && raw.kam) || "",
      f ? (f.activo !== false ? "true" : "false") : "true"
    ]));
  });
  _descargar(lines, `flotas_${fechaLimaISO()}.csv`);
}

function _descargar(lines, nombre) {
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombre; a.click();
  URL.revokeObjectURL(url);
}

// ── Conciliación (CLID → db_id), movida desde Data Raw ──────────────────────
// Resumen por CLID desglosable a fleetroom con las columnas del export, para
// cuadrar contra el Excel. Corre sobre el dataset FULL deduplicado
// (dropLegacyAggregateRows) → sin doble conteo legacy + fleetroom. Misma lógica
// que antes; solo cambió la presentación.
function _fmtKM2(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const neg = n < 0, abs = Math.abs(n);
  let out;
  if (abs >= 1e6)      out = (abs / 1e6).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "M";
  else if (abs >= 1e3) out = (abs / 1e3).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "K";
  else                 out = abs.toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return neg ? "-" + out : out;
}
const _num2 = n => (n == null || isNaN(n)) ? "—" : n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const _pct1 = n => (n == null || isNaN(n)) ? "—" : (n * 100).toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
const _nuevoAgg = () => ({ ad: 0, sh: 0, nuevos: 0, react: 0, trips: 0, gmv: 0, comm: 0, ifsh: 0, ofcars: 0, accNum: 0, accDen: 0 });
function _acc(a, r) {
  a.ad += r.activeDrivers || 0; a.sh += r.supplyHours || 0;
  a.nuevos += (r.newPartner || 0) + (r.newService || 0); a.react += r.reactivated || 0;
  a.trips += r.trips || 0; a.gmv += r.gmv || 0; a.comm += r.commission || 0;
  a.ifsh += r.internalFleetSh || 0; a.ofcars += r.ownedFleetActiveCars || 0;
  if (r.acceptanceRate != null && r.trips) { a.accNum += r.acceptanceRate * r.trips; a.accDen += r.trips; }
}
function _acc2(d, a) { for (const k of Object.keys(d)) d[k] += a[k]; }
function _reconClasif(sample) {
  const tuk = rowIsTuktuk(sample), excl = rowExcludedFromTaxi(sample), fleet = rowIsFleet(sample);
  if (tuk)   return { omit: true,  clase: "TukTuk",   html: badge(t("cfg6.rc.tukOmit"), "warn") };
  if (excl)  return { omit: true,  clase: "Excluido", html: badge(t("cfg6.rc.exclOmit"), "bad") };
  if (fleet) return { omit: false, clase: "Fleet",    html: badge("Fleet", "info") };
  return { omit: false, clase: "Taxi", html: badge("Taxi", "neutral") };
}
function _reconSrc() {
  const s0 = STATE.curMode === "mensual" ? STATE.rawDataMensualFull
           : STATE.curMode === "diario"  ? STATE.rawDataDiarioFull : STATE.rawDataFull;
  return dropLegacyAggregateRows(s0 || []);
}
function _reconInRange(r) {
  return (CLASIF_STATE.city === "all" || r.city === CLASIF_STATE.city) &&
    (!CLASIF_STATE.dateFrom || r.date >= CLASIF_STATE.dateFrom) &&
    (!CLASIF_STATE.dateTo || r.date <= CLASIF_STATE.dateTo);
}

function _reconHTML() {
  const src = _reconSrc();
  if (!src.length) return emptyState({ icon: "table", title: t("raw.sinDatosCargados") });
  const allDates = [...new Set(src.map(r => r.date))].sort();
  if (!CLASIF_STATE.dateFrom || !allDates.includes(CLASIF_STATE.dateFrom)) CLASIF_STATE.dateFrom = allDates[0] || "";
  if (!CLASIF_STATE.dateTo || !allDates.includes(CLASIF_STATE.dateTo)) CLASIF_STATE.dateTo = allDates[allDates.length - 1] || "";
  const allCities = [...new Set(src.map(r => r.city).filter(Boolean))].sort();
  const q = (CLASIF_STATE.search || "").toLowerCase().trim();

  const byClid = new Map();
  src.forEach(r => {
    if (!_reconInRange(r)) return;
    const clid = r.clid || "(sin clid)";
    let c = byClid.get(clid);
    if (!c) { c = { clid, partner: "", kam: "", cities: new Set(), agg: _nuevoAgg(), frooms: new Map() }; byClid.set(clid, c); }
    c.partner = STATE.CLID_MAP[clid] || c.partner || r.partner || "";
    c.kam = STATE.KAM_MAP[clid] || c.kam || r.kam || "";
    if (r.city) c.cities.add(r.city);
    _acc(c.agg, r);
    const fk = r.db_id || "";
    let f = c.frooms.get(fk);
    if (!f) { f = { db_id: fk, name: r.fleetroom || "", agg: _nuevoAgg(), sample: r }; c.frooms.set(fk, f); }
    if (!f.name && r.fleetroom) f.name = r.fleetroom;
    _acc(f.agg, r);
  });
  let clids = [...byClid.values()];
  if (q) clids = clids.filter(c => [c.clid, c.partner, c.kam].some(s => (s || "").toLowerCase().includes(q)));
  clids.sort((a, b) => b.agg.ad - a.agg.ad);

  const totFull = _nuevoAgg(), totTaxi = _nuevoAgg();
  let omitCount = 0;
  clids.forEach(c => {
    _acc2(totFull, c.agg);
    c.frooms.forEach(f => { if (_reconClasif(f.sample).omit) omitCount++; else _acc2(totTaxi, f.agg); });
  });

  const dOpts = sel => allDates.map(d => `<option value="${e(d)}"${d === sel ? " selected" : ""}>${e(d2s(d))}</option>`).join("");
  const cityOpts = allCities.map(c => `<option value="${e(c)}"${CLASIF_STATE.city === c ? " selected" : ""}>${e(cityLabel(c))}</option>`).join("");
  let html = `
    <p class="cfgx-hint">${t("raw.reconResumen")}</p>
    ${CLASIF_STATE.dateFrom === CLASIF_STATE.dateTo ? "" : alertBox({ tone: "warn", text: t("cfg6.rc.aviso") })}
    <div class="cfgx-stats"><span>${e(t("cfg6.rc.stats", { n: fmt(clids.length), o: fmt(omitCount) }))}</span></div>
    <div class="cfgx-toolbar">
      <input class="ui-input cfgx-search" type="search" id="clasifSearchRecon" placeholder="${e(t("raw.buscarCPK"))}"
             value="${e(CLASIF_STATE.search)}" data-act-input="clasifSearch" autocomplete="off" aria-label="${e(t("raw.buscarCPK"))}"/>
      <select class="ui-select cfgx-sel" data-act-change="clasifCity" aria-label="${e(t("calc.col.ciudad"))}">
        <option value="all"${CLASIF_STATE.city === "all" ? " selected" : ""}>${e(t("raw.todasCiudades"))}</option>${cityOpts}</select>
      <select class="ui-select cfgx-sel cfgx-sel--date" data-act-change="clasifDesde" aria-label="${e(t("cfg6.desde"))}">${dOpts(CLASIF_STATE.dateFrom)}</select>
      <span class="cfgx-muted" aria-hidden="true">→</span>
      <select class="ui-select cfgx-sel cfgx-sel--date" data-act-change="clasifHasta" aria-label="${e(t("cfg6.hasta"))}">${dOpts(CLASIF_STATE.dateTo)}</select>
      <span class="cfgx-toolbar__end">
        ${btn({ label: t("raw.expandirTodo"), size: "sm", variant: "ghost", act: "reconExpandAll", data: { open: 1 } })}
        ${btn({ label: t("raw.colapsar"), size: "sm", variant: "ghost", act: "reconExpandAll", data: { open: 0 } })}
        ${btn({ label: t("cfg6.exportarCsv"), size: "sm", icon: "download", act: "exportReconCSV" })}
      </span>
    </div>`;

  const nums = a => `
    <td class="ui-num" title="${fmt5(a.ad)}">${_fmtKM2(a.ad)}</td>
    <td class="ui-num" title="${fmt5(a.sh)}">${_fmtKM2(a.sh)}</td>
    <td class="ui-num" title="${fmt5(a.nuevos)}">${_fmtKM2(a.nuevos)}</td>
    <td class="ui-num" title="${fmt5(a.react)}">${_fmtKM2(a.react)}</td>
    <td class="ui-num cfgx-strong" title="${fmt5(a.nuevos + a.react)}">${_fmtKM2(a.nuevos + a.react)}</td>
    <td class="ui-num" title="${fmt5(a.trips)}">${_fmtKM2(a.trips)}</td>
    <td class="ui-num" title="${fmt5(a.gmv)}">${_fmtKM2(a.gmv)}</td>
    <td class="ui-num" title="${fmt5(a.comm)}">${_fmtKM2(a.comm)}</td>
    <td class="ui-num" title="Σ int.fleet.sh / Σ autos">${a.ofcars > 0 ? _num2(a.ifsh / a.ofcars) : "—"}</td>
    <td class="ui-num">${a.accDen > 0 ? _pct1(a.accNum / a.accDen) : "—"}</td>
    <td class="ui-num" title="${fmt5(a.ofcars)}">${_fmtKM2(a.ofcars)}</td>`;
  const th = (s, c = "ui-num") => `<th scope="col" class="${c}">${s}</th>`;
  const brSafe = s => e(String(s).replace(/<br\s*\/?>/g, " "));

  let body = "";
  clids.slice(0, 400).forEach(c => {
    const open = !!CLASIF_STATE.expanded[c.clid];
    const fr = [...c.frooms.values()];
    let omitAd = 0, omitN = 0;
    fr.forEach(f => { if (_reconClasif(f.sample).omit) { omitAd += f.agg.ad; omitN++; } });
    const expandible = fr.length > 1 || (fr[0] && fr[0].db_id);
    const cityStr = [...c.cities].map(cityLabel).join(", ");
    body += `<tr class="cfgx-clid-row">
      <td>${expandible ? `<button type="button" class="cfgx-expand" data-act="reconToggleClid" data-clid="${e(c.clid)}" aria-expanded="${open}"
            aria-label="${e(t(open ? "raw.colapsar" : "raw.expandirTodo"))} ${e(c.partner || c.clid)}">${icon(open ? "chevron-down" : "chevron-right", { size: 14 })}</button>` : ""}</td>
      <td><span class="cfgx-mono cfgx-muted">${e(c.clid)}</span> <span class="cfgx-strong">${e(c.partner || t("raw.sinNombreParen"))}</span>
        <div class="cfgx-hint">${e(c.kam || t("raw.sinKamParen"))}${cityStr ? " · " + e(cityStr) : ""} · ${e(t("raw.fleetroomsCount", { n: fr.length }))}</div></td>
      ${nums(c.agg)}
      <td>${omitN ? `<span title="${e(t("raw.omiteTip", { n: omitN, ad: fmt5(omitAd) }))}">${badge(t("raw.omite", { n: omitN, ad: _fmtKM2(omitAd) }), "warn")}</span>` : `<span class="cfgx-muted">—</span>`}</td>
    </tr>`;
    if (open) fr.sort((a, b) => b.agg.ad - a.agg.ad).forEach(f => {
      const cl = _reconClasif(f.sample);
      body += `<tr class="cfgx-sub-row${cl.omit ? " cfgx-sub-row--omit" : ""}">
        <td></td>
        <td><span class="cfgx-sub-name">${icon("arrow-right", { size: 12 })}${e(f.name || t("raw.sinNombre"))}</span>
          <span class="cfgx-mono cfgx-muted" title="${e(f.db_id)}">${f.db_id ? e(f.db_id.slice(0, 12)) + "…" : e(t("raw.legacySinDbId"))}</span></td>
        ${nums(f.agg)}
        <td>${cl.html}</td>
      </tr>`;
    });
  });
  body += `<tr class="cfgx-total"><td></td><td>${e(t("cfg6.rc.totalTodo"))}</td>${nums(totFull)}<td></td></tr>
           <tr class="cfgx-total cfgx-total--taxi"><td></td><td title="${e(t("raw.totalTaxiTip"))}">${e(t("raw.totalTaxi"))}</td>${nums(totTaxi)}<td></td></tr>`;

  html += `<div class="ui-table-wrap ui-table-wrap--scroll cfgx-tree-wrap"><table class="ui-table cfgx-table cfgx-recon">
    <thead><tr><th scope="col" class="cfgx-td-exp"><span class="ui-sr-only">${e(t("raw.expandirTodo"))}</span></th>
      ${th(e(t("raw.col.clidFlota")), "")}${th("AD")}${th(e(t("metric.sh.short")))}${th(e(t("raw.col.nuevos")))}${th(e(t("raw.col.react")))}
      ${th("N+R")}${th(e(t("raw.col.viajes")))}${th("GMV")}${th(e(t("raw.col.comision")))}${th(brSafe(t("raw.col.shAutoFleet")))}
      ${th(e(t("raw.col.acept")))}${th(brSafe(t("raw.col.autosFleet")))}${th(e(t("raw.col.estado")), "")}
    </tr></thead><tbody>${body}</tbody></table></div>
    ${clids.length > 400 ? `<p class="cfgx-hint">${e(t("raw.primeros400", { n: fmt(clids.length) }))}</p>` : ""}`;
  return html;
}

function reconExpandAll(open) {
  CLASIF_STATE.expanded = {};
  if (open) _reconSrc().forEach(r => { if (r.clid) CLASIF_STATE.expanded[r.clid] = true; });
  _repintarClasif();
}

function exportReconCSV() {
  logAccess("download_csv", "conciliacion");
  const byKey = new Map();
  _reconSrc().forEach(r => {
    if (!_reconInRange(r)) return;
    const clid = r.clid || "(sin clid)", fk = r.db_id || "";
    const k = clid + "|" + fk;
    let g = byKey.get(k);
    if (!g) { g = { clid, db_id: fk, name: r.fleetroom || "", partner: STATE.CLID_MAP[clid] || r.partner || "", kam: STATE.KAM_MAP[clid] || r.kam || "", agg: _nuevoAgg(), sample: r }; byKey.set(k, g); }
    if (!g.name && r.fleetroom) g.name = r.fleetroom;
    _acc(g.agg, r);
  });
  const lines = [["CLID", "db_id", "Flota", "Partner", "KAM", "Clasificacion", "Omitido", "AD", "SupplyHours", "Nuevos", "Reactivados", "N+R", "Viajes", "GMV", "Comision", "FleetSHxAuto", "AcceptanceRate", "FleetActiveCars"].join(",")];
  [...byKey.values()].sort((a, b) => (a.partner || a.clid).localeCompare(b.partner || b.clid) || b.agg.ad - a.agg.ad).forEach(g => {
    const a = g.agg, cl = _reconClasif(g.sample);
    lines.push(filaCSV([g.clid, g.db_id, g.name, g.partner, g.kam, cl.clase, cl.omit ? "SI" : "",
      a.ad, a.sh, a.nuevos, a.react, a.nuevos + a.react, a.trips, a.gmv, a.comm,
      a.ofcars > 0 ? a.ifsh / a.ofcars : "", a.accDen > 0 ? a.accNum / a.accDen : "", a.ofcars]));
  });
  _descargar(lines, `conciliacion_${CLASIF_STATE.dateFrom}_${CLASIF_STATE.dateTo}.csv`);
}

// ═════════════════════════════════════════════════════════════════════════════
// CARGAS
// ═════════════════════════════════════════════════════════════════════════════
export const CARGAS_DEF = [
  { tipo: "rendimiento",        input: "fileRend",        icon: "activity",   esc: "semanal" },
  { tipo: "rendimientoMensual", input: "fileRendMensual", icon: "calendar",   esc: "mensual" },
  { tipo: "rendimientoDiario",  input: "fileRendDiario",  icon: "clock",      esc: "diario" },
  { tipo: "metas",              input: "fileMetas",       icon: "target" },
  { tipo: "data",               input: "fileData",        icon: "users" },
  { tipo: "flotas",             input: "fileFlotas",      icon: "car" },
  { tipo: "conversion",         input: "fileConversion",  icon: "trending-up" }
];

// Último período cargado por escala: se pregunta a la base (RPC de períodos,
// solo lectura) al abrir la sección, no se deduce de la ventana cargada — la
// ventana puede no incluir lo último de una escala que todavía no se abrió.
const _ULT = { at: 0, cargando: false, semanal: null, mensual: null, diario: null, conversion: null, error: false };
export function invalidarUltimosCargados() { _ULT.at = 0; }

async function _cargarUltimos() {
  if (_ULT.cargando || (_ULT.at && Date.now() - _ULT.at < 60000)) return;
  _ULT.cargando = true;
  try {
    const [s, m, d, c] = await Promise.all([
      fetchAllPeriods("semanal"), fetchAllPeriods("mensual"), fetchAllPeriods("diario"),
      sb.from("conversion_pais").select("mes").order("mes", { ascending: false }).limit(1)
    ]);
    _ULT.semanal = s.length ? s[s.length - 1] : null;
    _ULT.mensual = m.length ? m[m.length - 1] : null;
    _ULT.diario = d.length ? d[d.length - 1] : null;
    _ULT.conversion = c && !c.error && c.data && c.data[0] ? c.data[0].mes : null;
    _ULT.error = !s.length && !m.length && !d.length;
    _ULT.at = Date.now();
  } catch (err) { _ULT.error = true; _ULT.at = Date.now(); console.error("cargas:", err); }
  finally {
    _ULT.cargando = false;
    if (STATE.curTab === "config" && CONFIG_STATE.section === "cargas") renderConfig();
  }
}

function _ultimaMeta() {
  let best = null;
  for (const m of (STATE.metasData || [])) {
    const i = mesIndice(m.mes);
    if (i < 0) continue;
    const k = (m.mYear || 0) * 12 + i;
    if (!best || k > best.k) best = { k, mes: m.mes, y: m.mYear };
  }
  return best ? `${mesLabel(best.mes)}${best.y ? " " + best.y : ""}` : null;
}

function _ultimoTxt(def) {
  if (def.esc) {
    if (_ULT.cargando && !_ULT.at) return t("cfg6.cg.consultando");
    const v = _ULT[def.esc];
    return v ? (def.esc === "mensual" ? v : d2s(v)) : null;
  }
  if (def.tipo === "metas") return _ultimaMeta();
  if (def.tipo === "conversion") return _ULT.conversion;
  if (def.tipo === "data") return t("cfg6.cg.nRegistros", { n: fmt(Object.keys(STATE.CLID_MAP || {}).length) });
  if (def.tipo === "flotas") return t("cfg6.cg.nRegistros", { n: fmt(Object.keys(STATE.flotasMap || {}).length) });
  return null;
}

function _resultadoHTML(tipo) {
  const r = CARGAS_SESION[tipo];
  if (!r) return `<div class="cfgx-card__res cfgx-muted">${e(t("cfg6.cg.sinSubidas"))}</div>`;
  const hora = new Date(r.inicio).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
  if (r.estado === "en curso") return `<div class="cfgx-card__res">${badge(t("cfg6.cg.subiendo"), "info", { icon: "refresh" })} <span class="cfgx-muted">${e(r.archivo)}</span></div>`;
  const tone = r.estado === "ok" ? "ok" : "bad";
  const avisos = r.mensajes.filter(m => !m.ok);
  const detalle = r.estado === "ok"
    ? (avisos.length ? `<ul class="cfgx-card__msgs">${avisos.map(m => `<li>${e(m.msg)}</li>`).join("")}</ul>` : "")
    : `<div class="cfgx-card__err">${e((avisos[avisos.length - 1] || {}).msg || "")}</div>`;
  return `<div class="cfgx-card__res">
    ${badge(r.estado === "ok" ? (avisos.length ? t("cfg6.cg.okAvisos", { n: avisos.length }) : t("cfg6.cg.ok")) : t("cfg6.cg.error"), avisos.length && r.estado === "ok" ? "warn" : tone)}
    <span class="cfgx-muted">${e(t("cfg6.cg.resultadoDe", { a: r.archivo, h: hora }))}</span>
    ${detalle}
  </div>`;
}

function _renderCargas(body) {
  _cargarUltimos();
  const cards = CARGAS_DEF.map(d => {
    const ult = _ultimoTxt(d);
    return `<article class="cfgx-card">
      <div class="cfgx-card__head">${icon(d.icon, { size: 18 })}<h3 class="cfgx-card__title">${e(t(`subida.tipo.${d.tipo}`))}</h3></div>
      <p class="cfgx-card__desc">${e(t(`cfg6.cg.desc.${d.tipo}`))}</p>
      <div class="cfgx-card__cols"><span class="cfgx-card__k">${e(t("cfg6.cg.columnas"))}</span><code>${e(t(`cfg6.cg.cols.${d.tipo}`))}</code></div>
      <div class="cfgx-card__ult"><span class="cfgx-card__k">${e(t(d.esc || d.tipo === "metas" || d.tipo === "conversion" ? "cfg6.cg.ultimo" : "cfg6.cg.enBase"))}</span>
        <span>${ult ? e(ult) : `<span class="cfgx-muted">${e(_ULT.error && d.esc ? t("cfg6.cg.noSePudo") : "—")}</span>`}</span></div>
      ${_resultadoHTML(d.tipo)}
      <div class="cfgx-card__foot">${btn({ label: t("cfg6.cg.subir"), icon: "upload", size: "sm", act: "cfgElegirArchivo", data: { input: d.input },
        disabled: CARGAS_SESION[d.tipo] && CARGAS_SESION[d.tipo].estado === "en curso" })}</div>
    </article>`;
  }).join("");
  body.innerHTML = _head(t("cfg6.sec.cargas"), t("cfg6.cg.sub")) +
    alertBox({ tone: "info", text: t("cfg6.cg.nota") }) +
    `<div class="cfgx-cards">${cards}</div>`;
}

// ═════════════════════════════════════════════════════════════════════════════
// PREFERENCIAS y MANTENIMIENTO
// ═════════════════════════════════════════════════════════════════════════════
function _preferenciasHTML() {
  const metricLabel = { activeDrivers: t("metric.ad.label"), supplyHours: t("metric.sh.label"), nr: t("metric.nr.label") };
  const opt = (v, l) => `<option value="${v}"${STATE.declineMetric === v ? " selected" : ""}>${e(l)}</option>`;
  return _head(t("cfg6.sec.preferencias"), t("cfg6.pref.sub")) + `
    <section class="ui-card cfgx-block">
      <div class="ui-card__head"><div><div class="ui-card__title">${e(t("cfg6.pref.declive"))}</div>
        <div class="ui-card__sub">${e(t("cfg6.pref.decliveSub"))}</div></div></div>
      <div class="cfgx-form-row">
        <label class="ui-field"><span class="ui-field__label">${e(t("cfg.metrica"))}</span>
          <select class="ui-select" id="declineMetricSel" data-act-change="updateDeclineSettings">
            ${opt("activeDrivers", t("metric.ad.label"))}${opt("supplyHours", t("metric.sh.label"))}${opt("nr", t("metric.nr.label"))}
          </select></label>
        <label class="ui-field"><span class="ui-field__label">${e(t("cfg.semanasConsec"))}</span>
          <select class="ui-select" id="declineThresholdSel" data-act-change="updateDeclineSettings">
            ${[2, 3, 4, 5].map(n => `<option value="${n}"${STATE.declineThreshold === n ? " selected" : ""}>${e(t("cfg.nSemanas", { n }))}</option>`).join("")}
          </select></label>
      </div>
      <p class="cfgx-hint">${t("cfg.declineAviso", { b: '<span class="decline-badge">⚠</span>', n: STATE.declineThreshold, m: e(metricLabel[STATE.declineMetric]) })}</p>
    </section>`;
}

const _TABLAS_BORRADO = () => ({
  rendimiento: t("mode.semanal"), rendimiento_mensual: t("mode.mensual"),
  rendimiento_diario: t("mode.diario"), metas: t("metas.titulo")
});

function _mantenimientoHTML() {
  const L = _TABLAS_BORRADO();
  return _head(t("cfg6.sec.mantenimiento"), t("cfg6.mant.sub")) + `
    <section class="ui-card cfgx-block cfgx-block--danger">
      <div class="ui-card__head"><div><div class="ui-card__title">${e(t("cfg6.mant.borrarTitulo"))}</div>
        <div class="ui-card__sub">${e(t("cfg6.mant.borrarSub"))}</div></div></div>
      <div class="cfgx-form-row">
        <label class="ui-field"><span class="ui-field__label">${e(t("cfg.tabla"))}</span>
          <select class="ui-select" id="delTableSel">
            ${Object.entries(L).map(([k, v]) => `<option value="${k}">${e(v)} (${k})</option>`).join("")}
          </select></label>
        <label class="ui-field"><span class="ui-field__label">${e(t("cfg.mesOpcional"))}</span>
          <input class="ui-input" id="delMonthInput" placeholder="${e(t("cfg.mesVacio"))}" maxlength="7" inputmode="numeric" autocomplete="off"/>
          <span class="ui-field__hint">${e(t("cfg6.mant.mesHint"))}</span></label>
        <div class="cfgx-form-row__btn">${btn({ label: t("cfg6.mant.btn"), variant: "danger", icon: "trash", act: "deleteDashboardData" })}</div>
      </div>
    </section>`;
}

export async function deleteDashboardData() {
  const tableSel = document.getElementById("delTableSel");
  const monthInp = document.getElementById("delMonthInput");
  if (!tableSel || !monthInp) return;
  // Espejo de RLS: DELETE en rendimiento*/metas = admin o delete:data.
  if (!_puede("datos.borrar")) { showBanner(false, t("cfg6.mant.bloqueada")); return; }

  const table = tableSel.value;
  const mes = monthInp.value.trim();
  const labels = _TABLAS_BORRADO();
  if (mes && !/^\d{4}-\d{2}$/.test(mes)) {
    await alertDialog({ title: t("cfg6.mant.mesInvalidoTitulo"), body: t("cfg.formatoMesInvalido"), tone: "bad" });
    return;
  }
  // B3: el filtro se arma UNA vez y sirve para el conteo previo Y el borrado.
  let filtroMetas = null;
  if (table === "metas" && mes) {
    filtroMetas = filtroMetasDeMes(mes);
    if (!filtroMetas) { await alertDialog({ title: t("cfg6.mant.mesInvalidoTitulo"), body: t("cfg.formatoMesInvalido"), tone: "bad" }); return; }
  }
  const aplicarFiltro = q => {
    if (!mes) return q.neq("clid", "__NEVER_MATCH__");   // DELETE exige WHERE
    const [y, m] = mes.split("-").map(Number);
    const monthEnd = `${mes}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
    const monthStart = `${mes}-01`;
    if (table === "rendimiento")         return q.gte("fecha", monthStart).lte("fecha", monthEnd);
    if (table === "rendimiento_diario")  return q.gte("date", monthStart).lte("date", monthEnd);
    if (table === "rendimiento_mensual") return q.eq("mes", mes);
    if (table === "metas")               return q.or(filtroMetas.orPostgrest).eq("mes_year", filtroMetas.anio);
    return q;
  };
  const etiquetaMes = table === "metas" && filtroMetas ? `${filtroMetas.nombres[0]} ${filtroMetas.anio}` : mes;
  const scope = mes ? t("cfg.delMes", { m: etiquetaMes }) : t("cfg.delTodaTabla");

  showLoad(true, t("cfg6.mant.contando"));
  let previstas = null;
  try {
    const { count, error: cErr } = await aplicarFiltro(sb.from(table).select("clid", { count: "exact", head: true }));
    if (cErr) throw cErr;
    previstas = count ?? 0;
  } catch (err) {
    showLoad(false);
    showBanner(false, t("cfg.errorEliminar") + (err.message || err));
    return;
  } finally { showLoad(false); }
  if (previstas === 0) {
    showBanner(false, mes ? t("cfg.sinFilasMes", { t: labels[table], m: etiquetaMes }) : t("cfg.sinFilas", { t: labels[table] }));
    return;
  }
  const nTxt = previstas.toLocaleString("es-PE");
  const ok = await confirmDialog({
    title: t("cfg6.mant.confTitulo", { n: nTxt }),
    body: t("cfg6.mant.confBody", { s: scope, t: labels[table], n: nTxt, tb: table }),
    confirmLabel: t("cfg6.mant.confOk", { n: nTxt }),
    danger: true,
    // Borrar la tabla ENTERA pide teclear su nombre: es la acción más
    // destructiva de la app y no se debe poder aceptar por reflejo.
    requireText: mes ? undefined : table
  });
  if (!ok) return;

  showLoad(true, t("cfg.eliminandoTabla", { t: labels[table] }));
  try {
    const { count: borradas, error } = await aplicarFiltro(sb.from(table).delete({ count: "exact" }));
    if (error) throw error;
    const n = borradas ?? 0;
    if (n === 0) { showBanner(false, msgSinFilas()); return; }
    monthInp.value = "";
    if (table === "metas") { STATE.metasMesSel = null; STATE.metasMesSelYear = null; }
    const okR = await refrescarTrasEscritura();
    const msg = t("cfg.eliminadoTabla", { t: labels[table], m: mes ? `(${etiquetaMes})` : t("cfg.todo") }) +
      " · " + t("cfg.nFilas", { n: n.toLocaleString("es-PE") }) +
      (n !== previstas ? " " + t("cfg.seEsperaban", { n: nTxt }) : "");
    showBanner(okR, okR ? msg : `${msg}. ${t("comun.sinRefresco")}`);
    if (STATE.curTab === "config") renderConfig();
  } catch (err) {
    showBanner(false, t("cfg.errorEliminar") + err.message);
    console.error(err);
  } finally { showLoad(false); }
}

// ── Acciones delegadas ───────────────────────────────────────────────────────
registerActions({
  // Partners
  cfgSearch:    (d, el) => { CONFIG_STATE.search = el.value; CONFIG_STATE.page = 0; renderConfigResults(); },
  cfgKamFilter: (d, el) => { CONFIG_STATE.kamFilter = el.value; CONFIG_STATE.page = 0; renderConfigResults(); },
  cfgEstado:    d => { CONFIG_STATE.estado = d.value; CONFIG_STATE.page = 0; renderConfig(); },
  cfgPagePrev:  () => { CONFIG_STATE.page = Math.max(0, CONFIG_STATE.page - 1); renderConfigResults(); },
  cfgPageNext:  d  => { CONFIG_STATE.page = Math.min((+d.total || 1) - 1, CONFIG_STATE.page + 1); renderConfigResults(); },
  cfgSel:       (d, el) => { if (el.checked) CONFIG_STATE.sel.add(d.clid); else CONFIG_STATE.sel.delete(d.clid); renderConfigResults(); },
  cfgSelPagina: (d, el) => {
    document.querySelectorAll("#crudTable tbody input[data-act-change='cfgSel']").forEach(cb => {
      if (el.checked) CONFIG_STATE.sel.add(cb.dataset.clid); else CONFIG_STATE.sel.delete(cb.dataset.clid);
    });
    renderConfigResults();
  },
  cfgSelLimpiar: () => { CONFIG_STATE.sel.clear(); renderConfigResults(); },
  cfgBulkReasignar,
  cfgPanelAlta:   d => { CONFIG_STATE.panel = { modo: "alta", clid: d.clid || null }; if (CONFIG_STATE.section !== "partners") { CONFIG_STATE.section = "partners"; renderConfig(); } else renderConfigResults(); _enfocarPanel(); },
  cfgPanelEditar: d => { CONFIG_STATE.panel = { modo: "editar", clid: d.clid }; renderConfigResults(); _enfocarPanel(); },
  cfgPanelCerrar: () => { CONFIG_STATE.panel = null; renderConfigResults(); },
  cfgPanelGuardar,
  cfgKamSel: (d, el) => {
    const inp = document.getElementById(el.id + "_new");
    if (inp) { inp.hidden = el.value !== "__new__"; if (!inp.hidden) inp.focus(); }
    _avisoKamDup(el.id);
  },
  cfgKamNuevo: d => _avisoKamDup(d.for),
  kamCrudDelete: d => kamCrudDelete(d.clid),
  cfgPedirLogo:  d => cfgPedirLogo(d.clid),
  cfgSubirLogo:  (d, el) => cfgSubirLogo(d.clid, el),
  cfgBorrarLogo: d => cfgBorrarLogo(d.clid),

  // Clasificación
  clasifVista:   d => { CLASIF_STATE.vista = d.value; CLASIF_STATE.editingClid = null; renderConfig(); },
  clasifSearch:  (d, el) => {
    CLASIF_STATE.search = el.value;
    const id = el.id, pos = el.selectionStart;
    _repintarClasif();
    const n = id && document.getElementById(id);
    if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {} }
  },
  clasifCity:    (d, el) => { CLASIF_STATE.city = el.value; _repintarClasif(); },
  clasifDesde:   (d, el) => { CLASIF_STATE.dateFrom = el.value; _repintarClasif(); },
  clasifHasta:   (d, el) => { CLASIF_STATE.dateTo = el.value; _repintarClasif(); },
  clasifSoloSub: (d, el) => { CLASIF_STATE.soloConSub = el.checked; _repintarClasif(); },
  flotaSetFlag:     (d, el) => flotaSetFlagCLID(d.clid, d.key, el.checked),
  fleetroomSetFlag: (d, el) => fleetroomSetFlag(d.dbid, d.key, el.checked, d.name, d.clid, d.kam, d.city),
  flotaStartEdit:    d => { CLASIF_STATE.editingClid = d.clid; _repintarClasif(); },
  flotaCancelEdit:   () => { CLASIF_STATE.editingClid = null; _repintarClasif(); },
  flotaSaveEdit:     d => flotaSaveEdit(d.clid),
  flotaToggleActivo: d => flotaToggleActivo(d.clid, d.activo === "1"),
  addTuktukPattern,
  addTuktukPatternEnter: (d, el, ev) => { if (ev.key === "Enter") addTuktukPattern(); },
  removeTuktukPattern: d => removeTuktukPattern(d.word),
  exportFlotasCSV, exportReconCSV,
  reconExpandAll:  d => reconExpandAll(d.open === "1"),
  reconToggleClid: d => { CLASIF_STATE.expanded[d.clid] = !CLASIF_STATE.expanded[d.clid]; _repintarClasif(); },

  // Cargas
  cfgElegirArchivo: d => { const i = document.getElementById(d.input); if (i) i.click(); },

  // Mantenimiento
  deleteDashboardData
});

function _enfocarPanel() {
  requestAnimationFrame(() => {
    const p = document.getElementById("cfgPanel");
    if (!p) return;
    if (p.getBoundingClientRect().top < 0 || p.getBoundingClientRect().top > window.innerHeight) p.scrollIntoView({ block: "start", behavior: "smooth" });
    const campo = document.getElementById(document.getElementById("cfgPanClid")?.readOnly ? "cfgPanNombre" : "cfgPanClid");
    if (campo) campo.focus({ preventScroll: true });
  });
}


// switchTab (app.ts) repinta la tabla cuando llegan los logos preguntando por
// este global; el chunk no pasa por loadViewModule, así que se expone acá.
window.renderConfigResults = renderConfigResults;
