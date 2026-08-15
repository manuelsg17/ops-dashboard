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

// NINGUNA librería pesada se importa acá. XLSX (uploads), Chart.js (solo
// Presentación 2.0), jsPDF/html2canvas (solo exportar PDF) y ApexCharts
// (gráficas) se cargan bajo demanda — cada una pesa cientos de KB y la
// pantalla de login pagaba ese costo completo aunque nadie suba un Excel,
// exporte un PDF ni llegue a ver una gráfica en esa sesión.
//
// ApexCharts era la última que quedaba eager (510 kB / 133 kB gzip, el chunk
// más grande del arranque) con el argumento de que Rendimiento es el tab por
// defecto. Pero las gráficas se pintan al FINAL del render y no bloquean nada
// de lo anterior, así que ahora se carga en paralelo (charts.js → ensureApex)
// y se saca del camino crítico del primer pintado.

window.supabase = { createClient };

// ── Red de seguridad global: chunk dinámico 404 tras un deploy ──────────────
// Cualquier import() dinámico (loadViewModule, shared/lazyLibs.js) puede fallar
// con "Failed to fetch dynamically imported module" si el navegador tenía el
// index.html VIEJO cacheado justo cuando se publicó un deploy nuevo — los
// archivos con hash viejo ya no existen. loadViewModule ya maneja su propio
// caso (ver vendor.js); esto cubre cualquier otro import() dinámico (ej.
// html2canvas/jsPDF en lazyLibs.js) con el mismo recovery de un solo reload.
// Un import() dinámico puede rechazar por MUCHAS razones (red caída, error de
// sintaxis/ejecución en el módulo, chunk inexistente). Solo el chunk 404 se
// arregla recargando — el resto NO, y recargar ahí solo pierde el estado del
// usuario. Este predicado es el único lugar donde se decide eso.
export function _isChunkError(err) {
  const msg = String((err && err.message) || err || "");
  return /fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(msg);
}

window.addEventListener("unhandledrejection", e => {
  if (!_isChunkError(e.reason)) return;
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
if (location.hostname.endsWith(".vercel.app")) {
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
// rawdata/seguimiento/fleetexterno NO se importan acá — cada una es
// SU PROPIA pestaña (Data Raw / Seguimiento / Fleet Externo),
// nunca usada por rendimiento/metas/app (las únicas eager, junto con el login).
// Antes vivían acá pese a sumar >2200 líneas pagadas por toda sesión sin uso —
// ahora son chunks lazy más, vía loadViewModule, mismo patrón que partnerView/
// calculator/presentacion2/adminUsers/partnerPortal. forecast.js se movió
// dentro de presentacion2.js (única consumidora, ver ese archivo).

// Espejar el núcleo esencial
Object.assign(window,
  config, security, format, dates, data, auth, charts,
  rendimiento, metas, app
);

// ── Banda de entorno LOCAL ──────────────────────────────────────────────────
// Solo aparece cuando la app apunta al Supabase de Docker (ver core/config.js).
// El error caro de este setup es confundir una pantalla de datos sintéticos con
// producción — o al revés, borrar datos reales creyendo que era la copia local.
// Es una banda fija arriba, imposible de no ver, y no existe en el deploy.
if (config.IS_LOCAL_SUPABASE) {
  const b = document.createElement("div");
  b.textContent = "⚠ SUPABASE LOCAL — datos de prueba, no es producción";
  b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;" +
    "background:#b45309;color:#fff;font:600 12px/1 system-ui,sans-serif;" +
    "padding:6px 10px;text-align:center;letter-spacing:.3px";
  document.body.appendChild(b);
  document.body.style.paddingTop = "24px";
}

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
const _VIEW_IMPORTERS = {
  partnerview: () => import("./partnerView.js"),
  present2:    () => import("./presentacion2.js"),
  calculator:  () => import("./calculator.js"),
  // Configuración carga adminUsers Y monitoreo: son dos sub-secciones de la
  // misma pestaña, así que separarlas en dos chunks no ahorra nada.
  config:      () => Promise.all([import("./adminUsers.js"), import("./monitoreo.js")])
                       .then(([a, m]) => ({ ...a, ...m })),
  portal:      () => import("./partnerPortal.js"),
  rawdata:     () => import("./rawdata.js"),
  seguimiento: () => import("./seguimiento.js"),
  fleetext:    () => import("./fleetexterno.js")
};

const _loadedModules = {};
const _inflight = {};

export async function loadViewModule(viewName) {
  if (_loadedModules[viewName]) return _loadedModules[viewName];
  const importer = _VIEW_IMPORTERS[viewName];
  if (!importer) return null;
  // Dedupe: dos switchTab seguidos al mismo tab no deben lanzar dos import().
  if (_inflight[viewName]) return _inflight[viewName];

  _inflight[viewName] = (async () => {
    let mod = null;
    try {
      mod = await importer();
    } catch (err) {
      // OJO — acá vivía un bug de UX serio: el catch recargaba la página ante
      // CUALQUIER error del import(), y un import() dinámico rechaza tanto por
      // un chunk 404 como por un error de red pasajero o por una excepción en
      // el código top-level del propio módulo. Resultado: abrir Vista Partner o
      // Calculadora recargaba todo y devolvía a la pantalla principal, tirando
      // a la basura los segundos de data ya cargada. Ahora:
      //   1. Un fallo de red pasajero se REINTENTA en el lugar (sin recargar).
      //   2. Solo un fallo de CHUNK confirmado (index.html viejo cacheado tras
      //      un deploy) justifica el reload — es el único caso que un reload
      //      realmente arregla.
      //   3. Cualquier otro error se propaga: que se vea el error real en vez
      //      de esconderlo detrás de una recarga misteriosa.
      if (!_isChunkError(err)) throw err;
      try {
        await new Promise(r => setTimeout(r, 250));
        mod = await importer();
      } catch (err2) {
        if (!sessionStorage.getItem("_chunkReloadOnce")) {
          sessionStorage.setItem("_chunkReloadOnce", "1");
          location.reload();
          return null;
        }
        throw err2;
      }
    } finally {
      delete _inflight[viewName];
    }
    if (mod) {
      _loadedModules[viewName] = mod;
      Object.assign(window, mod);
      sessionStorage.removeItem("_chunkReloadOnce");   // carga OK → resetea el guard
    }
    return mod;
  })();
  return _inflight[viewName];
}

// Precarga en tiempo ocioso: al terminar la carga inicial, bajar los chunks de
// las pantallas más usadas mientras el navegador no hace nada. Cambiar de
// pestaña deja de esperar una descarga (que es lo que se sentía "trabado").
export function prefetchViewModules(names) {
  const list = (names || []).filter(n => _VIEW_IMPORTERS[n] && !_loadedModules[n]);
  if (!list.length) return;
  const idle = window.requestIdleCallback || (cb => setTimeout(() => cb({ timeRemaining: () => 50 }), 800));
  const next = () => {
    const n = list.shift();
    if (!n) return;
    // Fallo de precarga = silencioso a propósito: es una optimización, no una
    // funcionalidad. Si falla, loadViewModule lo reintenta cuando haga falta.
    loadViewModule(n).catch(() => {}).then(() => idle(next));
  };
  idle(next);
}
window.prefetchViewModules = prefetchViewModules;
window.loadViewModule = loadViewModule;
