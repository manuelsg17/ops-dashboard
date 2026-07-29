//@ts-nocheck
// monitoreo.js — Configuración → Monitoreo (admin-only).
//
// Responde dos preguntas operativas que hasta ahora no tenían pantalla:
//   1. ¿QUIÉN está usando el dashboard? — último acceso por cuenta, con foco en
//      las cuentas de partner (¿realmente entran, o les seguimos mandando PDFs?).
//   2. ¿QUIÉN cambió QUÉ? — el `audit_log`, que se viene escribiendo por trigger
//      desde julio 2026 pero no se podía leer desde ninguna parte de la app.
//
// ── DE DÓNDE SALEN LOS DATOS ────────────────────────────────────────────────
// - Accesos: `last_sign_in_at` de auth.users, vía la Edge Function admin-users
//   (acción "list"). auth.users NO es legible con la anon key, por eso pasa por
//   la función; ella ya valida rol admin del llamante antes de usar service_role.
// - Cambios: tabla `audit_log`, con SELECT admin-only por RLS. La tabla NO tiene
//   políticas de INSERT/UPDATE/DELETE a propósito (solo escribe el trigger), así
//   que es tamper-evident: ni un admin puede reescribir la historia vía API.
//
// ── LO QUE ESTA PANTALLA TODAVÍA NO PUEDE MOSTRAR ───────────────────────────
// Descargas de PDF/CSV y aperturas de pestaña NO se registran: hoy no existe una
// tabla donde escribirlas (audit_log no acepta escrituras del cliente, y está
// bien que así sea). La migración `migrations/2026-07-28_access_log.sql` crea
// `access_log` para eso; hasta que se aplique, el bloque correspondiente avisa
// que la métrica no está disponible en vez de mostrar un cero engañoso.

import { registerActions } from "./shared/actions.js";
import { sb } from "./auth.js";

export const MON_STATE = {
  users: null,        // null = todavía no se pidió
  audit: null,
  loading: false,
  error: "",
  auditTable: "all",
  auditLimit: 100
};

// Tablas que audita el trigger (migración 2026-07-xx_audit_log). Se listan acá
// para poder ofrecer el filtro sin tener que consultarlas primero.
const AUDIT_TABLES = [
  "partners", "flotas", "fleetrooms", "metas", "seguimiento",
  "conversion_pais", "user_permissions", "partner_users",
  "rendimiento", "rendimiento_mensual", "rendimiento_diario"
];

function _fmtWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(+d)) return "—";
  return d.toLocaleString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// "hace 3 días" — el dato accionable es la ANTIGÜEDAD, no la fecha exacta:
// "hace 45 días" salta a la vista, "12/06/2026" hay que calcularlo mentalmente.
function _hace(iso) {
  if (!iso) return { txt: "nunca", dias: Infinity };
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return { txt: "—", dias: Infinity };
  const dias = Math.floor(ms / 86400000);
  if (dias <= 0) {
    const hs = Math.floor(ms / 3600000);
    return { txt: hs <= 0 ? "hace minutos" : `hace ${hs} h`, dias: 0 };
  }
  if (dias === 1) return { txt: "ayer", dias };
  if (dias < 30)  return { txt: `hace ${dias} días`, dias };
  const meses = Math.floor(dias / 30);
  return { txt: `hace ${meses} ${meses === 1 ? "mes" : "meses"}`, dias };
}

function _staleColor(dias) {
  if (dias === Infinity) return "#9ca3af";
  if (dias <= 7)  return "#10b981";
  if (dias <= 30) return "#f59e0b";
  return "#ef4444";
}

// ── CARGA ────────────────────────────────────────────────────────────────────
export async function monLoad() {
  MON_STATE.loading = true; MON_STATE.error = "";
  renderMonitoreo();
  try {
    // Las dos fuentes son independientes: si el audit_log falla (o la migración
    // no está aplicada) igual queremos mostrar los accesos, y viceversa. Por eso
    // allSettled y no all.
    const [uRes, aRes] = await Promise.allSettled([
      sb.functions.invoke("admin-users", { body: { action: "list" } }),
      _loadAudit()
    ]);
    if (uRes.status === "fulfilled" && !uRes.value.error && !uRes.value.data?.error) {
      MON_STATE.users = uRes.value.data?.users || [];
    } else {
      MON_STATE.users = [];
      MON_STATE.error = "No se pudo leer la lista de cuentas (Edge Function admin-users).";
    }
    MON_STATE.audit = aRes.status === "fulfilled" ? aRes.value : [];
  } catch (e) {
    MON_STATE.error = (e && e.message) || String(e);
  } finally {
    MON_STATE.loading = false;
    renderMonitoreo();
  }
}

async function _loadAudit() {
  let q = sb.from("audit_log")
    .select("at,user_email,action,table_name,row_key")
    .order("at", { ascending: false })
    .limit(MON_STATE.auditLimit);
  if (MON_STATE.auditTable !== "all") q = q.eq("table_name", MON_STATE.auditTable);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function monSetAuditTable(t) {
  MON_STATE.auditTable = t;
  try { MON_STATE.audit = await _loadAudit(); } catch (e) { MON_STATE.audit = []; }
  renderMonitoreo();
}

// ── RENDER ───────────────────────────────────────────────────────────────────
export function renderMonitoreo() {
  const box = document.getElementById("monitoreoBox");
  if (!box) return;

  if (MON_STATE.users == null && !MON_STATE.loading) {
    box.innerHTML = `
      <button class="apply-btn" data-act="monLoad">📡 Cargar monitoreo</button>
      <span style="font-size:.75rem;color:#888;margin-left:10px">
        Lee los accesos de las cuentas y el registro de cambios. No se carga solo para no pegarle a la Edge Function en cada render.
      </span>`;
    return;
  }
  if (MON_STATE.loading) {
    box.innerHTML = `<div style="padding:24px 0;color:#888;font-size:.85rem">Cargando monitoreo…</div>`;
    return;
  }

  let html = `<button class="apply-btn" data-act="monLoad" style="margin-bottom:14px">🔄 Actualizar</button>`;
  if (MON_STATE.error) {
    html += `<div style="background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;padding:10px 12px;border-radius:8px;font-size:.78rem;margin-bottom:14px">${escapeHTML(MON_STATE.error)}</div>`;
  }

  html += _renderAccesos();
  html += _renderAuditoria();
  html += _renderPendiente();
  box.innerHTML = html;
}

function _renderAccesos() {
  const users = MON_STATE.users || [];
  if (!users.length) return "";

  const conFecha = users.map(u => ({ ...u, _h: _hace(u.lastSignInAt) }));
  const partners = conFecha.filter(u => u.role === "partner");
  const internos = conFecha.filter(u => u.role !== "partner");
  const activos7 = conFecha.filter(u => u._h.dias <= 7).length;
  const nunca    = conFecha.filter(u => u._h.dias === Infinity).length;

  const kpi = (label, val, color, tip) => `
    <div class="mcard" style="border-top:3px solid ${color}" title="${escapeHTML(tip)}">
      <div class="mcard-label">${label}</div>
      <div class="mcard-val" style="color:${color}">${fmt(val)}</div>
    </div>`;

  const tabla = (titulo, list) => {
    if (!list.length) return "";
    const rows = list
      .slice()
      .sort((a, b) => a._h.dias - b._h.dias)
      .map(u => `<tr>
        <td>${escapeHTML(u.email || "—")}</td>
        <td><span style="font-size:.68rem;font-weight:700;padding:2px 8px;border-radius:10px;background:#f3f4f6;color:#374151">${escapeHTML(u.role || "viewer")}</span></td>
        <td style="color:${_staleColor(u._h.dias)};font-weight:700">${escapeHTML(u._h.txt)}</td>
        <td class="agy-style-90">${_fmtWhen(u.lastSignInAt)}</td>
        <td class="agy-style-90">${_fmtWhen(u.createdAt)}</td>
      </tr>`).join("");
    return `<div style="font-weight:700;font-size:.78rem;margin:14px 0 6px">${titulo} (${list.length})</div>
      <div class="tbl-wrap"><table class="dtbl">
        <thead><tr><th>Cuenta</th><th>Rol</th><th>Último acceso</th><th>Fecha exacta</th><th>Creada</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
  };

  return secH("🔑", "#0ea5e9", "Accesos", "Quién entró y cuándo · el color marca la antigüedad del último acceso", "") +
    `<div class="section">
      <div class="metric-row">
        ${kpi("👥 Cuentas", users.length, "#6366f1", "Total de cuentas creadas")}
        ${kpi("✅ Activas (7 días)", activos7, "#10b981", "Entraron en los últimos 7 días")}
        ${kpi("🤝 Partners", partners.length, "#0891b2", "Cuentas con rol partner")}
        ${kpi("🚫 Nunca entraron", nunca, nunca ? "#ef4444" : "#9ca3af", "Invitadas pero sin ningún acceso — probablemente no recibieron o no abrieron la invitación")}
      </div>
      ${tabla("🤝 Partners", partners)}
      ${tabla("🏢 Equipo interno", internos)}
    </div>`;
}

function _renderAuditoria() {
  const rows = MON_STATE.audit || [];
  const sel = `<select class="sb-sel" style="max-width:240px" data-act-change="monSetAuditTable">
      <option value="all"${MON_STATE.auditTable === "all" ? " selected" : ""}>Todas las tablas</option>
      ${AUDIT_TABLES.map(t => `<option value="${t}"${MON_STATE.auditTable === t ? " selected" : ""}>${t}</option>`).join("")}
    </select>`;

  const body = rows.length
    ? rows.map(r => {
        const col = r.action === "DELETE" ? "#ef4444" : r.action === "INSERT" ? "#10b981" : "#f59e0b";
        return `<tr>
          <td class="agy-style-90">${_fmtWhen(r.at)}</td>
          <td>${escapeHTML(r.user_email || "—")}</td>
          <td><span style="font-size:.66rem;font-weight:700;color:#fff;background:${col};padding:2px 8px;border-radius:10px">${escapeHTML(r.action)}</span></td>
          <td>${escapeHTML(r.table_name || "")}</td>
          <td class="agy-style-90">${escapeHTML(r.row_key || "")}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="5" style="text-align:center;color:#888;padding:18px">Sin movimientos registrados para este filtro.</td></tr>`;

  return secH("🧾", "#8b5cf6", "Registro de cambios",
      `Últimos ${MON_STATE.auditLimit} movimientos · lo escriben triggers de Postgres, no el navegador: no se puede alterar desde la app`, "") +
    `<div class="section">
      <div style="margin-bottom:10px">${sel}</div>
      <div class="tbl-wrap"><table class="dtbl">
        <thead><tr><th>Cuándo</th><th>Quién</th><th>Acción</th><th>Tabla</th><th>Registro</th></tr></thead>
        <tbody>${body}</tbody></table></div>
    </div>`;
}

// Se dice explícitamente qué NO se está midiendo. Un panel de monitoreo que
// omite en silencio una dimensión es peor que no tenerla: da la impresión de
// cobertura completa.
function _renderPendiente() {
  return `<div class="section" style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 14px">
    <div style="font-weight:700;font-size:.8rem;color:#92400e;margin-bottom:4px">⏳ Todavía no se registra</div>
    <div style="font-size:.76rem;color:#78350f;line-height:1.5">
      Descargas de PDF/CSV y aperturas de pestaña no aparecen acá: no hay dónde escribirlas.
      El <code>audit_log</code> no acepta escrituras desde el navegador —a propósito, para que
      nadie pueda alterar la historia de cambios— así que hace falta una tabla aparte.
      La migración <code>migrations/2026-07-28_access_log.sql</code> la crea; aplicala desde
      el SQL editor de Supabase y esta sección empieza a mostrarlas.
    </div>
  </div>`;
}

registerActions({
  monLoad,
  monSetAuditTable: (d, el) => monSetAuditTable(el.value)
});
