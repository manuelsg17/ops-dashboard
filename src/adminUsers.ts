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

export const ADMIN_USERS_STATE = {
  users: [],        // [{id,email,role,lastSignInAt}]
  perms: [],        // filas de user_permissions
  mappings: [],     // filas de partner_users
  loaded: false,
  loading: false,
  error: null
};

// Permisos que se pueden otorgar (espejo de la taxonomía de la migración B2).
export const AU_PERMISOS = [
  ["write:performance", "Subir rendimiento"],
  ["write:metas",       "Editar metas"],
  ["write:config",      "Editar configuración"],
  ["write:seguimiento", "Editar seguimiento"],
  ["delete:data",       "Borrado masivo"],
  ["manage:users",      "Gestionar usuarios"]
];

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
    if (fn.error) throw new Error(await _edgeErrMsg(fn.error, "No se pudo listar usuarios (¿Edge Function desplegada?)."));
    if (fn.data && fn.data.error) throw new Error(String(fn.data.error));
    ADMIN_USERS_STATE.users    = fn.data?.users || [];
    ADMIN_USERS_STATE.perms    = permsRes.data  || [];
    ADMIN_USERS_STATE.mappings = mapRes.data    || [];
    ADMIN_USERS_STATE.loaded   = true;
  } catch (e) {
    ADMIN_USERS_STATE.error = e.message || "Error al cargar usuarios.";
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
  if (r.error) throw new Error(await _edgeErrMsg(r.error, "La operación fue rechazada."));
  // La función también puede responder 200 con {error} en algunos caminos.
  if (r.data && r.data.error) throw new Error(String(r.data.error));
  return r.data;
}

export async function auSetRole(userId, role) {
  const u = ADMIN_USERS_STATE.users.find(x => x.id === userId);
  if (!confirm(`¿Cambiar el rol de ${u?.email || userId} a "${role}"?\n\n` +
               `El rol viaja dentro del token de sesión: recién aplica cuando esa persona vuelve a iniciar sesión.`)) {
    renderAdminUsers();   // revertir el <select> a su valor real
    return;
  }
  showLoad(true, "Cambiando rol...");
  try {
    await _fn("setRole", { userId, role });
    await auLoadUsers();
    showBanner(true, `Rol actualizado a ${role} ✓ — debe volver a iniciar sesión para que aplique.`);
  } catch (e) {
    showBanner(false, e.message);
    renderAdminUsers();
  } finally { showLoad(false); }
}

export async function auInvite() {
  const email = (document.getElementById("auInviteEmail")?.value || "").trim();
  const role  = document.getElementById("auInviteRole")?.value || "viewer";
  if (!email) { showBanner(false, "Ingresá un email para invitar."); return; }
  showLoad(true, "Enviando invitación...");
  try {
    await _fn("invite", { email, role });
    const el = document.getElementById("auInviteEmail"); if (el) el.value = "";
    await auLoadUsers();
    showBanner(true, `Invitación enviada a ${email} (rol ${role}) ✓`);
  } catch (e) {
    showBanner(false, e.message);
  } finally { showLoad(false); }
}

export async function auForceSignOut(userId) {
  const u = ADMIN_USERS_STATE.users.find(x => x.id === userId);
  if (!confirm(`¿Cerrar todas las sesiones de ${u?.email || userId}?\n\nSe usa para que un cambio de rol aplique de inmediato.`)) return;
  showLoad(true, "Cerrando sesiones...");
  try {
    await _fn("signOut", { userId });
    showBanner(true, "Sesiones cerradas ✓");
  } catch (e) { showBanner(false, e.message); }
  finally { showLoad(false); }
}

export async function auTogglePerm(userId, permission, on) {
  showLoad(true, "Guardando permiso...");
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
    showBanner(true, `Permiso ${on ? "otorgado" : "revocado"} ✓`);
  } catch (e) {
    showBanner(false, "Error: " + (e.message || e));
    renderAdminUsers();
  } finally { showLoad(false); }
}

export async function auAddClid(userId) {
  const inp  = document.getElementById(`auClid_${userId}`);
  const clid = (inp?.value || "").trim();
  if (!clid) return;
  if (!STATE.CLID_MAP[clid]) {
    showBanner(false, `El CLID ${clid} no existe en Configuración → Partners.`);
    return;
  }
  showLoad(true, "Asignando CLID...");
  try {
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from("partner_users")
      .insert({ user_id: userId, clid, created_by: user?.id || null });
    if (error) throw error;
    if (inp) inp.value = "";
    await auLoadUsers();
    showBanner(true, `CLID ${clid} asignado ✓`);
  } catch (e) {
    showBanner(false, "Error: " + (e.message || e));
  } finally { showLoad(false); }
}

export async function auRemoveClid(mappingId) {
  showLoad(true, "Quitando CLID...");
  try {
    const { error } = await sb.from("partner_users").delete().eq("id", mappingId);
    if (error) throw error;
    await auLoadUsers();
    showBanner(true, "CLID desasignado ✓");
  } catch (e) { showBanner(false, "Error: " + (e.message || e)); }
  finally { showLoad(false); }
}

// ── RENDER ───────────────────────────────────────────────────────────────────
export function renderAdminUsers() {
  const box = document.getElementById("adminUsersBox");
  if (!box) return;
  if (!STATE.isAdmin) { box.innerHTML = ""; return; }

  const S = ADMIN_USERS_STATE;

  if (!S.loaded && !S.loading && !S.error) {
    box.innerHTML = `
      <div style="padding:12px 0">
        <button class="crud-btn crud-btn-add" data-act="auLoad">👥 Cargar usuarios</button>
        <span style="font-size:.72rem;color:#888;margin-left:8px">Se consulta al servidor solo cuando lo pedís.</span>
      </div>`;
    return;
  }
  if (S.loading) { box.innerHTML = `<div style="padding:14px;color:#888;font-size:.8rem">Cargando usuarios…</div>`; return; }
  if (S.error) {
    box.innerHTML = `
      <div style="padding:12px;background:#fff5f5;border:1px solid #fecaca;border-radius:6px;color:#991b1b;font-size:.78rem">
        ${escapeHTML(S.error)}
        <button class="crud-btn" data-act="auLoad" style="margin-left:10px">Reintentar</button>
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

  // ── Invitar ──
  let html = `
    <div class="section" style="margin-bottom:14px;background:#f0f9ff;border:1px solid #bae6fd">
      <div style="font-size:.78rem;font-weight:700;color:#075985;margin-bottom:8px">✉️ Invitar usuario</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input class="crud-input" id="auInviteEmail" type="email" placeholder="email@dominio.com" style="flex:1;min-width:200px;max-width:300px"/>
        <select class="crud-input" id="auInviteRole" style="width:auto">
          ${AU_ROLES.map(r => `<option value="${r}"${r === "viewer" ? " selected" : ""}>${r}</option>`).join("")}
        </select>
        <button class="crud-btn crud-btn-add" data-act="auInvite">Enviar invitación</button>
      </div>
      <div style="font-size:.7rem;color:#0369a1;margin-top:6px">
        Recibe un mail para fijar su contraseña. Para un <strong>partner</strong>, después asignale sus CLIDs abajo —
        sin CLIDs asignados no ve ningún dato (por diseño).
      </div>
    </div>`;

  // ── Tabla de usuarios ──
  html += `<div class="tbl-wrap"><table class="dtbl"><thead><tr>
      <th>Email</th><th style="width:110px">Rol</th><th>Permisos extra</th>
      <th>CLIDs (partner)</th><th style="width:90px">Sesión</th>
    </tr></thead><tbody>`;

  S.users.forEach(u => {
    const uid    = escapeHTML(u.id);
    const misP   = permsByUser.get(u.id) || new Set();
    const misC   = clidsByUser.get(u.id) || [];
    const esPartner = u.role === "partner";
    const esAdmin   = u.role === "admin";

    const permChips = AU_PERMISOS.map(([key, label]) => {
      const on = misP.has(key);
      // Un admin ya puede todo (can() devuelve true por is_admin): mostrar los
      // permisos como implícitos en vez de sugerir que hay que tildarlos.
      if (esAdmin) return `<span style="font-size:.62rem;color:#bbb;margin-right:5px" title="admin ya tiene todos los permisos">${escapeHTML(label)}</span>`;
      return `<label style="display:inline-flex;align-items:center;gap:3px;margin:0 7px 3px 0;font-size:.68rem;cursor:pointer">
          <input type="checkbox" data-act-change="auTogglePerm" data-uid="${uid}" data-perm="${escapeHTML(key)}" ${on ? "checked" : ""}/>
          <span style="${on ? "font-weight:700;color:#166534" : "color:#666"}">${escapeHTML(label)}</span>
        </label>`;
    }).join("");

    const clidChips = misC.map(m => `
      <span style="display:inline-flex;align-items:center;gap:3px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:1px 4px 1px 8px;font-size:.68rem;margin:0 4px 3px 0">
        ${escapeHTML(m.clid)}
        <span style="color:#8b5cf6;font-size:.6rem">${escapeHTML(STATE.CLID_MAP[m.clid] || "")}</span>
        <button data-act="auRemoveClid" data-mid="${escapeHTML(m.id)}" title="Quitar" style="border:none;background:none;color:#7c3aed;cursor:pointer;font-weight:700;padding:0 3px">×</button>
      </span>`).join("");

    const clidCell = esPartner
      ? `${clidChips || `<span style="font-size:.66rem;color:#b45309">⚠ sin CLIDs: no ve nada</span>`}
         <div style="display:flex;gap:4px;margin-top:4px">
           <input class="crud-input" id="auClid_${uid}" placeholder="CLID" style="width:120px;font-size:.68rem"/>
           <button class="crud-btn" data-act="auAddClid" data-uid="${uid}" style="font-size:.66rem">+ Asignar</button>
         </div>`
      : `<span style="color:#ddd;font-size:.7rem">— solo rol partner —</span>`;

    html += `<tr>
      <td style="font-size:.76rem">${escapeHTML(u.email || "")}
        <div style="font-size:.62rem;color:#aaa">${u.lastSignInAt ? "último ingreso " + escapeHTML(String(u.lastSignInAt).slice(0,10)) : "nunca ingresó"}</div>
      </td>
      <td>
        <select class="crud-input" data-act-change="auSetRole" data-uid="${uid}" style="width:100%;font-size:.72rem">
          ${AU_ROLES.map(r => `<option value="${r}"${r === u.role ? " selected" : ""}>${r}</option>`).join("")}
        </select>
      </td>
      <td>${permChips}</td>
      <td>${clidCell}</td>
      <td style="text-align:center">
        <button class="crud-btn" data-act="auForceSignOut" data-uid="${uid}" title="Cierra sus sesiones para que un cambio de rol aplique ya" style="font-size:.66rem">Cerrar</button>
      </td>
    </tr>`;
  });

  html += `</tbody></table></div>
    <div style="font-size:.7rem;color:#888;margin-top:8px">
      El rol viaja dentro del token de sesión: un cambio recién aplica cuando la persona vuelve a iniciar sesión
      (o si le cerrás la sesión con "Cerrar"). Los permisos extra y los CLIDs, en cambio, aplican al instante.
    </div>
    <div style="margin-top:8px"><button class="crud-btn" data-act="auLoad">↻ Refrescar</button></div>`;

  box.innerHTML = html;
}

registerActions({
  auLoad:   () => auLoadUsers(),
  auInvite: () => auInvite(),
  auSetRole:      (d, el) => auSetRole(d.uid, el.value),
  auTogglePerm:   (d, el) => auTogglePerm(d.uid, d.perm, el.checked),
  auAddClid:      d => auAddClid(d.uid),
  auRemoveClid:   d => auRemoveClid(d.mid),
  auForceSignOut: d => auForceSignOut(d.uid)
});
