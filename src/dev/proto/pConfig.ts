// dev/proto/pConfig.ts — Configuración en las 4 versiones del prototipo.

import { escapeHTML as e } from "../../core/security";
import { iconSvg } from "../../shared/icons";
import { segmented, badge, btn, alertBox } from "../../shared/ui";
import { PS, type SeccionCfg } from "./state";
import { filasMaestro, FLEETROOMS, USUARIOS, KAMS, CIUDADES, cityLabel, partnerDe, type FilaMaestro } from "./model";

const SECS: { g: string; items: [SeccionCfg, string, string][] }[] = [
  { g: "Datos maestros", items: [["partners", "Partners", "users"], ["clasificacion", "Clasificación", "filter"], ["cargas", "Cargas", "upload"]] },
  { g: "Accesos", items: [["usuarios", "Usuarios y accesos", "lock"], ["monitoreo", "Monitoreo", "activity"]] },
  { g: "Sistema", items: [["preferencias", "Preferencias", "settings"], ["mantenimiento", "Mantenimiento", "database"]] }
];
const TITULOS: Record<SeccionCfg, [string, string]> = {
  partners: ["Partners", ""], clasificacion: ["Clasificación", "A qué línea de negocio pertenece cada sub-flota (db_id) y el respaldo de Flotas"],
  cargas: ["Cargas", "Sube los Excel de cada fuente. Cada carga dice qué columnas espera y cuál fue el último período."],
  usuarios: ["Usuarios y accesos", "Roles (admin / kam / viewer / partner), permisos extra por usuario y —para partners— sus CLIDs"],
  monitoreo: ["Monitoreo", "Quién entra, qué descarga y qué se cambió en la base"],
  preferencias: ["Preferencias", "Alerta de declive y otras opciones de la app"],
  mantenimiento: ["Mantenimiento", "Borrar datos por período. Acciones irreversibles."]
};

const FILAS = filasMaestro();
const pendiente = (f: FilaMaestro) => !f.alta || f.sinKam;
const PEND = FILAS.filter(pendiente);

function subnav(cls = "cfgx-subnav", itemCls = "cfgx-subnav__item"): string {
  return `<nav class="${cls}" aria-label="Secciones de Configuración">${SECS.map(g => `<div class="cfgx-subnav__group"><div class="cfgx-subnav__label">${g.g}</div>${g.items.map(([k, l, ic]) =>
    `<button type="button" class="${itemCls}"${PS.cfg.sec === k ? ' aria-current="page"' : ""} data-act="prCfgSec" data-value="${k}">${iconSvg(ic, { size: 16 })}<span>${l}</span></button>`).join("")}</div>`).join("")}</nav>`;
}
function head(sec: SeccionCfg, actions = ""): string {
  const [t, s] = TITULOS[sec];
  const sub = sec === "partners" ? `${FILAS.length} CLIDs · ${FILAS.filter(f => f.alta).length} dados de alta · ${PEND.length} pendientes` : s;
  return `<div class="cfgx-head"><div class="cfgx-head__txt"><h2 class="cfgx-head__title">${e(t)}</h2><p class="cfgx-head__sub">${e(sub)}</p></div>${actions ? `<div class="cfgx-head__actions">${actions}</div>` : ""}</div>`;
}
const motivo = (f: FilaMaestro) => !f.alta ? badge("Sin alta", "warn") : badge("Sin KAM", "warn");
function pendientes(cls = "cfgx-pend"): string {
  return `<section class="${cls}" aria-label="Pendientes de configurar"><div class="cfgx-pend__head">${iconSvg("alert-triangle", { size: 16 })}<strong>Pendientes de configurar</strong>
    <span class="cfgx-muted">${PEND.length} CLID(s) sin alta, sin KAM o sin nombre propio. Hasta resolverlos se ven bajo «Sin KAM» o con el número de CLID.</span></div>
    <ul class="cfgx-pend__list">${PEND.map(f => `<li class="cfgx-pend__item"><div class="cfgx-pend__who"><span class="cfgx-pend__name">${e(f.nombre)}</span><span class="cfgx-mono cfgx-muted">${f.clid}</span></div>
      <div class="cfgx-pend__why">${motivo(f)}</div><div class="cfgx-pend__act">${btn({ label: f.alta ? "Completar" : "Dar de alta", size: "sm", act: "prCfgPanel", data: { clid: f.clid } })}</div></li>`).join("")}</ul></section>`;
}
function filtradas(): FilaMaestro[] {
  const q = PS.cfg.buscar.toLowerCase().trim();
  return FILAS.filter(f => (PS.cfg.kam === "all" || (f.kam || "Sin KAM") === PS.cfg.kam) && (PS.cfg.estado === "todos" || pendiente(f)) &&
    (!q || [f.clid, f.nombre, f.kam].some(s => (s || "").toLowerCase().includes(q))));
}
function toolbar(): string {
  const n = filtradas().length;
  return `<div class="cfgx-toolbar"><input class="ui-input cfgx-search" placeholder="Buscar CLID, partner o KAM…" value="${e(PS.cfg.buscar)}" data-act-input="prCfgBuscar" aria-label="Buscar">
    <select class="ui-select cfgx-sel" data-act-change="prCfgKam"><option value="all">Todos los KAMs</option>${[...KAMS, "Sin KAM"].map(k => `<option value="${k}"${PS.cfg.kam === k ? " selected" : ""}>${k} (${FILAS.filter(f => (f.kam || "Sin KAM") === k).length})</option>`).join("")}</select>
    ${segmented({ ariaLabel: "Estado", act: "prCfgEstado", value: PS.cfg.estado, options: [{ value: "todos", label: "Todos" }, { value: "pendientes", label: `Pendientes (${PEND.length})` }] })}
    <span class="cfgx-count">${n} resultado${n === 1 ? "" : "s"}</span></div>`;
}
function lineas(f: FilaMaestro): string {
  return f.subflotas ? `<span class="cfgx-muted" title="Cada sub-flota se clasifica en Clasificación">Según sub-flotas</span>`
    : [f.fleet ? badge("Fleet", "neutral", { icon: "car" }) : "", f.tuktuk ? badge("TukTuk", "neutral", { icon: "tuktuk" }) : ""].filter(Boolean).join(" ") || `<span class="cfgx-muted">Solo Taxi</span>`;
}
function tabla(filas: FilaMaestro[], wrap = "ui-table-wrap"): string {
  const rows = filas.slice(0, 15).map(f => `<tr${PS.cfg.panel === f.clid ? ' class="cfgx-row--open"' : ""}><td class="cfgx-td-cb">${f.alta ? `<input type="checkbox" class="cfgx-cb" aria-label="Seleccionar ${e(f.nombre)}">` : ""}</td>
    <td class="cfgx-mono">${f.clid}</td><td><span class="cfgx-strong">${e(f.nombre)}</span>${!f.alta ? `<div class="cfgx-hint">nombre desde Flotas</div>` : ""}</td>
    <td>${f.kam ? e(f.kam) : `<span class="cfgx-muted">Sin KAM</span>`}</td><td>${f.ciudades.join(", ") || `<span class="cfgx-muted">—</span>`}</td><td>${lineas(f)}</td>
    <td><span class="cfgx-muted">—</span></td><td>${!f.alta ? badge("Sin alta", "warn") : !f.activo ? badge("Inactiva", "neutral") : `<span class="cfgx-muted">Alta</span>`}</td>
    <td class="cfgx-td-acc">${f.alta ? btn({ label: "Editar", size: "sm", variant: "ghost", icon: "edit", act: "prCfgPanel", data: { clid: f.clid } }) + btn({ label: `Eliminar ${f.nombre}`, iconOnly: true, icon: "trash", size: "sm", variant: "ghost", act: "prCfgBorrar", data: { clid: f.clid } })
      : btn({ label: "Dar de alta", size: "sm", act: "prCfgPanel", data: { clid: f.clid } })}</td></tr>`).join("");
  return `<div class="${wrap}"><table class="ui-table cfgx-table"><thead><tr><th class="cfgx-td-cb"><input type="checkbox" class="cfgx-cb" aria-label="Seleccionar página"></th><th>CLID</th><th>Partner</th><th>KAM</th><th>Ciudades</th><th>Líneas</th><th>Logo</th><th>Estado</th><th class="cfgx-td-acc">Acciones</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="9" class="cfgx-empty-row">Ningún CLID coincide con el filtro.</td></tr>`}</tbody></table></div>` +
    (filas.length > 15 ? `<div class="cfgx-pager">${btn({ label: "Anterior", size: "sm", icon: "chevron-left", disabled: true })}<span>Página <strong>1</strong> de <strong>${Math.ceil(filas.length / 15)}</strong></span>${btn({ label: "Siguiente", size: "sm", act: "prToast", data: { msg: "Pasaría a la página 2" } })}</div>` : "");
}
function panel(cls = "cfgx-panel"): string {
  const f = FILAS.find(x => x.clid === PS.cfg.panel);
  if (!f) return "";
  const alta = !f.alta;
  const kamOpts = `<option value="">Sin KAM</option>${KAMS.map(k => `<option${k === f.kam ? " selected" : ""}>${k}</option>`).join("")}<option>Otro KAM…</option>`;
  return `<aside class="${cls}" aria-labelledby="prCfgPanelT"><div class="cfgx-panel__head"><h3 class="cfgx-panel__title" id="prCfgPanelT">${alta ? "Dar de alta" : "Editar partner"}</h3>${btn({ label: "Cerrar", iconOnly: true, icon: "x", size: "sm", variant: "ghost", act: "prCfgPanel", data: { clid: "" } })}</div>
    ${alta ? alertBox({ tone: "info", text: "Valores sugeridos a partir de Flotas y de los datos cargados. Revísalos antes de guardar." }) : ""}
    <div class="ui-field"><label class="ui-field__label">CLID</label><input class="ui-input cfgx-mono" value="${f.clid}" readonly></div>
    <div class="ui-field"><label class="ui-field__label">Nombre del partner</label><input class="ui-input" value="${e(f.nombre)}"></div>
    <div class="ui-field"><label class="ui-field__label">KAM</label><select class="ui-select">${kamOpts}</select></div>
    ${alta ? `<div class="ui-field"><label class="ui-field__label">Ciudad</label><select class="ui-select">${CIUDADES.map(c => `<option>${cityLabel(c)}</option>`).join("")}</select><div class="ui-field__hint">Solo para el alta; las ciudades salen de los datos.</div></div>` : ""}
    <div class="ui-field"><span class="ui-field__label">Líneas</span>${f.subflotas ? `<div class="cfgx-note">${iconSvg("info", { size: 14 })}<span>Este CLID tiene ${f.subflotas} sub-flota(s): cada una se clasifica por separado.</span><button type="button" class="ui-link-btn" data-act="prCfgSec" data-value="clasificacion">Ir a Clasificación</button></div>`
      : `<label class="cfgx-check"><input type="checkbox"${f.fleet ? " checked" : ""}> Fleet</label> <label class="cfgx-check"><input type="checkbox"${f.tuktuk ? " checked" : ""}> TukTuk</label>`}</div>
    ${!alta ? `<div class="ui-field"><span class="ui-field__label">Logo</span><div class="cfgx-logo"><span class="cfgx-muted">Sin logo</span>${btn({ label: "Subir logo", size: "sm", icon: "image", act: "prToast", data: { msg: "Abriría el selector de imagen" } })}</div></div>` : ""}
    <div class="cfgx-panel__actions">${btn({ label: alta ? "Dar de alta" : "Guardar", variant: "primary", icon: "save", act: "prCfgGuardar" })}${btn({ label: "Cancelar", variant: "ghost", act: "prCfgPanel", data: { clid: "" } })}</div>
    ${!alta ? `<div class="cfgx-panel__danger">${btn({ label: "Eliminar CLID", variant: "danger", size: "sm", icon: "trash", act: "prCfgBorrar", data: { clid: f.clid } })}</div>` : ""}</aside>`;
}

// ── Secciones secundarias ──────────────────────────────────────────────────
function clasificacion(wrap = "ui-table-wrap ui-table-wrap--scroll cfgx-tree-wrap"): string {
  const clids: string[] = [...new Set<string>(FLEETROOMS.map(r => r.clid as string))].slice(0, 9);
  const ck = (on: boolean) => `<input type="checkbox" class="cfgx-cb"${on ? " checked" : ""} data-act-change="prToastIn" data-msg="Clasificación cambiada (solo en el prototipo)">`;
  const rows = clids.map(c => {
    const p = partnerDe(c), subs = FLEETROOMS.filter(r => r.clid === c);
    return `<tr class="cfgx-clid-row"><td class="cfgx-mono"><strong>${c}</strong></td><td><strong>${e(p.name)}</strong><div class="cfgx-hint">${e(p.kam)} · ${subs.map(s => cityLabel(s.city)).filter((v, i, a) => a.indexOf(v) === i).join(", ")}</div></td>
      <td class="cfgx-muted">${subs.length} fleetroom(s)</td><td></td><td class="cfgx-c">${subs.some(s => s.fleet) ? "Sí" : "No"}</td><td class="cfgx-c">${subs.some(s => s.tuktuk) ? "Sí" : "No"}</td><td class="cfgx-c">—</td><td class="cfgx-c">—</td><td class="cfgx-c">—</td></tr>` +
      subs.map(s => `<tr class="cfgx-sub-row"><td class="cfgx-mono cfgx-muted">${e(s.dbId.slice(0, 14))}…</td><td>${iconSvg("arrow-right", { size: 12 })} ${e(s.nombre)} ${badge("Propia", "neutral")}</td><td></td>
        <td class="cfgx-c">${s.delivery || s.cargo || s.excluir ? "—" : `<span class="cfgx-yes">${iconSvg("check", { size: 14 })}</span>`}</td>
        <td class="cfgx-c">${ck(s.fleet)}</td><td class="cfgx-c">${ck(s.tuktuk)}</td><td class="cfgx-c">${ck(s.delivery)}</td><td class="cfgx-c">${ck(s.cargo)}</td><td class="cfgx-c">${ck(s.excluir)}</td></tr>`).join("");
  }).join("");
  return alertBox({ tone: "info", text: "Cada casilla muestra el valor EFECTIVO. Una sub-flota sin clasificación propia hereda Fleet y TukTuk de su CLID («Hereda del CLID»); al tocar una casilla se guarda su clasificación propia conservando lo que heredaba." }) +
    `<div class="cfgx-stats"><span>${FILAS.length} CLIDs</span><span>${FLEETROOMS.length} sub-flotas · ${FLEETROOMS.length} con clasificación propia · 0 heredan del CLID</span></div>
    <div class="cfgx-toolbar"><input class="ui-input cfgx-search" placeholder="Buscar CLID, partner, KAM, ciudad…"><select class="ui-select cfgx-sel"><option>Todas las ciudades</option>${CIUDADES.map(c => `<option>${cityLabel(c)}</option>`).join("")}</select>
      <label class="cfgx-check"><input type="checkbox"> Solo CLIDs con sub-flotas</label><span class="cfgx-toolbar__end">${btn({ label: "Exportar CSV", size: "sm", icon: "download", act: "prToast", data: { msg: "Descargaría el CSV de clasificación" } })}</span></div>
    <div class="${wrap}"><table class="ui-table cfgx-table"><thead><tr><th>CLID / db_id</th><th>Partner / sub-flota</th><th>Origen</th><th class="cfgx-c">Cuenta en Taxi</th><th class="cfgx-c">Fleet</th><th class="cfgx-c">TukTuk</th><th class="cfgx-c">Delivery</th><th class="cfgx-c">Cargo</th><th class="cfgx-c">Excluir de Taxi</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
const ROLES = [["admin", "Admin"], ["kam", "KAM"], ["viewer", "Viewer"], ["partner", "Partner"]];
function tarjetaUsuario(u: any, i: number): string {
  const kamBlock = u.rol === "kam" ? `<div class="au6-field"><label class="au6-field__label" for="prAuKam${i}">KAM vinculado</label>
      <select class="ui-select ui-select--sm" id="prAuKam${i}" data-act-change="prToastIn" data-msg="KAM vinculado actualizado (solo en el prototipo)"><option value="">(ninguno)</option>${KAMS.map(k => `<option${k === u.kam ? " selected" : ""}>${k}</option>`).join("")}</select>
      <span class="ui-field__hint">La Calculadora lo preselecciona. Se aplica cuando esa persona vuelve a iniciar sesión.</span></div>`
    : u.rol === "admin" ? `<div class="au6-field"><div class="au6-field__label">KAM vinculado <span class="au6-muted">solo lectura</span></div><div><span class="au6-muted">No vinculado</span></div></div>` : "";
  return `<article class="ui-card au6-card"><div class="au6-card__head"><div class="au6-avatar" aria-hidden="true">${u.email.charAt(0).toUpperCase()}</div>
    <div class="au6-ident"><div class="au6-email">${e(u.email)}${u.yo ? ` ${badge("Tú", "info")}` : ""}</div><div class="au6-meta"><span class="au6-dot au6-dot--${u.tono}" aria-hidden="true"></span><span>${e(u.acceso)}</span><span>· alta ${u.alta}</span></div></div>
    <div class="au6-actions">${btn({ label: "Cerrar sus sesiones", iconOnly: true, icon: "log-out", size: "sm", variant: "ghost", act: "prToast", data: { msg: "Cerraría todas sus sesiones" } })}${btn({ label: u.yo ? "No puedes eliminarte" : "Eliminar usuario", iconOnly: true, icon: "trash", size: "sm", variant: "ghost", act: "prToast", data: { msg: "Pediría confirmación en línea" }, disabled: !!u.yo })}</div></div>
    <div class="au6-field"><div class="au6-field__label">Rol</div>${segmented({ ariaLabel: "Rol", act: "prToast", value: u.rol, options: ROLES.map(([v, l]) => ({ value: v, label: l })) })}</div>
    ${kamBlock}
    <div class="au6-field"><div class="au6-field__label">Permisos extra</div><div class="au6-perms">${u.rol === "admin" ? `<span class="au6-muted">Un admin ya tiene todos los permisos.</span>` :
      [["Escribir metas", u.rol === "kam"], ["Editar partners", false], ["Borrar datos", false]].map(([l, on]) => `<label class="au6-perm${on ? " au6-perm--on" : ""}"><input type="checkbox"${on ? " checked" : ""}><span>${l}</span></label>`).join("")}</div></div>
    ${u.rol === "partner" ? `<div class="au6-field"><div class="au6-field__label">CLIDs asignados</div><div class="ui-chips">${(u.clids || []).map(c => `<span class="ui-chip"><span class="ui-chip__val">${c} · ${e(partnerDe(c).name)}</span></span>`).join("")}</div></div>` : ""}</article>`;
}
function usuarios(): string {
  return `<div class="au6-toolbar"><input class="ui-input au6-search" placeholder="Buscar por email…">${segmented({ ariaLabel: "Rol", act: "prToast", value: "todos", options: [{ value: "todos", label: `Todos (${USUARIOS.length})` }, ...ROLES.map(([v, l]) => ({ value: v, label: `${l} (${USUARIOS.filter(u => u.rol === v).length})` }))] })}
    <span class="au6-toolbar__end">${btn({ label: "Invitar usuario", icon: "plus", act: "prToast", data: { msg: "Abriría el formulario de invitación" } })}</span></div>
    <div class="au6-grid">${USUARIOS.map(tarjetaUsuario).join("")}</div>`;
}
function cargas(): string {
  const C = [["Rendimiento semanal", "Semana del 14/09/2026", "activity"], ["Rendimiento mensual", "Septiembre 2026 (parcial)", "calendar"], ["Rendimiento diario", "20/09/2026", "clock"],
    ["Metas", "Septiembre 2026 · 61 filas", "target"], ["Partners", "58 CLIDs", "users"], ["Flotas", "3 filas", "car"], ["Conversión (país)", "Agosto 2026", "trending-up"]];
  return `<div class="cfgx-cards">${C.map(([t, u, ic]) => `<div class="ui-card cfgx-card"><div class="cfgx-card__head">${iconSvg(ic, { size: 18 })}<span class="cfgx-card__title">${t}</span></div>
    <div class="cfgx-card__ult">Último período: <strong>${u}</strong></div><div class="cfgx-card__foot">${btn({ label: "Subir Excel", size: "sm", icon: "upload", act: "prToast", data: { msg: "Abriría el selector de archivo" } })}</div></div>`).join("")}</div>`;
}
function simple(sec: SeccionCfg): string {
  if (sec === "mantenimiento") return `<section class="ui-card cfgx-block cfgx-block--danger"><h3 class="cfgx-panel__title">Eliminar metas de un mes</h3><p class="cfgx-hint">Borra todas las metas del mes elegido. No se puede deshacer.</p>
    <div class="cfgx-toolbar"><select class="ui-select cfgx-sel"><option>Septiembre 2026</option><option>Agosto 2026</option></select>${btn({ label: "Eliminar metas", variant: "danger", icon: "trash", act: "prBorrarMetas" })}</div></section>`;
  if (sec === "preferencias") return `<section class="ui-card cfgx-block"><h3 class="cfgx-panel__title">Alerta de declive</h3><p class="cfgx-hint">Marca en Rendimiento a los partners que caen N semanas seguidas.</p>
    <div class="cfgx-toolbar"><label class="ui-field"><span class="ui-field__label">Semanas seguidas</span><input class="ui-input ui-input--sm" value="3" style="width:80px"></label><label class="ui-field"><span class="ui-field__label">Métrica</span><select class="ui-select ui-select--sm"><option>Conductores activos</option><option>Horas</option><option>N+R</option></select></label></div></section>`;
  return `<div class="mon6-kpis ui-kpi-grid"><div class="ui-kpi"><div class="ui-kpi__label">Ingresos (7 días)</div><div class="ui-kpi__row"><span class="ui-kpi__value">42</span></div></div>
    <div class="ui-kpi"><div class="ui-kpi__label">Personas activas</div><div class="ui-kpi__row"><span class="ui-kpi__value">9</span></div></div><div class="ui-kpi"><div class="ui-kpi__label">Descargas</div><div class="ui-kpi__row"><span class="ui-kpi__value">17</span></div></div></div>`;
}

function cuerpo(sec: SeccionCfg, v: string): string {
  if (sec === "partners") {
    const pn = panel(v === "b" ? "cfgx-panel pr-b-drawer" : "cfgx-panel");
    return head(sec, btn({ label: "Agregar CLID", icon: "plus", act: "prCfgPanel", data: { clid: PEND.find(f => !f.alta)?.clid || "" } })) +
      pendientes(v === "b" ? "cfgx-pend pr-b-pend" : v === "a" ? "cfgx-pend pr-a-pend" : "cfgx-pend") + toolbar() +
      `<div class="cfgx-split${pn ? " cfgx-split--panel" : ""}"><div class="cfgx-split__main">${tabla(filtradas(), v === "a" ? "pr-a-table" : v === "b" ? "pr-b-table" : "ui-table-wrap")}</div>${pn}</div>`;
  }
  if (sec === "clasificacion") return head(sec, segmented({ ariaLabel: "Vista", act: "prToast", value: "sub", options: [{ value: "sub", label: "Sub-flotas", icon: "list-check" }, { value: "conc", label: "Conciliación", icon: "table" }] })) + clasificacion();
  if (sec === "usuarios") return head(sec) + usuarios();
  if (sec === "cargas") return head(sec) + cargas();
  return head(sec) + simple(sec);
}

// ── C: tres columnas (secciones · lista · detalle) ─────────────────────────
function versionC(): string {
  const sec = PS.cfg.sec;
  let lista = "", detalle = "";
  if (sec === "partners") {
    const fs = filtradas();
    const sel = FILAS.find(f => f.clid === PS.cfg.panel) || fs[0];
    lista = `<div class="pr-c-list"><div class="pr-c-list__head"><span>${fs.length} CLIDs · ${PEND.length} pendientes</span>${btn({ label: "Agregar", size: "sm", icon: "plus", act: "prCfgPanel", data: { clid: PEND.find(f => !f.alta)?.clid || "" } })}</div>
      <div class="pr-c-list__tools"><input class="ui-input ui-input--sm" placeholder="Buscar…" value="${e(PS.cfg.buscar)}" data-act-input="prCfgBuscar">${segmented({ ariaLabel: "Estado", act: "prCfgEstado", value: PS.cfg.estado, options: [{ value: "todos", label: "Todos" }, { value: "pendientes", label: `Pendientes ${PEND.length}` }] })}</div>
      <div class="pr-c-list__body">${fs.map(f => `<button type="button" class="pr-c-row pr-c-row--cfg${f === sel ? " is-sel" : ""}" data-act="prCfgPanel" data-clid="${f.clid}"><span class="pr-c-row__name"><span>${e(f.nombre)}</span></span>
        <span class="pr-c-row__kam">${f.kam ? e(f.kam) : `<span class="pr-warn-txt">Sin KAM</span>`}</span><span class="pr-c-row__d">${pendiente(f) ? motivo(f) : `<span class="cfgx-mono cfgx-muted">${f.clid.slice(-4)}</span>`}</span></button>`).join("")}</div></div>`;
    if (sel) { const keep = PS.cfg.panel; PS.cfg.panel = sel.clid; detalle = panel("cfgx-panel pr-c-detail pr-c-detail--cfg"); PS.cfg.panel = keep; }
  } else if (sec === "usuarios") {
    const sel = USUARIOS[PS.cfg.usuario] || USUARIOS[0];
    lista = `<div class="pr-c-list"><div class="pr-c-list__head"><span>${USUARIOS.length} usuarios</span>${btn({ label: "Invitar", size: "sm", icon: "plus", act: "prToast", data: { msg: "Abriría el formulario de invitación" } })}</div><div class="pr-c-list__body">${USUARIOS.map((u, i) =>
      `<button type="button" class="pr-c-row pr-c-row--cfg${u === sel ? " is-sel" : ""}" data-act="prCfgUsuario" data-value="${i}"><span class="pr-c-row__name"><span class="au6-dot au6-dot--${u.tono}"></span><span>${e(u.email)}</span></span><span class="pr-c-row__kam">${u.rol}</span><span class="pr-c-row__d">${u.kam ? e(u.kam) : ""}</span></button>`).join("")}</div></div>`;
    detalle = `<div class="pr-c-detail">${tarjetaUsuario(sel, 99)}</div>`;
  } else {
    lista = `<div class="pr-c-wide">${cuerpo(sec, "c")}</div>`;
  }
  return `<div class="pr-c-cfg">${subnav("cfgx-subnav pr-c-sections")}${lista}${detalle}</div>`;
}

export function renderConfig(): string {
  if (PS.v === "c") return versionC();
  if (PS.v === "a") return `<div class="pr-a pr-a-cfg">${subnav("cfgx-subnav pr-a-subnav", "cfgx-subnav__item pr-a-tab")}<div class="cfgx-body">${cuerpo(PS.cfg.sec, "a")}</div></div>`;
  if (PS.v === "b") return `<div class="pr-b pr-b-cfg">${subnav("cfgx-subnav pr-b-subnav", "cfgx-subnav__item pr-b-pill")}<div class="cfgx-body">${cuerpo(PS.cfg.sec, "b")}</div></div>`;
  return `<div class="cfgx">${subnav()}<div class="cfgx-body">${cuerpo(PS.cfg.sec, "elegida")}</div></div>`;
}
