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
    if (fn.error) throw new Error("No se pudo listar usuarios (¿Edge Function desplegada?).");
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
async function _fn(action, body) {
  const r = await sb.functions.invoke("admin-users", { body: { action, ...body } });
  if (r.error) throw new Error(r.error.message || "La operación fue rechazada.");
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

import { h, render } from 'preact';
import { AdminUsers } from './components/AdminUsers';

export function renderAdminUsers() {
  const box = document.getElementById("adminUsersBox");
  if (!box) return;
  if (!STATE.isAdmin) { box.innerHTML = ""; return; }

  render(
    h(AdminUsers, {
      stateObj: ADMIN_USERS_STATE,
      onLoad: auLoadUsers,
      onInvite: auInvite,
      onSetRole: auSetRole,
      onTogglePerm: auTogglePerm,
      onAddClid: (uid, clid) => {
        const inp = document.getElementById(`auClid_${uid}`);
        if (inp) inp.value = clid;
        auAddClid(uid);
      },
      onRemoveClid: auRemoveClid,
      onForceSignOut: auForceSignOut
    }),
    box
  );
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
