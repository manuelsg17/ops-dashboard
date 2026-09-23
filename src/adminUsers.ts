//@ts-nocheck
// adminUsers.js — Administración de usuarios (Track C1). Solo admin.
//
// Reparto de responsabilidades (importante para entender por qué hay dos vías):
//   · auth.users (listar, invitar, cambiar rol, forzar logout) → SOLO se puede
//     con la Admin API, que necesita service_role. Va por la Edge Function
//     `admin-users`, que valida que el llamante sea admin ANTES de privilegiar.
//     La service_role NUNCA toca el frontend.
//   · user_permissions y partner_users → tablas normales con RLS admin-only y
//     trigger de auditoría. Se escriben con PostgREST directo desde acá; no
//     hace falta (ni conviene) pasarlas por la Edge Function.
//
// La UI es un gate de conveniencia: el enforcement real es RLS + el chequeo de
// rol dentro de la Edge Function. Aunque alguien fuerce el render desde
// DevTools, no puede escribir nada.
//
// NOTA DE ARQUITECTURA: este archivo usó Preact (src/components/AdminUsers.tsx)
// en la migración a TS de jul 2026 — revertido a propósito. Preact quedó como
// la ÚNICA pantalla con un paradigma distinto (JSX + onClick nativo) al resto
// de la app (funciones que devuelven HTML + event delegation vía data-act),
// rompiendo la uniformidad de arquitectura sin ningún beneficio funcional para
// un panel CRUD simple. Ver CLAUDE.md.

import { registerActions } from "./shared/actions.js";
import { t } from "./core/i18n";
import { STATE, SIN_KAM } from "./core/config.js";
import { escapeHTML } from "./core/security";
import { btn, badge, alertBox, emptyState, icon, segmented } from "./shared/ui";
import { confirmDialog } from "./shared/confirmDialog";
import { kamsCanonicos } from "./domain/partnersMaestro";

export const ADMIN_USERS_STATE = {
  users: [],        // [{id,email,role,lastSignInAt}]
  perms: [],        // filas de user_permissions
  mappings: [],     // filas de partner_users
  loaded: false,
  loading: false,
  error: null
};

// Permisos que se pueden otorgar (espejo de la taxonomía de la migración B2).
export function AU_PERMISOS_LIST() { return [
  ["write:performance", t("au.permWritePerf")],
  ["write:metas",       t("au.permWriteMetas")],
  ["write:config",      t("au.permWriteConfig")],
  ["write:seguimiento", t("au.permWriteSeg")],
  ["delete:data",       t("au.permDeleteData")],
  ["manage:users",      t("au.permManageUsers")]
]; }

export const AU_ROLES = ["admin", "kam", "viewer", "partner"];

// ── CARGA ────────────────────────────────────────────────────────────────────
export async function auLoadUsers() {
  if (!STATE.isAdmin) return;
  ADMIN_USERS_STATE.loading = true;
  ADMIN_USERS_STATE.error   = null;
  renderAdminUsers();
  try {
    const [fn, permsRes, mapRes] = await Promise.all([
      sb.functions.invoke("admin-users", { body: { action: "list" } }),
      sb.from("user_permissions").select("*"),
      sb.from("partner_users").select("*")
    ]);
    if (fn.error) throw new Error(await _edgeErrMsg(fn.error, t("au.errListarUsuarios")));
    if (fn.data && fn.data.error) throw new Error(String(fn.data.error));
    // I8: antes un error de estas dos lecturas quedaba en silencio y el panel
    // mostraba a todos SIN permisos ni CLIDs — indistinguible de "no tienen", y
    // tildar un permiso sobre esa vista vacía intentaba insertar uno que ya
    // existía. Un fallo se muestra como fallo.
    if (permsRes.error) throw new Error(t("au.errCargarPermisos", { m: permsRes.error.message || String(permsRes.error) }));
    if (mapRes.error)   throw new Error(t("au.errCargarPermisos", { m: mapRes.error.message || String(mapRes.error) }));
    ADMIN_USERS_STATE.users    = fn.data?.users || [];
    ADMIN_USERS_STATE.perms    = permsRes.data  || [];
    ADMIN_USERS_STATE.mappings = mapRes.data    || [];
    ADMIN_USERS_STATE.loaded   = true;
  } catch (e) {
    ADMIN_USERS_STATE.error = e.message || t("au.errCargarUsuarios");
  } finally {
    ADMIN_USERS_STATE.loading = false;
    renderAdminUsers();
  }
}

// ── ACCIONES ─────────────────────────────────────────────────────────────────

// Extrae el mensaje REAL de un error de Edge Function.
//
// POR QUÉ HACE FALTA: ante un status 4xx/5xx, supabase-js tira un
// FunctionsHttpError cuyo `.message` es siempre el genérico "Edge Function
// returned a non-2xx status code" — el motivo concreto viaja en el CUERPO de la
// respuesta (nuestra función devuelve `{error: "..."}`), y ese cuerpo queda en
// `error.context`, sin leer. Resultado: el usuario veía un banner rojo que no
// dice nada y en los logs solo se ve "500", mientras el mensaje útil ("ya existe
// un usuario con ese email", "Requiere rol admin", …) se perdía.
async function _edgeErrMsg(err, fallback) {
  try {
    const body = await err?.context?.json?.();
    if (body && body.error) return String(body.error);
  } catch (_) { /* el cuerpo no era JSON */ }
  try {
    const txt = await err?.context?.text?.();
    if (txt) return txt.slice(0, 300);
  } catch (_) {}
  return (err && err.message) || fallback;
}

async function _fn(action, body) {
  const r = await sb.functions.invoke("admin-users", { body: { action, ...body } });
  if (r.error) throw new Error(await _edgeErrMsg(r.error, t("au.errOperacionRechazada")));
  // La función también puede responder 200 con {error} en algunos caminos.
  if (r.data && r.data.error) throw new Error(String(r.data.error));
  return r.data;
}

export async function auSetRole(userId, role) {
  const u = ADMIN_USERS_STATE.users.find(x => x.id === userId);
  const ok = await confirmDialog({
    title: t("au6.cambiarRolTitulo"),
    body: t("au.confirmCambiarRol", { e: u?.email || userId, r: role }),
    confirmLabel: t("au6.cambiarRolOk", { r: _roleMeta(role).label })
  });
  if (!ok) {
    renderAdminUsers();   // revertir el control a su valor real
    return;
  }
  showLoad(true, t("au.cambiandoRol"));
  try {
    await _fn("setRole", { userId, role });
    await auLoadUsers();
    showBanner(true, t("au.rolActualizado", { r: role }));
  } catch (e) {
    showBanner(false, e.message);
    renderAdminUsers();
  } finally { showLoad(false); }
}

export async function auInvite() {
  const email = (document.getElementById("auInviteEmail")?.value || "").trim();
  const role  = document.getElementById("auInviteRole")?.value || "viewer";
  if (!email) { showBanner(false, t("au.ingresaEmail")); return; }
  showLoad(true, t("au.enviandoInvitacion"));
  try {
    await _fn("invite", { email, role });
    const el = document.getElementById("auInviteEmail"); if (el) el.value = "";
    await auLoadUsers();
    showBanner(true, t("au.invitacionEnviada", { e: email, r: role }));
  } catch (e) {
    showBanner(false, e.message);
  } finally { showLoad(false); }
}

// Elimina la cuenta. IRREVERSIBLE.
//
// La confirmación NO va acá con confirm(): vive en la propia tarjeta
// (AU_UI.confirmDelete) para que se vea a QUIÉN se está borrando mientras se
// confirma. Un diálogo del navegador tapa la pantalla y se acepta por reflejo,
// que es justo lo que no querés en la única acción sin vuelta atrás del panel.
//
// Los guards duros (no borrarse a sí mismo, no dejar el sistema sin admin)
// están en la Edge Function, no acá: esto es UI y se puede saltear.
export async function auDeleteUser(userId) {
  const u = ADMIN_USERS_STATE.users.find(x => x.id === userId);
  try {
    await _fn("deleteUser", { userId });
    AU_UI.confirmDelete = null;
    showBanner(true, t("au.usuarioEliminado", { e: u?.email || "" }));
    await auLoadUsers();
  } catch (e) {
    AU_UI.confirmDelete = null;
    showBanner(false, t("au.noSePudoEliminar") + (e.message || e));
    renderAdminUsers();
  }
}

export async function auForceSignOut(userId) {
  const u = ADMIN_USERS_STATE.users.find(x => x.id === userId);
  const ok = await confirmDialog({
    title: t("au6.cerrarSesionesTitulo"),
    body: t("au.confirmCerrarSesiones", { e: u?.email || userId }),
    confirmLabel: t("au6.cerrarSesionesOk")
  });
  if (!ok) return;
  showLoad(true, t("au.cerrandoSesiones"));
  try {
    await _fn("signOut", { userId });
    showBanner(true, t("au.sesionesCerradas"));
  } catch (e) { showBanner(false, e.message); }
  finally { showLoad(false); }
}

export async function auTogglePerm(userId, permission, on) {
  showLoad(true, t("au.guardandoPermiso"));
  try {
    if (on) {
      const { data: { user } } = await sb.auth.getUser();
      const { error } = await sb.from("user_permissions")
        .insert({ user_id: userId, permission, granted_by: user?.id || null });
      if (error) throw error;
    } else {
      const { error } = await sb.from("user_permissions")
        .delete().eq("user_id", userId).eq("permission", permission);
      if (error) throw error;
    }
    await auLoadUsers();
    showBanner(true, t("au.permisoResultado", { s: on ? t("au.permisoOtorgado") : t("au.permisoRevocado") }));
  } catch (e) {
    showBanner(false, t("au.error") + (e.message || e));
    renderAdminUsers();
  } finally { showLoad(false); }
}

export async function auAddClid(userId) {
  const inp  = document.getElementById(`auClid_${userId}`);
  const clid = (inp?.value || "").trim();
  if (!clid) return;
  if (!STATE.CLID_MAP[clid]) {
    showBanner(false, t("au.clidNoExiste", { c: clid }));
    return;
  }
  showLoad(true, t("au.asignandoClid"));
  try {
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from("partner_users")
      .insert({ user_id: userId, clid, created_by: user?.id || null });
    if (error) throw error;
    if (inp) inp.value = "";
    await auLoadUsers();
    showBanner(true, t("au.clidAsignado", { c: clid }));
  } catch (e) {
    showBanner(false, t("au.error") + (e.message || e));
  } finally { showLoad(false); }
}

export async function auRemoveClid(mappingId) {
  showLoad(true, t("au.quitandoClid"));
  try {
    const { error } = await sb.from("partner_users").delete().eq("id", mappingId);
    if (error) throw error;
    await auLoadUsers();
    showBanner(true, t("au.clidDesasignado"));
  } catch (e) { showBanner(false, t("au.error") + (e.message || e)); }
  finally { showLoad(false); }
}

// ── RENDER ───────────────────────────────────────────────────────────────────
// ── ESTADO DE UI ─────────────────────────────────────────────────────────────
// Búsqueda y filtro por rol viven acá (no en el DOM) para que sobrevivan al
// re-render: el panel se repinta entero tras cada acción.
export const AU_UI = { q: "", rol: "todos", confirmDelete: null };

// Ola 6: sin emojis ni colores propios por rol — icono + etiqueta neutros. El
// rol no es un estado bueno/malo, así que no lleva color semántico.
function _roleMeta(r) {
  const M = {
    admin:   { icon: "lock",     label: t("au.rol.adminLabel"),   desc: t("au.rol.adminDesc") },
    kam:     { icon: "user",     label: t("au.rol.kamLabel"),     desc: t("au.rol.kamDesc") },
    viewer:  { icon: "eye",      label: t("au.rol.viewerLabel"),  desc: t("au.rol.viewerDesc") },
    partner: { icon: "building", label: t("au.rol.partnerLabel"), desc: t("au.rol.partnerDesc") }
  };
  return M[r] || M.viewer;
}

// "es-PE" fijo A PROPOSITO, igual que el timestamp de "Datos cargados" en
// data.ts: son fechas de negocio (Peru), no texto de interfaz — no siguen el
// idioma de la UI. Detectado probando esta pantalla en ruso; se documenta en vez
// de traducirlo para no introducir ambiguedad de formato de fecha (DD/MM vs
// MM/DD) en una fecha que el equipo lee como referencia local de Peru.
function _fechaCorta(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(+d)) return null;
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}
// Antigüedad del último acceso: el dato accionable de un panel de usuarios es
// "hace cuánto", no la fecha exacta. tono: ok ≤7 d · warn <30 d · bad ≥30 d.
function _hace(iso) {
  if (!iso) return { txt: t("au.nuncaIngreso"), tono: "none" };
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (isNaN(dias)) return { txt: "—", tono: "none" };
  if (dias <= 0)  return { txt: t("au.hoy"),  tono: "ok" };
  if (dias === 1) return { txt: t("au.ayer"), tono: "ok" };
  if (dias < 7)   return { txt: t("au.haceDias", { n: dias }), tono: "ok" };
  if (dias < 30)  return { txt: t("au.haceDias", { n: dias }), tono: "warn" };
  const m = Math.floor(dias / 30);
  return { txt: m === 1 ? t("au.haceMes", { n: m }) : t("au.haceMeses", { n: m }), tono: "bad" };
}

const _e = s => escapeHTML(s == null ? "" : String(s));

export function renderAdminUsers() {
  const box = document.getElementById("adminUsersBox");
  if (!box) return;
  if (!STATE.isAdmin) { box.innerHTML = ""; return; }

  const S = ADMIN_USERS_STATE;

  if (!S.loaded && !S.loading && !S.error) {
    box.innerHTML = emptyState({
      icon: "users", title: t("au6.vacioTitulo"), text: t("au.consultanServidor"),
      action: btn({ label: t("au.cargarUsuarios"), variant: "primary", icon: "download", act: "auLoad" })
    });
    return;
  }
  if (S.loading) {
    box.innerHTML = `<div class="au6-loading" role="status">${icon("refresh", { size: 16 })}<span>${_e(t("au.cargandoUsuarios"))}</span></div>`;
    return;
  }
  if (S.error) {
    box.innerHTML = alertBox({ tone: "bad", title: t("au.noSePudoCargar"), text: S.error,
      actions: btn({ label: t("au.reintentar"), size: "sm", icon: "refresh", act: "auLoad" }) });
    return;
  }

  const { permsByUser, clidsByUser } = _auIndices();
  const conteo = r => S.users.filter(u => u.role === r).length;
  const filtro = segmented({
    ariaLabel: t("au6.filtroRolAria"), act: "auFilterRol", value: AU_UI.rol,
    options: [{ value: "todos", label: `${t("au.todos")} ${S.users.length}` },
      ...AU_ROLES.map(r => ({ value: r, label: `${_roleMeta(r).label} ${conteo(r)}`, icon: _roleMeta(r).icon }))]
  });

  let html = `
    <div class="au6-toolbar">
      <input class="ui-input au6-search" type="search" placeholder="${_e(t("au.buscarPorEmail"))}" value="${_e(AU_UI.q)}"
             data-act-input="auSearch" autocomplete="off" aria-label="${_e(t("au.buscarPorEmail"))}"/>
      ${filtro}
      <span class="au6-toolbar__end">${btn({ label: t("au.refrescar"), iconOnly: true, icon: "refresh", size: "sm", variant: "ghost", act: "auLoad" })}</span>
    </div>

    <details class="au6-invite">
      <summary>${icon("plus", { size: 14 })}<span>${_e(t("au.invitarUsuario").replace("＋ ", ""))}</span></summary>
      <div class="au6-invite__body">
        <label class="ui-field au6-invite__email"><span class="ui-field__label">${_e(t("au6.email"))}</span>
          <input class="ui-input" id="auInviteEmail" type="email" placeholder="${_e(t("au.emailDominio"))}"/></label>
        <label class="ui-field"><span class="ui-field__label">${_e(t("au.rolLabel"))}</span>
          <select class="ui-select" id="auInviteRole">
            ${AU_ROLES.map(r => `<option value="${r}"${r === "viewer" ? " selected" : ""}>${_e(_roleMeta(r).label)}</option>`).join("")}
          </select></label>
        <div class="au6-invite__btn">${btn({ label: t("au.enviarInvitacion"), variant: "primary", act: "auInvite" })}</div>
        <p class="ui-field__hint au6-invite__hint">${t("au.invitarHint")}</p>
      </div>
    </details>`;

  // La lista va en su propio contenedor: el buscador la repinta SOLA (I8) y así
  // el <input> no se destruye en cada tecla (antes perdía el foco al tipear).
  html += `<div id="auList">${_auListHTML(permsByUser, clidsByUser)}</div>`;
  box.innerHTML = html + _auFooterHTML();
}

function _auIndices() {
  const S = ADMIN_USERS_STATE;
  const permsByUser = new Map();
  S.perms.forEach(p => {
    if (!permsByUser.has(p.user_id)) permsByUser.set(p.user_id, new Set());
    permsByUser.get(p.user_id).add(p.permission);
  });
  const clidsByUser = new Map();
  S.mappings.forEach(m => {
    if (!clidsByUser.has(m.user_id)) clidsByUser.set(m.user_id, []);
    clidsByUser.get(m.user_id).push(m);
  });
  return { permsByUser, clidsByUser };
}

// Repinta solo la lista (buscador). Si el panel todavía no existe, entero.
function _auRepintarLista() {
  const l = document.getElementById("auList");
  if (!l) { renderAdminUsers(); return; }
  const { permsByUser, clidsByUser } = _auIndices();
  l.innerHTML = _auListHTML(permsByUser, clidsByUser);
}

// KAM vinculado (app_metadata.kam): la Calculadora lo usa para preseleccionar
// la cartera. Con la Edge Function nueva ("list" devuelve la clave `kam` en
// cada usuario y existe la acción `setKam`) se elige acá con un selector. Si la
// función desplegada es la VIEJA (sin la clave `kam`), el bloque queda de SOLO
// LECTURA como antes: ofrecer un selector que termina en "Acción desconocida"
// sería peor. En ese modo se muestra el de la propia sesión (STATE.myKam).
function _kamVinculado(u) {
  if (u.kam) return u.kam;
  if (u.id === STATE.userId && STATE.myKam) return STATE.myKam;
  return null;
}
function _kamEditable(u) { return Object.prototype.hasOwnProperty.call(u, "kam"); }

// Lista canónica de KAMs: la MISMA que usa Configuración → Partners
// (partners ∪ flotas, sin vacíos, ordenada). "No KAM" es un bucket de UI, nunca
// una persona: no se ofrece.
function _auKamsLista() {
  return kamsCanonicos(Object.values(STATE.KAM_MAP || {}),
                       Object.values(STATE.flotasMap || {}).map(f => f && f.kam))
    .filter(k => k !== SIN_KAM);
}

export async function auSetKam(userId, kam) {
  const u = ADMIN_USERS_STATE.users.find(x => x.id === userId);
  const nuevo = (kam || "").trim();
  if (!u || (u.kam || "") === nuevo) return;
  showLoad(true, t("au7.kamGuardando"));
  try {
    await _fn("setKam", { userId, kam: nuevo || null });
    await auLoadUsers();
    showBanner(true, nuevo
      ? t("au7.kamOk", { e: u.email || "", k: nuevo })
      : t("au7.kamQuitadoOk", { e: u.email || "" }));
  } catch (e) {
    showBanner(false, t("au7.kamError") + (e.message || e));
    renderAdminUsers();   // revertir el selector a su valor real
  } finally { showLoad(false); }
}

function _auListHTML(permsByUser, clidsByUser) {
  const S = ADMIN_USERS_STATE;
  const q = (AU_UI.q || "").toLowerCase().trim();
  const visibles = S.users.filter(u =>
    (AU_UI.rol === "todos" || u.role === AU_UI.rol) &&
    (!q || String(u.email || "").toLowerCase().includes(q))
  );
  if (!visibles.length) return emptyState({ icon: "search", title: t("au.ningunoCoincide") });

  let html = `<div class="au6-grid">`;
  visibles.forEach(u => {
    const uid  = _e(u.id);
    const misP = permsByUser.get(u.id) || new Set();
    const misC = clidsByUser.get(u.id) || [];
    const esPartner = u.role === "partner";
    const esAdmin   = u.role === "admin";
    const soyYo     = u.id === STATE.userId;
    const acceso    = _hace(u.lastSignInAt);
    const pidiendoBorrar = AU_UI.confirmDelete === u.id;
    const inicial = String(u.email || "?").trim().charAt(0).toUpperCase();

    const permChips = esAdmin
      ? `<span class="au6-muted">${_e(t("au.adminTienePermisos"))}</span>`
      : AU_PERMISOS_LIST().map(([key, label]) => {
          const on = misP.has(key);
          return `<label class="au6-perm${on ? " au6-perm--on" : ""}">
            <input type="checkbox" data-act-change="auTogglePerm" data-uid="${uid}" data-perm="${_e(key)}" ${on ? "checked" : ""}/>
            <span>${_e(label)}</span></label>`;
        }).join("");

    const clidBlock = esPartner ? `
      <div class="au6-field">
        <div class="au6-field__label">${_e(t("au.clidsAsignados"))}</div>
        ${misC.length
          ? `<div class="ui-chips">${misC.map(m => `
              <span class="ui-chip"><span class="ui-chip__val">${_e(m.clid)}${STATE.CLID_MAP[m.clid] ? ` · ${_e(STATE.CLID_MAP[m.clid])}` : ""}</span>
                <button type="button" class="ui-chip__remove" data-act="auRemoveClid" data-mid="${_e(m.id)}"
                  aria-label="${_e(t("au.quitar"))} ${_e(m.clid)}" title="${_e(t("au.quitar"))}">${icon("x", { size: 12 })}</button></span>`).join("")}</div>`
          : alertBox({ tone: "warn", text: t("au6.sinClids") })}
        <div class="au6-clid-add">
          <input class="ui-input ui-input--sm" id="auClid_${uid}" placeholder="CLID" aria-label="${_e(t("au6.clidNuevo"))}"/>
          ${btn({ label: t("au.asignar"), size: "sm", act: "auAddClid", data: { uid: u.id } })}
        </div>
      </div>` : "";

    const kamV = _kamVinculado(u);
    let kamBlock = "";
    if (!esPartner && _kamEditable(u)) {
      // Selector: "(ninguno)" + la lista canónica. Un valor guardado que ya no
      // está en la lista (KAM renombrado o dado de baja) se conserva como opción
      // marcada, para que se vea y no se pierda en silencio al re-guardar.
      const lista = _auKamsLista();
      const actual = u.kam || "";
      const fuera = actual && !lista.includes(actual);
      const opts = [`<option value=""${actual ? "" : " selected"}>${_e(t("au7.kamNinguno"))}</option>`]
        .concat(fuera ? [`<option value="${_e(actual)}" selected>${_e(t("au7.kamFueraLista", { k: actual }))}</option>`] : [])
        .concat(lista.map(k => `<option value="${_e(k)}"${k === actual ? " selected" : ""}>${_e(k)}</option>`));
      kamBlock = `
      <div class="au6-field">
        <label class="au6-field__label" for="auKam_${uid}">${_e(t("au6.kamVinculado"))}</label>
        <select class="ui-select ui-select--sm" id="auKam_${uid}" data-act-change="auSetKam" data-uid="${uid}">${opts.join("")}</select>
        <span class="ui-field__hint">${_e(t("au7.kamReloginHint"))}</span>
      </div>`;
    } else if (u.role === "kam" || esAdmin) {
      kamBlock = `
      <div class="au6-field">
        <div class="au6-field__label">${_e(t("au6.kamVinculado"))} <span class="au6-muted">${_e(t("au6.soloLectura"))}</span></div>
        <div>${kamV ? badge(kamV, "neutral", { icon: "user" }) : `<span class="au6-muted" title="${_e(t("au6.kamNoDisponibleTip"))}">${_e(t("au6.kamNoDisponible"))}</span>`}</div>
      </div>`;
    }

    // Confirmación EN LÍNEA: un borrado irreversible merece ver a quién se está
    // borrando mientras se confirma.
    const zonaPeligro = pidiendoBorrar ? `
      <div class="au6-danger" role="alert">
        <div>${t("au.eliminarPermanente", { e: _e(u.email || "") })}</div>
        <div class="au6-danger__actions">
          ${btn({ label: t("cfg.cancelar"), size: "sm", variant: "ghost", act: "auCancelDelete" })}
          ${btn({ label: t("au.siEliminar"), size: "sm", variant: "danger", icon: "trash", act: "auDelete", data: { uid: u.id } })}
        </div>
      </div>` : "";

    html += `
      <article class="ui-card au6-card${pidiendoBorrar ? " au6-card--danger" : ""}">
        <div class="au6-card__head">
          <div class="au6-avatar" aria-hidden="true">${_e(inicial)}</div>
          <div class="au6-ident">
            <div class="au6-email">${_e(u.email || "—")}${soyYo ? ` ${badge(t("au.vos"), "info")}` : ""}</div>
            <div class="au6-meta">
              <span class="au6-dot au6-dot--${acceso.tono}" aria-hidden="true"></span><span>${_e(acceso.txt)}</span>
              ${_fechaCorta(u.createdAt) ? `<span>· ${_e(t("au.alta", { f: _fechaCorta(u.createdAt) }))}</span>` : ""}
            </div>
          </div>
          <div class="au6-actions">
            ${btn({ label: t("au.cerrarSesionesTip"), iconOnly: true, icon: "log-out", size: "sm", variant: "ghost", act: "auForceSignOut", data: { uid: u.id } })}
            ${btn({ label: soyYo ? t("au.noPodesEliminarte") : t("au.eliminarUsuario"), iconOnly: true, icon: "trash", size: "sm", variant: "ghost",
                    act: "auAskDelete", data: { uid: u.id }, disabled: soyYo })}
          </div>
        </div>

        <div class="au6-field">
          <div class="au6-field__label">${_e(t("au.rolLabel"))} <span class="au6-muted">${_e(_roleMeta(u.role).desc)}</span></div>
          ${segmented({ ariaLabel: t("au6.rolDe", { e: u.email || "" }), act: "auSetRoleBtn", value: u.role, data: { uid: u.id },
            options: AU_ROLES.map(r => ({ value: r, label: _roleMeta(r).label })) })}
        </div>

        ${kamBlock}

        <div class="au6-field">
          <div class="au6-field__label">${_e(t("au.permisosExtra"))}</div>
          <div class="au6-perms">${permChips}</div>
        </div>

        ${clidBlock}
        ${zonaPeligro}
      </article>`;
  });
  html += `</div>`;
  return html;
}

function _auFooterHTML() {
  return `<p class="au6-muted au6-footnote">${t("au.footerHint")}</p>
    <details class="au6-howto">
      <summary>${_e(t("au6.comoVincularKam"))}</summary>
      <p>${_e(t("au6.comoVincularKamTxt"))}</p>
      <pre class="au6-sql"><code>UPDATE auth.users
   SET raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb)
                         || jsonb_build_object('kam','Ana')
 WHERE email = '...@...';</code></pre>
    </details>`;
}

registerActions({
  auLoad:   () => auLoadUsers(),
  auSearch:    (d, el) => { AU_UI.q = el.value; _auRepintarLista(); },
  auFilterRol: d => { AU_UI.rol = d.value || d.rol; renderAdminUsers(); },
  auSetRoleBtn:  d => { const u = ADMIN_USERS_STATE.users.find(x => x.id === d.uid); const r = d.value || d.rol; if (u && u.role !== r) auSetRole(d.uid, r); },
  auAskDelete:   d => { AU_UI.confirmDelete = d.uid; renderAdminUsers(); },
  auCancelDelete:() => { AU_UI.confirmDelete = null; renderAdminUsers(); },
  auDelete:      d => auDeleteUser(d.uid),
  auInvite: () => auInvite(),
  auSetRole:      (d, el) => auSetRole(d.uid, el.value),
  auSetKam:       (d, el) => auSetKam(d.uid, el.value),
  auTogglePerm:   (d, el) => auTogglePerm(d.uid, d.perm, el.checked),
  auAddClid:      d => auAddClid(d.uid),
  auRemoveClid:   d => auRemoveClid(d.mid),
  auForceSignOut: d => auForceSignOut(d.uid)
});
