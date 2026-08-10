//@ts-nocheck
// auth.js — Autenticación con Supabase Auth

// Import DIRECTO (no via window) — a diferencia de todo el resto del archivo
// (que son declaraciones cuyo cuerpo corre recién cuando se LLAMAN, mucho
// después de que vendor.js terminó de espejar sus globales), esta línea
// ejecuta AL EVALUAR el módulo. Y los imports de un módulo ES se resuelven
// ANTES que el cuerpo del archivo que los importa (vendor.js), sin importar
// el orden textual — o sea: cuando este `const sb = ...` corre, el
// `Object.assign(window, config, ...)` de vendor.js TODAVÍA no se ejecutó.
// Depender de `supabase`/`SUPABASE_URL` como globales bare acá rompía el login
// (createClient is not a function). Import directo = no depende del orden.
import { createClient, navigatorLock } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./core/config.js";
import { registerActions } from "./shared/actions.js";
import { snapshotClear } from "./data/cache.js";
import { logAccess, resetAccessLogSession } from "./shared/accessLog.js";

// ── LOCK DE AUTH CON ESCAPE ──────────────────────────────────────────────────
// supabase-js serializa las operaciones de auth con un Web Lock COMPARTIDO entre
// todas las pestañas del dominio, y por defecto espera INDEFINIDAMENTE. Si una
// pestaña queda colgada a mitad de una operación (o el navegador no libera el
// lock al cerrarla mal), cualquier otra pestaña se bloquea para siempre.
//
// El sintoma es engañoso y costo dos incidentes: el boton se queda en
// "Ingresando..." sin ningun error, PERO el servidor si proceso el login
// (last_sign_in_at se actualiza). O sea la red anduvo y la sesion existe — lo
// que nunca resuelve es la promesa del cliente, esperando el lock.
//
// Con timeout: si en 5s no se pudo tomar, seguimos SIN el lock. Lo unico que
// protege es la coincidencia de dos pestañas refrescando el token a la vez, que
// en el peor caso genera un refresh de mas; contra eso, quedarse trabado sin
// poder entrar es muchisimo peor. Cualquier otro error se propaga tal cual.
// OJO CON COMO SE DETECTA EL TIMEOUT: la primera version usaba
// `e instanceof NavigatorLockAcquireTimeoutError` y NO funcionaba — con
// acquireTimeout > 0 la libreria aborta un AbortController, asi que el rechazo
// viene como AbortError (DOMException), no como su clase propia; ese tipo solo
// se lanza en la rama acquireTimeout === 0. El propio auth-js lo advierte en su
// fuente: "Use the isAcquireTimeout property instead of checking with instanceof".
// Se detectaba en la prueba de lock retenido: escapaba con "signal is aborted
// without reason" en vez de seguir.
const _authLock = async (name, acquireTimeout, fn) => {
  try {
    return await navigatorLock(name, 5000, fn);
  } catch (e) {
    const esTimeout = !!(e && (e.isAcquireTimeout || e.name === "AbortError"
                          || /abort/i.test(e.message || "")));
    if (esTimeout) return await fn();   // seguimos sin el lock
    throw e;
  }
};

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { lock: _authLock }
});
// El resto del código (funciones, no top-level) sigue usando `STATE`, `showApp`,
// etc. como globales bare vía window — eso sí es seguro, porque solo se
// ejecuta cuando el usuario interactúa, mucho después del bootstrap inicial.
window.sb = sb;   // data.js (módulo) y otros consumidores leen `sb` bare vía window

// Estado de sesion. Roles via JWT app_metadata.role: admin > kam > viewer
// (default). STATE.isAdmin gatea lo exclusivo de admin. STATE.perms (Set) trae
// los grants granulares por usuario de la tabla user_permissions (Fase B2) —
// permisos que SUMAN sobre el rol (ej. un viewer con 'write:metas'). userCan()
// combina admin + grants. RLS en el servidor es el guard real: aunque se
// modifique STATE en DevTools, el write falla si el JWT/uid no tiene el permiso.
export function _setRoleFromUser(user) {
  const role = (user && user.app_metadata && user.app_metadata.role) || "viewer";
  STATE.userRole  = role;
  STATE.isAdmin   = role === "admin";
  if (!STATE.perms) STATE.perms = new Set();
  _recomputeCanWrite();
  _applyRoleGate();
  _loadPerms();   // async, refina STATE.perms + re-aplica el gate al volver
}

// Permisos de escritura/borrado que, otorgados a un usuario, deben mostrarle la
// UI de escritura (upload). El guard real por-tabla lo hace RLS via can().
export const _WRITE_PERMS = ["write:performance", "write:metas", "write:config", "write:seguimiento", "delete:data"];

export function _recomputeCanWrite() {
  const base = STATE.userRole === "admin" || STATE.userRole === "kam";
  const granted = STATE.perms && _WRITE_PERMS.some(p => STATE.perms.has(p));
  STATE.canWrite = base || !!granted;
}

// Carga los grants del usuario (RLS self_select → solo los propios). Silencioso
// ante error (tabla ausente / offline): el usuario simplemente queda sin grants
// extra, nunca con permisos de más.
export async function _loadPerms() {
  try {
    // fetch crudo (no sb.from) — esto corre en paralelo con fetchAllPeriods()
    // (data.js, disparado por loadFromSupabase() al mismo tiempo que el login)
    // y ambos pasando por sb.* competirían por el lock de sesión de supabase-js
    // (ver comentario largo en data.js junto a _pgFetch).
    const { data: { session } } = await sb.auth.getSession();
    const token = (session && session.access_token) || SUPABASE_ANON_KEY;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_permissions?select=permission`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    STATE.perms = new Set((data || []).map(r => r.permission));
    _recomputeCanWrite();
    _applyRoleGate();
  } catch (_) { /* offline / tabla ausente → sin grants extra */ }
}

// Helper global de permiso: admin siempre; si no, el grant puntual. Usar para
// gatear UI de escritura fina (nunca como seguridad — eso es RLS).
export function userCan(perm) {
  return !!STATE.isAdmin || (STATE.perms && STATE.perms.has(perm));
}

export function _applyRoleGate() {
  // Esconde UI destructiva/de escritura segun rol. Se llama tras login y tras tab switch.
  const esPartner = STATE.userRole === "partner";
  // Un partner NUNCA sube archivos, sin importar canWrite: si por error alguien
  // le otorgara un permiso de escritura, igual no debe ver la UI de subida
  // (y RLS lo rechazaría de todos modos — esto solo evita ofrecerle algo que
  // no puede hacer).
  const canWrite = !!STATE.canWrite && !esPartner;
  const up = document.getElementById("uploadDropdown");
  if (up) up.style.display = canWrite ? "" : "none";
  // Marcamos el body para usos via CSS si hace falta.
  document.body.classList.toggle("role-admin",  !!STATE.isAdmin);
  document.body.classList.toggle("role-kam",    STATE.userRole === "kam");
  document.body.classList.toggle("role-viewer", STATE.userRole === "viewer");
  document.body.classList.toggle("role-partner", esPartner);

  // ── Partner externo (Track C2): superficie mínima ────────────────────────
  // Se esconde TODA la navegación interna y se fuerza el portal. Esto es
  // conveniencia/UX, NO el control de seguridad: aunque alguien restaure el
  // nav desde DevTools, RLS solo le devuelve las filas de SUS CLIDs, y las
  // tablas que no le corresponden (seguimiento, proyectos, audit_log) no
  // tienen política para su rol, así que le vuelven vacías.
  document.querySelectorAll(".nav-tabs").forEach(n => { n.style.display = esPartner ? "none" : ""; });
  if (esPartner) {
    // Sin lista de partners (solo se ve a sí mismo) ni selector de KAM.
    ["pList", "kamFilter", "partnerSearch"].forEach(id => {
      const el = document.getElementById(id);
      const wrap = el?.previousElementSibling;   // su <div class="sb-label">
      if (el)   el.style.display = "none";
      if (wrap && wrap.classList.contains("sb-label")) wrap.style.display = "none";
    });
    document.querySelectorAll(".sb-row").forEach(r => { r.style.display = "none"; }); // Todos/Ninguno
    STATE.curTab = "portal";
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    document.getElementById("tab-portal")?.classList.add("active");
    // El portal es un chunk lazy (loadViewModule) igual que Vista Partner/
    // Calculadora/etc — pero a diferencia de esas vistas, a este tab se llega
    // DIRECTO acá (login de un partner), nunca vía switchTab(), que es el
    // único lugar que llamaba loadViewModule. Sin esto, partnerPortal.js
    // nunca se importaba y el portal quedaba en blanco para todo usuario
    // partner (encontrado revisando una sesión real, no en desarrollo).
    if (typeof window.loadViewModule === "function") {
      window.loadViewModule("portal").then(() => {
        if (STATE.curTab === "portal" && typeof renderPartnerPortal === "function") renderPartnerPortal();
      });
    }
  }
}

export async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    showApp(session.user);
  } else {
    showLoginScreen();
  }
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN")      { showApp(session.user); logAccess("login", null); }
    if (event === "TOKEN_REFRESHED")  _setRoleFromUser(session && session.user);
    if (event === "SIGNED_OUT")       showLoginScreen();
  });
}

export async function handleLogin() {
  const email    = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl    = document.getElementById("loginError");
  const btn      = document.getElementById("loginBtn");

  errEl.textContent = "";
  if (!email || !password) { errEl.textContent = "Ingresa tu email y contraseña."; return; }

  btn.textContent = "Ingresando...";
  btn.disabled    = true;

  // El boton solo se restauraba ante error: si signInWithPassword NUNCA resolvia,
  // quedaba en "Ingresando..." para siempre y sin ninguna pista de que pasaba.
  // Este watchdog no arregla la causa (para eso esta _authLock), pero convierte
  // un cuelgue mudo en un mensaje accionable — que es la diferencia entre "el
  // dashboard no anda" y saber que hay que cerrar las otras pestañas.
  const watchdog = setTimeout(() => {
    if (!btn.disabled) return;                 // ya resolvio, no pisar nada
    errEl.textContent = "El servidor tardó demasiado en responder. Cerrá las otras pestañas del dashboard y volvé a intentar.";
    btn.textContent   = "Ingresar";
    btn.disabled      = false;
  }, 15000);

  try {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      errEl.textContent = "Credenciales incorrectas. Intenta de nuevo.";
      btn.textContent   = "Ingresar";
      btn.disabled      = false;
    }
    // En exito NO se restaura el boton a proposito: el handler de SIGNED_IN
    // (showApp) oculta la pantalla de login entera.
  } catch (e) {
    errEl.textContent = "No se pudo completar el ingreso: " + ((e && e.message) || e);
    btn.textContent   = "Ingresar";
    btn.disabled      = false;
  } finally {
    clearTimeout(watchdog);
  }
}

export async function handleLogout() {
  // Limpiamos STATE y caches sensibles ANTES de signOut para que el siguiente
  // usuario del navegador no vea data del anterior ni en memoria ni en LS.
  _clearStateAndLocalStorage();
  _appInitialized = false;
  await sb.auth.signOut();
}

export function _clearStateAndLocalStorage() {
  // Drop de datos del dataset en memoria.
  ["rawData","rawDataMensual","rawDataMensualTuktuk","rawDataDiarioTuktuk","rawDataFleet","rawDataMensualFleet","rawDataDiarioFleet",
   "rawDataFull","rawDataMensualFull",
   "rawDataDiario","rawDataDiarioFull","rawDataTuktuk","metasData","proyectosData","seguimientoData",
   "fleetExterno","fleetExternoCols",
   "allDates","allPartners","curSummaries"
  ].forEach(k => { if (Array.isArray(STATE[k])) STATE[k].length = 0; });
  STATE.fleetExternoLoaded = false;
  STATE.fleetExternoError  = null;
  STATE.rendLine  = "comb";
  STATE.metasLine = "comb";
  STATE._tuktukMensualByCityDate = null;
  STATE._tuktukMensualPartners   = null;
  STATE._tuktukMensualDates      = null;
  STATE.CLID_MAP        = {};
  STATE.KAM_MAP         = {};
  STATE.KAM_PARTNERS    = {};
  STATE.partnerColors   = {};
  STATE._byPartner      = null;
  STATE._byCity         = null;
  STATE._byCityDate     = null;
  STATE._partnerKAM     = null;
  STATE._apdFull        = null;
  STATE._mensualLoaded  = false;
  STATE._diarioLoaded   = false;
  STATE.userRole        = null;
  STATE.userEmail       = null;
  STATE.userId          = null;
  STATE.isAdmin         = false;
  STATE.canWrite        = false;
  if (STATE.perms) STATE.perms = new Set();
  if (STATE.flotasMap) STATE.flotasMap = null;
  // Charts: destruir instancias para liberar memoria.
  if (STATE.charts) {
    Object.values(STATE.charts).forEach(c => { try { c && c.destroy && c.destroy(); } catch {} });
    STATE.charts = {};
  }
  // Sensibles en localStorage. yangoSidebarCollapsed se queda (UI pref, no sensible).
  try {
    localStorage.removeItem("yangoFilters");
    localStorage.removeItem("yangoDecline");
    localStorage.removeItem("yangoFleetExtConfig");
  } catch {}
  // Caché de datos en IndexedDB (data/cache.js): cerrar sesión tiene que borrar
  // la DATA, no solo el token — si no, quien use después ese navegador podría
  // ver el último snapshot de negocio sin loguearse.
  snapshotClear();
  resetAccessLogSession();
}

export function showLoginScreen() {
  document.getElementById("loginScreen").style.display    = "flex";
  document.getElementById("appContainer").style.display   = "none";
  document.getElementById("loginPassword").value          = "";
  document.getElementById("loginError").textContent       = "";
  // Aplica role-viewer al body para esconder UI destructiva incluso pre-login.
  STATE.isAdmin = false;
  STATE.userRole = null;
  STATE.canWrite = false;
  _applyRoleGate();
  setTimeout(() => document.getElementById("loginEmail").focus(), 100);
}

export let _appInitialized = false;

export function showApp(user) {
  document.getElementById("loginScreen").style.display  = "none";
  document.getElementById("appContainer").style.display = "flex";
  document.getElementById("userBadge").textContent      = user.email;
  STATE.userEmail = user.email;   // firma de los PDFs exportados (shared/pdfmeta.js)
  STATE.userId    = user.id;      // clave del caché local (data/cache.js)

  // Telemetría de uso (Configuración → Monitoreo). Va DESPUÉS de fijar
  // userId/userEmail: logAccess se corta solo si no hay sesión.
  //
  // Se registra la pestaña inicial, NO un "login": showApp corre también al
  // RESTAURAR una sesión existente (cada hard refresh), así que loguear "login"
  // acá inflaría la cuenta de ingresos. El login de verdad se registra en el
  // evento SIGNED_IN de onAuthStateChange. Sin esto, en cambio, alguien que
  // refresca y se queda mirando Rendimiento no generaría ningún evento (a esa
  // pestaña se llega sin pasar por switchTab).
  logAccess("tab", STATE.curTab || "rend");

  _setRoleFromUser(user);

  if (!_appInitialized) {
    _appInitialized = true;
    initApp();
  }
}
// Enter en password ya dispara el submit nativo del <form> (ver index.html +
// handleLoginSubmit) — solo hace falta manejar Enter en email para saltar el
// foco a password en vez de intentar loguear con la contraseña vacía.
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("loginEmail")
    ?.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); document.getElementById("loginPassword").focus(); }
    });
  initAuth();
});

// data-act-submit del <form id="loginForm"> (index.html) — envolver los inputs
// en un <form> de verdad silencia el aviso de DevTools "Password field is not
// contained in a form" y deja que el gestor de contraseñas del navegador
// funcione mejor (autocompletar, "guardar contraseña"). preventDefault evita
// la recarga de página que hace un submit nativo sin backend.
function handleLoginSubmit(d, el, e) { e.preventDefault(); handleLogin(); }

registerActions({ handleLogin, handleLogout, handleLoginSubmit });
