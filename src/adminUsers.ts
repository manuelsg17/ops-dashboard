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
  if (!confirm(t("au.confirmCambiarRol", { e: u?.email || userId, r: role }))) {
    renderAdminUsers();   // revertir el <select> a su valor real
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
  if (!confirm(t("au.confirmCerrarSesiones", { e: u?.email || userId }))) return;
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

function _roleMeta(r) {
  const M = {
    admin:   { emoji: "🛡️", label: t("au.rol.adminLabel"),   color: "#dc2626", bg: "#fef2f2", desc: t("au.rol.adminDesc") },
    kam:     { emoji: "👤", label: t("au.rol.kamLabel"),     color: "#0891b2", bg: "#ecfeff", desc: t("au.rol.kamDesc") },
    viewer:  { emoji: "👁️", label: t("au.rol.viewerLabel"),  color: "#6b7280", bg: "#f9fafb", desc: t("au.rol.viewerDesc") },
    partner: { emoji: "🤝", label: t("au.rol.partnerLabel"), color: "#7e22ce", bg: "#faf5ff", desc: t("au.rol.partnerDesc") }
  };
  return M[r] || M.viewer;
}

// "es-PE" fijo A PROPOSITO, igual que el timestamp de "Datos cargados" en
// data.ts: son fechas de negocio (Peru), no texto de interfaz — no siguen el
// idioma de la UI. Con la interfaz en ruso esto muestra "11 ago. 2026", no
// "11 авг. 2026". Detectado probando esta pantalla en ruso; se documenta en vez
// de traducirlo para no introducir ambiguedad de formato de fecha (DD/MM vs
// MM/DD) en una fecha que el equipo lee como referencia local de Peru.
function _fechaCorta(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(+d)) return null;
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}
// Antigüedad del último acceso: el dato accionable de un panel de usuarios es
// "hace cuánto", no la fecha exacta.
function _hace(iso) {
  if (!iso) return { txt: t("au.nuncaIngreso"), color: "#9ca3af", frio: true };
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (isNaN(dias)) return { txt: "—", color: "#9ca3af", frio: true };
  if (dias <= 0)  return { txt: t("au.hoy"),  color: "#10b981" };
  if (dias === 1) return { txt: t("au.ayer"), color: "#10b981" };
  if (dias < 7)   return { txt: t("au.haceDias", { n: dias }), color: "#10b981" };
  if (dias < 30)  return { txt: t("au.haceDias", { n: dias }), color: "#f59e0b" };
  const m = Math.floor(dias / 30);
  return { txt: m === 1 ? t("au.haceMes", { n: m }) : t("au.haceMeses", { n: m }), color: "#ef4444" };
}

export function renderAdminUsers() {
  const box = document.getElementById("adminUsersBox");
  if (!box) return;
  if (!STATE.isAdmin) { box.innerHTML = ""; return; }

  const S = ADMIN_USERS_STATE;

  if (!S.loaded && !S.loading && !S.error) {
    box.innerHTML = `
      <div class="au-empty">
        <div class="au-empty-ico">👥</div>
        <div class="au-empty-txt">${escapeHTML(t("au.consultanServidor"))}</div>
        <button class="au-btn au-btn-primary" data-act="auLoad">${escapeHTML(t("au.cargarUsuarios"))}</button>
      </div>`;
    return;
  }
  if (S.loading) {
    box.innerHTML = `<div class="au-empty"><div class="au-spinner"></div><div class="au-empty-txt">${escapeHTML(t("au.cargandoUsuarios"))}</div></div>`;
    return;
  }
  if (S.error) {
    box.innerHTML = `
      <div class="au-alert">
        <strong>${escapeHTML(t("au.noSePudoCargar"))}</strong>
        <div>${escapeHTML(S.error)}</div>
        <button class="au-btn" data-act="auLoad">${escapeHTML(t("au.reintentar"))}</button>
      </div>`;
    return;
  }

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

  // ── Filtros ─────────────────────────────────────────────────────────────
  const q = (AU_UI.q || "").toLowerCase().trim();
  const visibles = S.users.filter(u =>
    (AU_UI.rol === "todos" || u.role === AU_UI.rol) &&
    (!q || String(u.email || "").toLowerCase().includes(q))
  );
  const conteo = r => S.users.filter(u => u.role === r).length;

  let html = `
    <div class="au-toolbar">
      <input class="au-search" type="search" placeholder="${escapeHTML(t("au.buscarPorEmail"))}" value="${escapeHTML(AU_UI.q)}"
             data-act-input="auSearch" autocomplete="off"/>
      <div class="au-chips">
        <button class="au-chip${AU_UI.rol === "todos" ? " on" : ""}" data-act="auFilterRol" data-rol="todos">
          ${escapeHTML(t("au.todos"))} <b>${S.users.length}</b>
        </button>
        ${AU_ROLES.map(r => {
          const m = _roleMeta(r), n = conteo(r);
          return `<button class="au-chip${AU_UI.rol === r ? " on" : ""}" data-act="auFilterRol" data-rol="${r}"
                    style="${AU_UI.rol === r ? `border-color:${m.color};color:${m.color}` : ""}">
                    ${m.emoji} ${m.label} <b>${n}</b></button>`;
        }).join("")}
      </div>
      <button class="au-btn au-icon-btn" data-act="auLoad" title="${escapeHTML(t("au.refrescar"))}">↻</button>
    </div>

    <details class="au-invite">
      <summary><span class="au-invite-plus">＋</span> ${escapeHTML(t("au.invitarUsuario").replace("＋ ",""))}</summary>
      <div class="au-invite-body">
        <input class="au-input" id="auInviteEmail" type="email" placeholder="${escapeHTML(t("au.emailDominio"))}"/>
        <select class="au-input au-input-sm" id="auInviteRole">
          ${AU_ROLES.map(r => `<option value="${r}"${r === "viewer" ? " selected" : ""}>${_roleMeta(r).emoji} ${_roleMeta(r).label}</option>`).join("")}
        </select>
        <button class="au-btn au-btn-primary" data-act="auInvite">${escapeHTML(t("au.enviarInvitacion"))}</button>
        <p class="au-hint">${t("au.invitarHint")}</p>
      </div>
    </details>`;

  if (!visibles.length) {
    html += `<div class="au-empty"><div class="au-empty-txt">${escapeHTML(t("au.ningunoCoincide"))}</div></div>`;
    box.innerHTML = html + _auFooterHTML();
    return;
  }

  // ── Tarjeta por usuario ─────────────────────────────────────────────────
  html += `<div class="au-grid">`;
  visibles.forEach(u => {
    const uid  = escapeHTML(u.id);
    const misP = permsByUser.get(u.id) || new Set();
    const misC = clidsByUser.get(u.id) || [];
    const rm   = _roleMeta(u.role);
    const esPartner = u.role === "partner";
    const esAdmin   = u.role === "admin";
    const soyYo     = u.id === STATE.userId;
    const acceso    = _hace(u.lastSignInAt);
    const pidiendoBorrar = AU_UI.confirmDelete === u.id;

    const permChips = esAdmin
      ? `<span class="au-perm-implicit">${escapeHTML(t("au.adminTienePermisos"))}</span>`
      : AU_PERMISOS_LIST().map(([key, label]) => {
          const on = misP.has(key);
          return `<label class="au-perm${on ? " on" : ""}">
            <input type="checkbox" data-act-change="auTogglePerm" data-uid="${uid}" data-perm="${escapeHTML(key)}" ${on ? "checked" : ""}/>
            <span>${escapeHTML(label)}</span></label>`;
        }).join("");

    const clidBlock = esPartner ? `
      <div class="au-field">
        <div class="au-field-label">${escapeHTML(t("au.clidsAsignados"))}</div>
        ${misC.length
          ? `<div class="au-clids">${misC.map(m => `
              <span class="au-clid">
                <b>${escapeHTML(m.clid)}</b>
                ${STATE.CLID_MAP[m.clid] ? `<i>${escapeHTML(STATE.CLID_MAP[m.clid])}</i>` : ""}
                <button data-act="auRemoveClid" data-mid="${escapeHTML(m.id)}" title="${escapeHTML(t("au.quitar"))}">×</button>
              </span>`).join("")}</div>`
          : `<div class="au-warn">${escapeHTML(t("au.sinClidsWarn"))}</div>`}
        <div class="au-clid-add">
          <input class="au-input au-input-sm" id="auClid_${uid}" placeholder="CLID"/>
          <button class="au-btn" data-act="auAddClid" data-uid="${uid}">${escapeHTML(t("au.asignar"))}</button>
        </div>
      </div>` : "";

    // Confirmación EN LÍNEA en vez de confirm(): un borrado irreversible merece
    // ver a quién se está borrando mientras se confirma, no un diálogo del
    // navegador que tapa la pantalla y se acepta por reflejo.
    const zonaPeligro = pidiendoBorrar ? `
      <div class="au-danger">
        <div class="au-danger-txt">${t("au.eliminarPermanente", { e: escapeHTML(u.email || "") })}</div>
        <div class="au-danger-actions">
          <button class="au-btn" data-act="auCancelDelete">${escapeHTML(t("cfg.cancelar"))}</button>
          <button class="au-btn au-btn-danger" data-act="auDelete" data-uid="${uid}">${escapeHTML(t("au.siEliminar"))}</button>
        </div>
      </div>` : "";

    html += `
      <div class="au-card${pidiendoBorrar ? " au-card-danger" : ""}" style="--au-role:${rm.color}">
        <div class="au-card-head">
          <div class="au-avatar" style="background:${rm.bg};color:${rm.color}">${rm.emoji}</div>
          <div class="au-ident">
            <div class="au-email">${escapeHTML(u.email || "—")}${soyYo ? `<span class="au-you">${escapeHTML(t("au.vos"))}</span>` : ""}</div>
            <div class="au-meta">
              <span style="color:${acceso.color}">● ${escapeHTML(acceso.txt)}</span>
              ${_fechaCorta(u.createdAt) ? `<span>· ${escapeHTML(t("au.alta", { f: _fechaCorta(u.createdAt) }))}</span>` : ""}
            </div>
          </div>
          <div class="au-actions">
            <button class="au-btn au-icon-btn" data-act="auForceSignOut" data-uid="${uid}"
                    title="${escapeHTML(t("au.cerrarSesionesTip"))}">⎋</button>
            <button class="au-btn au-icon-btn au-icon-danger" data-act="auAskDelete" data-uid="${uid}"
                    title="${soyYo ? escapeHTML(t("au.noPodesEliminarte")) : escapeHTML(t("au.eliminarUsuario"))}"
                    ${soyYo ? "disabled" : ""}>🗑</button>
          </div>
        </div>

        <div class="au-field">
          <div class="au-field-label">${escapeHTML(t("au.rolLabel"))} <span class="au-field-hint">${escapeHTML(rm.desc)}</span></div>
          <div class="au-roles">
            ${AU_ROLES.map(r => {
              const m = _roleMeta(r), on = r === u.role;
              return `<button class="au-role${on ? " on" : ""}" data-act="auSetRoleBtn" data-uid="${uid}" data-rol="${r}"
                        style="${on ? `background:${m.bg};border-color:${m.color};color:${m.color}` : ""}">
                        ${m.emoji} ${m.label}</button>`;
            }).join("")}
          </div>
        </div>

        <div class="au-field">
          <div class="au-field-label">${escapeHTML(t("au.permisosExtra"))}</div>
          <div class="au-perms">${permChips}</div>
        </div>

        ${clidBlock}
        ${zonaPeligro}
      </div>`;
  });
  html += `</div>`;

  box.innerHTML = html + _auFooterHTML();
}

function _auFooterHTML() {
  return `<p class="au-hint au-footnote">${t("au.footerHint")}</p>`;
}

registerActions({
  auLoad:   () => auLoadUsers(),
  auSearch:    (d, el) => { AU_UI.q = el.value; renderAdminUsers(); },
  auFilterRol: d => { AU_UI.rol = d.rol; renderAdminUsers(); },
  auSetRoleBtn:  d => auSetRole(d.uid, d.rol),
  auAskDelete:   d => { AU_UI.confirmDelete = d.uid; renderAdminUsers(); },
  auCancelDelete:() => { AU_UI.confirmDelete = null; renderAdminUsers(); },
  auDelete:      d => auDeleteUser(d.uid),
  auInvite: () => auInvite(),
  auSetRole:      (d, el) => auSetRole(d.uid, el.value),
  auTogglePerm:   (d, el) => auTogglePerm(d.uid, d.perm, el.checked),
  auAddClid:      d => auAddClid(d.uid),
  auRemoveClid:   d => auRemoveClid(d.mid),
  auForceSignOut: d => auForceSignOut(d.uid)
});
