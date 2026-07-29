//@ts-nocheck
// shared/accessLog.js — Telemetría de USO del dashboard (tabla `access_log`).
//
// Responde "¿quién usa el dashboard y qué usa?": logins, qué pestañas se abren,
// qué se descarga, qué se sube. Lo consume Configuración → Monitoreo.
//
// ── QUÉ ES Y QUÉ NO ES ──────────────────────────────────────────────────────
// Esto lo escribe el NAVEGADOR, así que es TELEMETRÍA, no evidencia: un usuario
// podría bloquear la request o falsear un evento. Sirve para saber si los
// partners entran y qué secciones se usan; NUNCA para decidir nada de
// seguridad. La auditoría de verdad (quién cambió qué dato) vive en
// `audit_log`, que escriben triggers de Postgres y el cliente no puede tocar.
//
// ── REGLAS DE IMPLEMENTACIÓN ────────────────────────────────────────────────
// 1. NUNCA romper la app. Todo va en try/catch y fire-and-forget: si la tabla
//    no existe, si RLS rechaza o si no hay red, la acción del usuario sigue su
//    curso sin enterarse.
// 2. NUNCA bloquear. No se hace `await` en el camino del usuario — registrar
//    una descarga no puede demorar la descarga.
// 3. Datos mínimos. `detail` es un string corto (nombre de pestaña, tipo de
//    archivo). Nada de payloads, filtros ni datos de negocio: esto se mira en
//    una tabla, no se usa para reconstruir sesiones.

import { sb } from "../auth.js";

// Pestañas ya registradas en ESTA sesión. Se loguea la PRIMERA visita a cada
// pestaña, no cada ida y vuelta: la pregunta útil es "¿qué secciones usa la
// gente?", y registrar cada switch multiplicaría las filas por diez sin
// responder nada nuevo.
const _tabsLogged = new Set();

export function logAccess(event, detail) {
  try {
    if (!STATE || !STATE.userId) return;          // sin sesión no hay nada que registrar
    if (event === "tab") {
      if (_tabsLogged.has(detail)) return;
      _tabsLogged.add(detail);
    }
    const row = {
      user_id:    STATE.userId,
      user_email: STATE.userEmail || null,
      event,
      detail:     detail ? String(detail).slice(0, 200) : null
    };
    // DIFERIDO A TIEMPO OCIOSO, no disparado en el acto. `sb.from()` necesita el
    // access token, y supabase-js SERIALIZA todas las llamadas que lo piden tras
    // un mismo lock — mandar este insert durante el login o el primer render lo
    // pondría a competir con el fetch de datos, que es justamente el camino
    // crítico que se optimizó. La telemetría puede esperar 2 segundos; la carga
    // del dashboard no.
    const enviar = () => { try { Promise.resolve(sb.from("access_log").insert(row)).catch(() => {}); } catch (_) {} };
    if (typeof requestIdleCallback === "function") requestIdleCallback(enviar, { timeout: 5000 });
    else setTimeout(enviar, 2000);
  } catch (e) { /* jamás propagar */ }
}

// Al cerrar sesión, la próxima sesión debe volver a registrar sus pestañas.
export function resetAccessLogSession() { _tabsLogged.clear(); }
