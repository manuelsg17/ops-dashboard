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
import { t } from "./core/i18n";
import { sb } from "./auth.js";
import { escapeHTML } from "./core/security";
import { fmt } from "./core/format";
import { btn, badge, alertBox, emptyState, icon, kpiCard } from "./shared/ui";

export const MON_STATE = {
  users: null,        // null = todavía no se pidió
  audit: null,
  uso: null,
  ingestas: null,
  loading: false,
  error: "",
  errores: {},        // por fuente: cuentas | audit | uso | ingestas → mensaje
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
  if (!iso) return { txt: t("mon.nunca"), dias: Infinity };
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return { txt: "—", dias: Infinity };
  const dias = Math.floor(ms / 86400000);
  if (dias <= 0) {
    const hs = Math.floor(ms / 3600000);
    return { txt: hs <= 0 ? t("mon.haceMinutos") : t("mon.haceHoras", { n: hs }), dias: 0 };
  }
  if (dias === 1) return { txt: t("mon.ayer"), dias };
  if (dias < 30)  return { txt: t("mon.haceDias", { n: dias }), dias };
  const meses = Math.floor(dias / 30);
  return { txt: meses === 1 ? t("mon.haceMes", { n: meses }) : t("mon.haceMeses", { n: meses }), dias };
}

// Tono semántico por antigüedad (Ola 6: sin hex en la vista).
function _staleTone(dias) {
  if (dias === Infinity) return "neutral";
  if (dias <= 7)  return "ok";
  if (dias <= 30) return "warn";
  return "bad";
}

const _e = s => escapeHTML(s == null ? "" : String(s));
const _msg = err => (err && (err.message || err.details)) || String(err || t("mon.motivoDesconocido"));

// ── CARGA ────────────────────────────────────────────────────────────────────
// Ola 6: cada fuente guarda SU error. Antes un fallo de audit_log/access_log/
// ingest_log se convertía en [] y la pantalla decía "sin movimientos" o "sin
// eventos": un fallo se leía como "no pasó nada".
export async function monLoad() {
  MON_STATE.loading = true; MON_STATE.error = "";
  MON_STATE.errores = {};
  renderMonitoreo();
  try {
    // Las fuentes son independientes: si una falla las otras igual se muestran.
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
      MON_STATE.errores.cuentas = detalle || (err && err.message) || t("mon.motivoDesconocido");
    }
    MON_STATE.audit = aRes.status === "fulfilled" ? aRes.value : [];
    if (aRes.status === "rejected") MON_STATE.errores.audit = _msg(aRes.reason);
    MON_STATE.uso = sRes.status === "fulfilled" ? sRes.value : [];
    if (sRes.status === "rejected") MON_STATE.errores.uso = _msg(sRes.reason);
    MON_STATE.ingestas = iRes.status === "fulfilled" ? iRes.value : [];
    if (iRes.status === "rejected") MON_STATE.errores.ingestas = _msg(iRes.reason);
  } catch (err) {
    MON_STATE.error = _msg(err);
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

export async function monSetAuditTable(tabla) {
  MON_STATE.auditTable = tabla;
  MON_STATE.errores = MON_STATE.errores || {};
  try { MON_STATE.audit = await _loadAudit(); delete MON_STATE.errores.audit; }
  catch (err) { MON_STATE.audit = []; MON_STATE.errores.audit = _msg(err); }
  renderMonitoreo();
}

// ── RENDER ───────────────────────────────────────────────────────────────────
function _secHead(titulo, sub, extra = "") {
  return `<div class="mon6-head"><div><h3 class="mon6-head__title">${_e(titulo)}</h3>${sub ? `<p class="mon6-head__sub">${_e(sub)}</p>` : ""}</div>${extra}</div>`;
}
const _errBox = (titulo, detalle) => alertBox({ tone: "bad", title: titulo, text: detalle });
const _num = n => (n == null ? "—" : fmt(n));

export function renderMonitoreo() {
  const box = document.getElementById("monitoreoBox");
  if (!box) return;

  if (MON_STATE.users == null && !MON_STATE.loading) {
    box.innerHTML = emptyState({
      icon: "activity", title: t("mon6.vacioTitulo"), text: t("mon.cargarHint"),
      action: btn({ label: t("mon6.cargar"), variant: "primary", icon: "download", act: "monLoad" })
    });
    return;
  }
  if (MON_STATE.loading) {
    box.innerHTML = `<div class="mon6-loading" role="status">${icon("refresh", { size: 16 })}<span>${_e(t("mon.cargando"))}</span></div>`;
    return;
  }

  let html = `<div class="mon6-top">${btn({ label: t("mon6.actualizar"), icon: "refresh", size: "sm", act: "monLoad" })}</div>`;
  if (MON_STATE.error) html += _errBox(t("mon6.errGeneral"), MON_STATE.error);
  html += _renderAccesos();
  html += _renderAuditoria();
  html += _renderIngestas();
  html += _renderUso();
  box.innerHTML = html;
}

function _renderAccesos() {
  const users = MON_STATE.users || [];
  const err = (MON_STATE.errores || {}).cuentas;
  const head = _secHead(t("mon.accesosTitulo"), t("mon.accesosSub"));
  if (err) return `<section class="mon6-sec">${head}${_errBox(t("mon.errCargarCuentas").replace(/:\s*$/, ""), err)}</section>`;
  if (!users.length) return `<section class="mon6-sec">${head}${emptyState({ icon: "users", title: t("mon6.sinCuentas") })}</section>`;

  const conFecha = users.map(u => ({ ...u, _h: _hace(u.lastSignInAt) }));
  const partners = conFecha.filter(u => u.role === "partner");
  const internos = conFecha.filter(u => u.role !== "partner");
  const activos7 = conFecha.filter(u => u._h.dias <= 7).length;
  const nunca    = conFecha.filter(u => u._h.dias === Infinity).length;

  const tabla = (titulo, list) => {
    if (!list.length) return "";
    const rows = list.slice().sort((a, b) => a._h.dias - b._h.dias).map(u => `<tr>
        <td>${_e(u.email || "—")}</td>
        <td>${badge(u.role || "viewer", "neutral")}</td>
        <td>${badge(u._h.txt, _staleTone(u._h.dias))}</td>
        <td class="mon6-muted">${_e(_fmtWhen(u.lastSignInAt))}</td>
        <td class="mon6-muted">${_e(_fmtWhen(u.createdAt))}</td>
      </tr>`).join("");
    return `<h4 class="mon6-sub">${_e(titulo)} <span class="mon6-muted">(${list.length})</span></h4>
      <div class="ui-table-wrap"><table class="ui-table">
        <thead><tr><th scope="col">${_e(t("mon.col.cuenta"))}</th><th scope="col">${_e(t("mon.col.rol"))}</th><th scope="col">${_e(t("mon.col.ultimoAcceso"))}</th><th scope="col">${_e(t("mon.col.fechaExacta"))}</th><th scope="col">${_e(t("mon.col.creada"))}</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
  };

  return `<section class="mon6-sec">${head}
    <div class="ui-kpi-grid mon6-kpis">
      ${kpiCard({ label: t("mon6.kpiCuentas"), value: users.length, sub: t("mon.kpiCuentasTip") })}
      ${kpiCard({ label: t("mon6.kpiActivas7"), value: activos7, sub: t("mon.kpiActivas7Tip") })}
      ${kpiCard({ label: t("mon6.kpiPartners"), value: partners.length, sub: t("mon.kpiPartnersTip") })}
      ${kpiCard({ label: t("mon6.kpiNunca"), value: nunca, sub: t("mon.kpiNuncaEntraronTip") })}
    </div>
    ${tabla(t("mon6.tablaPartners"), partners)}
    ${tabla(t("mon6.tablaEquipo"), internos)}
  </section>`;
}

const _TONO_ACCION = { INSERT: "ok", UPDATE: "warn", DELETE: "bad" };

function _renderAuditoria() {
  const rows = MON_STATE.audit || [];
  const err = (MON_STATE.errores || {}).audit;
  // `tabla` (no `t`) como parámetro: `t` es el de i18n.
  const sel = `<label class="mon6-filter"><span class="ui-sr-only">${_e(t("mon.col.tabla"))}</span>
    <select class="ui-select ui-select--sm" data-act-change="monSetAuditTable">
      <option value="all"${MON_STATE.auditTable === "all" ? " selected" : ""}>${_e(t("mon.todasTablas"))}</option>
      ${AUDIT_TABLES.map(tabla => `<option value="${tabla}"${MON_STATE.auditTable === tabla ? " selected" : ""}>${tabla}</option>`).join("")}
    </select></label>`;
  const head = _secHead(t("mon.auditTitulo"), t("mon.auditSub", { n: MON_STATE.auditLimit }), sel);
  if (err) return `<section class="mon6-sec">${head}${_errBox(t("mon6.errAudit"), err)}</section>`;
  if (!rows.length) return `<section class="mon6-sec">${head}${emptyState({ icon: "file-text", title: t("mon.sinMovimientos") })}</section>`;
  const body = rows.map(r => `<tr>
      <td class="mon6-muted">${_e(_fmtWhen(r.at))}</td>
      <td>${_e(r.user_email || "—")}</td>
      <td>${badge(r.action || "", _TONO_ACCION[r.action] || "neutral")}</td>
      <td>${_e(r.table_name || "")}</td>
      <td class="mon6-muted mon6-mono">${_e(r.row_key || "")}</td>
    </tr>`).join("");
  return `<section class="mon6-sec">${head}
    <div class="ui-table-wrap ui-table-wrap--scroll"><table class="ui-table">
      <thead><tr><th scope="col">${_e(t("mon.col.cuando"))}</th><th scope="col">${_e(t("mon.col.quien"))}</th><th scope="col">${_e(t("mon.col.accion"))}</th><th scope="col">${_e(t("mon.col.tabla"))}</th><th scope="col">${_e(t("mon.col.registro"))}</th></tr></thead>
      <tbody>${body}</tbody></table></div>
  </section>`;
}

// ── INGESTA AUTOMATICA DE TAXIPARKS ─────────────────────────────────────────
// ¿Se actualizó la data? ¿qué escala? ¿entraron los KPIs? ¿hubo errores?
const _TONO_INGESTA = { ok: "ok", rechazado: "warn" };
function _renderIngestas() {
  const items = MON_STATE.ingestas;
  if (items == null) return "";
  const err = (MON_STATE.errores || {}).ingestas;
  const head = _secHead(t("mon.ingestaTitulo"), t("mon.ultimaCarga"));
  if (err) return `<section class="mon6-sec">${head}${_errBox(t("mon6.errIngestas"), err)}</section>`;
  if (!items.length) return `<section class="mon6-sec">${head}${emptyState({ icon: "database", title: t("mon6.sinIngestasTitulo"), text: t("mon6.sinIngestasTxt") })}</section>`;

  // Estado por escala: cuándo entró por última vez cada una — la pregunta
  // operativa real ("¿la semanal está al día?").
  const porEscala = ["semanal", "mensual", "diario"].map(esc => {
    const ult = items.find(i => i.scale === esc && i.status === "ok");
    return { esc, ult, h: _hace(ult && ult.at) };
  });
  const tarjeta = ({ esc, ult, h }) => kpiCard({
    label: t(`mode.${esc}`), value: h.txt,
    sub: ult ? t("mon.filasPeriodos", { f: fmt(ult.filas_escritas || 0), p: (ult.periodos || []).length }) : t("mon.sinIngestas")
  });

  const filas = items.map(i => {
    const falt = (i.kpis_faltantes || []).length;
    const kpiTxt = i.kpis_ok == null ? "—"
      : `${_e(i.kpis_ok)}${falt ? ` <span title="${_e(t("mon.faltaron", { l: (i.kpis_faltantes || []).slice(0, 12).join(", ") }))}">${badge("−" + falt, "warn")}</span>` : ""}`;
    const per = i.periodos || [];
    const perTxt = !per.length ? "—" : per.length <= 2 ? per.join(", ") : `${per[0]} … ${per[per.length - 1]} (${per.length})`;
    return `<tr>
      <td class="mon6-muted">${_e(_fmtWhen(i.at))}</td>
      <td>${badge(i.status || "", _TONO_INGESTA[i.status] || "bad")}</td>
      <td>${_e(i.scale || "")} <span class="mon6-muted">${_e(i.formato || "")}</span></td>
      <td class="ui-num">${_num(i.filas_escritas)}</td>
      <td class="ui-num">${kpiTxt}</td>
      <td class="mon6-muted">${_e(perTxt)}</td>
      <td class="${i.error ? "mon6-err" : "mon6-muted"}">${_e(i.error || "")}</td>
    </tr>`;
  }).join("");

  // Un KPI faltante NO es un error: entra como 0 y el gráfico se ve plano sin
  // que nadie se entere. Por eso se avisa arriba y no solo en la fila.
  const ultOk = items.find(i => i.status === "ok");
  const faltan = ultOk ? (ultOk.kpis_faltantes || []) : [];
  const alerta = faltan.length
    ? alertBox({ tone: "warn", title: t("mon6.kpisFaltantes", { n: faltan.length, t: faltan.length + (ultOk.kpis_ok || 0) }),
        text: faltan.slice(0, 15).join(", ") })
    : "";

  return `<section class="mon6-sec">${head}${alerta}
    <div class="ui-kpi-grid mon6-kpis">${porEscala.map(tarjeta).join("")}</div>
    <div class="ui-table-wrap"><table class="ui-table">
      <thead><tr><th scope="col">${_e(t("mon.col.cuando"))}</th><th scope="col">${_e(t("raw.col.estado"))}</th><th scope="col">${_e(t("sidebar.escala"))}</th><th scope="col" class="ui-num">${_e(t("mon.col.filas"))}</th>
        <th scope="col" class="ui-num" title="${_e(t("mon.col.kpisTip"))}">${_e(t("mon.col.kpis"))}</th><th scope="col">${_e(t("mon.col.periodos"))}</th><th scope="col">${_e(t("mon.col.detalle"))}</th></tr></thead>
      <tbody>${filas}</tbody></table></div>
  </section>`;
}

// USO: qué se abre y qué se descarga. Separado de "Accesos" (auth.users) y de
// "Registro de cambios" (triggers): tres fuentes con confianza distinta.
function _renderUso() {
  const evs = MON_STATE.uso;
  if (evs == null) return "";
  const err = (MON_STATE.errores || {}).uso;
  const head = _secHead(t("mon.usoTitulo"), t("mon.ultimos30dSub"));
  if (err) return `<section class="mon6-sec">${head}${_errBox(t("mon6.errUso"), err)}</section>`;
  if (!evs.length) return `<section class="mon6-sec">${head}${emptyState({ icon: "activity", title: t("mon6.sinEventosTitulo"), text: t("mon6.sinEventosTxt") })}</section>`;

  const logins    = evs.filter(ev => ev.event === "login").length;
  const descargas = evs.filter(ev => ev.event === "download_pdf" || ev.event === "download_csv").length;
  const personas  = new Set(evs.map(ev => ev.user_email).filter(Boolean)).size;

  // Ranking de pestañas: PRIMERAS visitas por sesión (ver accessLog.js).
  const porTab = {};
  evs.filter(ev => ev.event === "tab").forEach(ev => { porTab[ev.detail || "?"] = (porTab[ev.detail || "?"] || 0) + 1; });
  const tabs = Object.entries(porTab).sort((a, b) => b[1] - a[1]);
  const porDesc = {};
  evs.filter(ev => ev.event.startsWith("download")).forEach(ev => {
    const k = (ev.detail || "?").split(":")[0];
    porDesc[k] = (porDesc[k] || 0) + 1;
  });
  const descs = Object.entries(porDesc).sort((a, b) => b[1] - a[1]);

  // Cada lista escala contra SU propio máximo (I12). El ancho es dato → inline.
  const barras = list => {
    if (!list.length) return `<p class="mon6-muted">${_e(t("mon.sinDatos"))}</p>`;
    const max = Math.max(1, list[0][1]);
    return list.map(([k, n]) => `
      <div class="mon6-bar">
        <div class="mon6-bar__row"><span>${_e(k)}</span><strong>${fmt(n)}</strong></div>
        <div class="ui-progress"><div class="ui-progress__bar" style="width:${Math.min(n / max * 100, 100).toFixed(1)}%"></div></div>
      </div>`).join("");
  };

  return `<section class="mon6-sec">${head}
    <div class="ui-kpi-grid mon6-kpis">
      ${kpiCard({ label: t("mon6.kpiIngresos"), value: logins, sub: t("mon.kpiIngresosTip") })}
      ${kpiCard({ label: t("mon6.kpiPersonas"), value: personas, sub: t("mon.kpiPersonasTip") })}
      ${kpiCard({ label: t("mon6.kpiDescargas"), value: descargas, sub: t("mon.kpiDescargasTip") })}
    </div>
    <div class="mon6-cols">
      <div><h4 class="mon6-sub" title="${_e(t("mon.seccionesTip"))}">${_e(t("mon.seccionesMasAbiertas"))}</h4>${barras(tabs)}</div>
      <div><h4 class="mon6-sub">${_e(t("mon.queDescarga"))}</h4>${barras(descs)}</div>
    </div>
  </section>`;
}

registerActions({
  monLoad,
  monSetAuditTable: (d, el) => monSetAuditTable(el.value)
});
