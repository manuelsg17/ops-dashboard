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
const _loadedModules = {};
export async function loadViewModule(viewName) {
  if (_loadedModules[viewName]) return _loadedModules[viewName];
  let mod = null;
  if (viewName === "partnerview")  mod = await import("./partnerView.js");
  if (viewName === "present2")     mod = await import("./presentacion2.js");
  if (viewName === "calculator")   mod = await import("./calculator.js");
  if (viewName === "adminUsers")   mod = await import("./adminUsers.js");
  if (viewName === "partnerPortal")mod = await import("./partnerPortal.js");
  if (mod) {
    _loadedModules[viewName] = mod;
    Object.assign(window, mod);
  }
  return mod;
}
window.loadViewModule = loadViewModule;
