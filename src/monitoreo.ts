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
// - Uso (logins, pestañas abiertas, descargas): tabla `access_log`, que escribe
//   el propio navegador vía shared/accessLog.js. SELECT admin-only.
//
// ── DOS NIVELES DE CONFIANZA, NO MEZCLARLOS ─────────────────────────────────
//   audit_log  → lo escribe Postgres (trigger). Es EVIDENCIA: no se puede
//                fabricar ni borrar desde la API, ni siquiera siendo admin.
//   access_log → lo escribe el NAVEGADOR. Es TELEMETRÍA: sirve para saber si
//                los partners entran y qué usan. Alguien podría bloquear la
//                request o falsear un evento — nunca decidir seguridad con esto.
// La UI los muestra en secciones separadas justamente para que no se confundan.

import { registerActions } from "./shared/actions.js";
import { sb } from "./auth.js";

export const MON_STATE = {
  users: null,        // null = todavía no se pidió
  audit: null,
  uso: null,
  ingestas: null,
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
    const [uRes, aRes, sRes, iRes] = await Promise.allSettled([
      sb.functions.invoke("admin-users", { body: { action: "list" } }),
      _loadAudit(),
      _loadUso(),
      _loadIngestas()
    ]);
    if (uRes.status === "fulfilled" && !uRes.value.error && !uRes.value.data?.error) {
      MON_STATE.users = uRes.value.data?.users || [];
    } else {
      MON_STATE.users = [];
      // El motivo real viaja en el cuerpo de la respuesta, no en error.message
      // (que es siempre el genérico "non-2xx status code"). Ver adminUsers.js.
      const err = uRes.status === "fulfilled" ? uRes.value.error : uRes.reason;
      let detalle = uRes.status === "fulfilled" && uRes.value.data?.error;
      if (!detalle) {
        try { detalle = (await err?.context?.json?.())?.error; } catch (_) {}
      }
      MON_STATE.error = "No se pudo leer la lista de cuentas: " +
        (detalle || (err && err.message) || "motivo desconocido");
    }
    MON_STATE.audit = aRes.status === "fulfilled" ? aRes.value : [];
    MON_STATE.uso   = sRes.status === "fulfilled" ? sRes.value : [];
    MON_STATE.ingestas = iRes.status === "fulfilled" ? iRes.value : [];
  } catch (e) {
    MON_STATE.error = (e && e.message) || String(e);
  } finally {
    MON_STATE.loading = false;
    renderMonitoreo();
  }
}

// Últimos 30 días de uso. No se pagina: el panel responde "¿quién entra y qué
// usa?", no "listame todos los eventos" — para eso está el SQL editor.
async function _loadUso() {
  const desde = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data, error } = await sb.from("access_log")
    .select("at,user_email,event,detail")
    .gte("at", desde)
    .order("at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return data || [];
}

// Ultimas ingestas automaticas de taxiparks (Edge Function ingest-taxiparks).
async function _loadIngestas() {
  const { data, error } = await sb.from("ingest_log")
    .select("at,scale,tabla,status,formato,origen,filas_recibidas,filas_escritas,periodos,kpis_ok,kpis_faltantes,avisos,error,duracion_ms")
    .order("at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return data || [];
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
  html += _renderIngestas();
  html += _renderUso();
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

// Panel de USO: qué se abre y qué se descarga. Separado de "Accesos" (que sale
// de auth.users) y de "Registro de cambios" (que sale de triggers) porque son
// tres fuentes con niveles de confianza distintos — ver la cabecera del archivo.

// ── INGESTA AUTOMATICA DE TAXIPARKS ─────────────────────────────────────────
// Responde de un vistazo: se actualizo la data? que escala? entraron los 48
// KPIs? hubo errores? Sin esto habria que mirar las filas de rendimiento y
// adivinar si la corrida del martes funciono.
function _renderIngestas() {
  const items = MON_STATE.ingestas;
  if (items == null) return "";

  if (!items.length) {
    return secH("🔄", "#0891b2", "Ingesta automática de taxiparks", "Carga de la tarea \"Dashboard OPS\"", "") +
      `<div class="section"><div class="agy-style-224">
        Todavía no hubo ninguna ingesta automática. Mientras tanto la carga sigue
        siendo manual (Actualizar información → Rendimiento).
        Ver <code>supabase/functions/ingest-taxiparks/README.md</code> para conectarla.
      </div></div>`;
  }

  // Estado por escala: cuando entro por ultima vez cada una. Es la pregunta
  // operativa real — "¿la semanal esta al dia?"— y no se responde mirando una
  // lista cronologica mezclada.
  const porEscala = ["semanal", "mensual", "diario"].map(esc => {
    const ult = items.find(i => i.scale === esc && i.status === "ok");
    const h   = _hace(ult && ult.at);
    return { esc, ult, h };
  });

  const tarjeta = ({ esc, ult, h }) => {
    const col = !ult ? "#9ca3af" : _staleColor(h.dias);
    const nombre = esc.charAt(0).toUpperCase() + esc.slice(1);
    return `<div class="mcard" style="border-top:3px solid ${col}">
      <div class="mcard-label">${nombre}</div>
      <div class="mcard-val" style="color:${col};font-size:1.05rem">${escapeHTML(h.txt)}</div>
      <div class="agy-style-90" style="font-size:.68rem">
        ${ult ? `${fmt(ult.filas_escritas || 0)} filas · ${(ult.periodos || []).length} período(s)` : "sin ingestas"}
      </div>
    </div>`;
  };

  const filas = items.map(i => {
    const col = i.status === "ok" ? "#10b981" : i.status === "rechazado" ? "#f59e0b" : "#ef4444";
    const falt = (i.kpis_faltantes || []).length;
    const kpiTxt = i.kpis_ok == null ? "—"
      : `${i.kpis_ok}${falt ? ` <span style="color:#f59e0b" title="Faltaron: ${escapeHTML((i.kpis_faltantes || []).slice(0, 12).join(", "))}">(−${falt})</span>` : ""}`;
    const per = (i.periodos || []);
    const perTxt = !per.length ? "—"
      : per.length <= 2 ? per.join(", ")
      : `${per[0]} … ${per[per.length - 1]} (${per.length})`;
    return `<tr>
      <td class="agy-style-90">${_fmtWhen(i.at)}</td>
      <td><span style="font-size:.66rem;font-weight:700;color:#fff;background:${col};padding:2px 8px;border-radius:10px">${escapeHTML(i.status)}</span></td>
      <td>${escapeHTML(i.scale || "")}<span class="agy-style-90" style="font-size:.64rem;margin-left:4px">${escapeHTML(i.formato || "")}</span></td>
      <td class="tn">${i.filas_escritas == null ? "—" : fmt(i.filas_escritas)}</td>
      <td class="tn">${kpiTxt}</td>
      <td class="agy-style-90" style="font-size:.7rem">${escapeHTML(perTxt)}</td>
      <td class="agy-style-90" style="font-size:.7rem;color:${i.error ? "#b91c1c" : "#999"}">${escapeHTML(i.error || "")}</td>
    </tr>`;
  }).join("");

  // Un KPI faltante NO es un error: entra como 0 y el grafico se ve plano sin
  // que nadie se entere. Por eso se avisa arriba y no solo en la fila.
  const ultOk = items.find(i => i.status === "ok");
  const alerta = ultOk && (ultOk.kpis_faltantes || []).length
    ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;font-size:.76rem;color:#92400e;margin-bottom:12px">
         ⚠️ En la última ingesta faltaron <strong>${(ultOk.kpis_faltantes || []).length} de ${(ultOk.kpis_faltantes || []).length + (ultOk.kpis_ok || 0)}</strong> KPIs.
         Entran como 0 y las gráficas se ven planas sin avisar. Suele ser una measure renombrada en DataLens.
         <div style="margin-top:4px;font-family:monospace;font-size:.7rem">${escapeHTML((ultOk.kpis_faltantes || []).slice(0, 15).join(", "))}</div>
       </div>` : "";

  return secH("🔄", "#0891b2", "Ingesta automática de taxiparks",
      "Última carga por escala · KPIs recibidos · errores", "") +
    `<div class="section">
      ${alerta}
      <div class="metric-row">${porEscala.map(tarjeta).join("")}</div>
      <div class="tbl-wrap" style="margin-top:14px"><table class="dtbl">
        <thead><tr><th>Cuándo</th><th>Estado</th><th>Escala</th><th class="tn">Filas</th>
          <th class="tn" title="KPIs con datos (y cuántos faltaron)">KPIs</th><th>Períodos</th><th>Detalle</th></tr></thead>
        <tbody>${filas}</tbody></table></div>
    </div>`;
}

function _renderUso() {
  const evs = MON_STATE.uso;
  if (evs == null) return "";
  if (!evs.length) {
    return secH("📈", "#f59e0b", "Uso del dashboard", "Últimos 30 días", "") +
      `<div class="section"><div class="agy-style-224">
        Todavía no hay eventos registrados. Se empiezan a acumular a medida que
        el equipo y los partners usen el dashboard — los eventos anteriores a la
        activación del registro no existen.
      </div></div>`;
  }

  const logins    = evs.filter(e => e.event === "login").length;
  const descargas = evs.filter(e => e.event === "download_pdf" || e.event === "download_csv").length;
  const personas  = new Set(evs.map(e => e.user_email).filter(Boolean)).size;

  // Ranking de pestañas: cuenta de PRIMERAS visitas por sesión (ver accessLog.js),
  // así que se lee como "cuántas sesiones abrieron esta sección", no como clicks.
  const porTab = {};
  evs.filter(e => e.event === "tab").forEach(e => { porTab[e.detail || "?"] = (porTab[e.detail || "?"] || 0) + 1; });
  const tabs = Object.entries(porTab).sort((a, b) => b[1] - a[1]);
  const maxTab = tabs.length ? tabs[0][1] : 1;

  const porDesc = {};
  evs.filter(e => e.event.startsWith("download")).forEach(e => {
    const k = (e.detail || "?").split(":")[0];
    porDesc[k] = (porDesc[k] || 0) + 1;
  });
  const descs = Object.entries(porDesc).sort((a, b) => b[1] - a[1]);

  const kpi = (label, val, color, tip) => `
    <div class="mcard" style="border-top:3px solid ${color}" title="${escapeHTML(tip)}">
      <div class="mcard-label">${label}</div>
      <div class="mcard-val" style="color:${color}">${fmt(val)}</div>
    </div>`;

  const barras = (list, color) => list.length
    ? list.map(([k, n]) => `
        <div style="margin-bottom:7px">
          <div style="display:flex;justify-content:space-between;font-size:.74rem;margin-bottom:2px">
            <span>${escapeHTML(k)}</span><strong>${fmt(n)}</strong>
          </div>
          <div style="height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${(n / maxTab * 100).toFixed(1)}%;background:${color}"></div>
          </div>
        </div>`).join("")
    : `<div class="agy-style-90" style="font-size:.76rem">Sin datos</div>`;

  return secH("📈", "#f59e0b", "Uso del dashboard",
      "Últimos 30 días · lo registra el navegador, es telemetría de uso (no auditoría)", "") +
    `<div class="section">
      <div class="metric-row">
        ${kpi("🔓 Ingresos", logins, "#0ea5e9", "Eventos de login en los últimos 30 días")}
        ${kpi("🙋 Personas activas", personas, "#10b981", "Cuentas distintas con algún evento")}
        ${kpi("⬇️ Descargas", descargas, "#8b5cf6", "PDFs y CSVs exportados")}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;margin-top:14px">
        <div>
          <div style="font-weight:700;font-size:.78rem;margin-bottom:8px">Secciones más abiertas</div>
          <div title="Cuenta la PRIMERA visita de cada sesión a cada sección, no cada click">${barras(tabs, "#0ea5e9")}</div>
        </div>
        <div>
          <div style="font-weight:700;font-size:.78rem;margin-bottom:8px">Qué se descarga</div>
          ${barras(descs, "#8b5cf6")}
        </div>
      </div>
    </div>`;
}

registerActions({
  monLoad,
  monSetAuditTable: (d, el) => monSetAuditTable(el.value)
});
