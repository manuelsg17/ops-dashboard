//@ts-nocheck
// vendor.js — Bootstrap de librerías de terceros (Fase A1, migración a Vite).
//
// Reemplaza los <script src="cdn..."> con SRI del index.html: las 7 librerías
// ahora vienen de npm (pineadas en package.json + package-lock, sin mantener SRI
// a mano). Este módulo corre PRIMERO (es el único type="module" y va antes que
// los <script defer> de la app en el orden del documento → se ejecuta antes,
// pero después del parseo y antes de DOMContentLoaded).
//
// Expone cada librería como global con el MISMO nombre que tenían las versiones
// UMD del CDN, para que el código de la app (aún en scope global clásico durante
// la transición A1→A2) las siga encontrando sin cambios:
//   supabase.createClient · XLSX · ApexCharts · Chart · html2canvas · jspdf.jsPDF
import "./styles.css";
import { createClient } from "@supabase/supabase-js";
import ApexCharts from "apexcharts";

// XLSX (solo uploads de Excel), Chart.js (solo Presentación 2.0) y jsPDF/
// html2canvas (solo exportar PDF) NO se importan acá — cada uno pesa cientos
// de KB y hasta la pantalla de login pagaba el costo completo aunque nadie
// suba un Excel ni exporte nada en esa sesión. Se cargan bajo demanda desde
// shared/lazyLibs.js (XLSX/PDF) o directo en presentacion2.js (Chart.js, que
// ya es un chunk lazy vía loadViewModule — no hace falta indirección extra).
// ApexCharts SÍ queda eager: lo usa Rendimiento, el tab por defecto al loguear.

window.supabase    = { createClient };
window.ApexCharts  = ApexCharts;

// ── Red de seguridad global: chunk dinámico 404 tras un deploy ──────────────
// Cualquier import() dinámico (loadViewModule, shared/lazyLibs.js) puede fallar
// con "Failed to fetch dynamically imported module" si el navegador tenía el
// index.html VIEJO cacheado justo cuando se publicó un deploy nuevo — los
// archivos con hash viejo ya no existen. loadViewModule ya maneja su propio
// caso (ver vendor.js); esto cubre cualquier otro import() dinámico (ej.
// html2canvas/jsPDF en lazyLibs.js) con el mismo recovery de un solo reload.
window.addEventListener("unhandledrejection", e => {
  const msg = String((e.reason && e.reason.message) || e.reason || "");
  if (!/fetch dynamically imported module|Importing a module script failed/i.test(msg)) return;
  if (sessionStorage.getItem("_chunkReloadOnce")) return;   // ya se intentó, no loopear
  sessionStorage.setItem("_chunkReloadOnce", "1");
  location.reload();
});

// ── Vercel Speed Insights ──────────────────────────────────────────────────
// Integración "Other framework" (no hay paquete Preact/vanilla dedicado): el
// script lo sirve Vercel mismo en /_vercel/speed-insights/script.js, así que
// no hace falta instalar nada por npm. Se inyecta por JS (no <script> inline
// en index.html) porque la CSP es script-src 'self' sin 'unsafe-inline' — un
// <script> inline con el snippet de window.si quedaría bloqueado. Gateado a
// dominios *.vercel.app (o el propio, si algún día hay uno custom): en GitHub
// Pages ese endpoint no existe, y no tiene sentido pedirlo ahí.
if (/\.vercel\.app$/.test(location.hostname)) {
  window.si = window.si || function (...args) { (window.siq = window.siq || []).push(args); };
  const s = document.createElement("script");
  s.defer = true;
  s.src = "/_vercel/speed-insights/script.js";
  document.head.appendChild(s);
}

// ── Módulos de app (Fase A2 completa: los 16 archivos ya son módulos ES) ─────
// Todo el código de la app vive en módulos ES ahora — ya no hay <script defer>
// clásicos en index.html. Igual se espeja todo a window (Object.assign) porque
// las funciones se siguen invocando desde HANDLERS INLINE del HTML (onclick=
// "fn(...)", ~183 de ellos) — eso requiere que `fn` exista como global. Matar
// ese espejo requiere primero migrar los onclick a event delegation (próxima
// fase de A2), momento en el que este Object.assign deja de hacer falta.
import * as config       from "./core/config.js";
import * as security     from "./core/security.js";
import * as format       from "./core/format.js";
import * as dates        from "./core/dates.js";
import * as data         from "./data.js";
import * as auth         from "./auth.js";
import * as charts       from "./charts.js";
import * as rendimiento  from "./rendimiento.js";
import * as metas        from "./metas.js";
import * as app          from "./app.js";
import * as unifview     from "./unifview.js";
import * as rawdata      from "./rawdata.js";
import * as seguimiento  from "./seguimiento.js";
import * as fleetexterno from "./fleetexterno.js";
import * as forecast     from "./forecast.js";

// Espejar el núcleo esencial
Object.assign(window,
  config, security, format, dates, data, auth, charts,
  rendimiento, metas, app, unifview, rawdata, seguimiento, fleetexterno, forecast
);

// Loader asíncrono para módulos de pantalla pesados (Lazy Loading)
//
// viewName = el NOMBRE DE TAB REAL que usa el resto de la app (STATE.curTab),
// no un alias inventado — bug encontrado en producción (revisando una sesión
// real): switchTab() llama loadViewModule(tab) con tab="config", pero acá
// solo se reconocía el string "adminUsers" (que NADA pasa nunca como tab) →
// adminUsers.js nunca se importaba, el panel de Usuarios quedaba vacío en
// silencio (el `typeof renderAdminUsers === "function"` de app.js no tira
// error, solo no hace nada). Mismo problema con "partnerPortal" vs el tab
// real "portal" — más grave, es la única pantalla del rol partner.
const _loadedModules = {};
export async function loadViewModule(viewName) {
  if (_loadedModules[viewName]) return _loadedModules[viewName];
  let mod = null;
  try {
    if (viewName === "partnerview")            mod = await import("./partnerView.js");
    if (viewName === "present2")               mod = await import("./presentacion2.js");
    if (viewName === "calculator")              mod = await import("./calculator.js");
    if (viewName === "config")                  mod = await import("./adminUsers.js");
    if (viewName === "portal")                  mod = await import("./partnerPortal.js");
  } catch (err) {
    // "Failed to fetch dynamically imported module" / 404 de chunk: pasa cuando
    // el navegador tiene cacheado el index.html VIEJO (con hashes de archivo
    // viejos) justo después de un deploy nuevo — los archivos viejos ya no
    // existen. Un solo reload agarra el index.html fresco (hashes correctos) y
    // se autocura; el guard de sessionStorage evita un loop infinito si el
    // problema fuera otra cosa.
    if (!sessionStorage.getItem("_chunkReloadOnce")) {
      sessionStorage.setItem("_chunkReloadOnce", "1");
      location.reload();
      return null;
    }
    throw err;
  }
  if (mod) {
    _loadedModules[viewName] = mod;
    Object.assign(window, mod);
    sessionStorage.removeItem("_chunkReloadOnce");   // carga OK → resetea el guard
  }
  return mod;
}
window.loadViewModule = loadViewModule;
