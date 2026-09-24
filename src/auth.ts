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
import { createClient, navigatorLock, isAuthRetryableFetchError } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./core/config.js";
import { registerActions } from "./shared/actions.js";
import { snapshotClear } from "./data/cache.js";
import { logAccess, resetAccessLogSession } from "./shared/accessLog.js";
import { resetearEstadoDeSesion } from "./shared/sesion";
import { perfMark } from "./shared/perf";
import { t } from "./core/i18n";
import { iconSvg } from "./shared/icons";
import { renderShellNav, renderPageHeader } from "./shell";

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

// ── TELEMETRÍA "login" (sep-2026) ───────────────────────────────────────────
// Se registraba un "login" en CADA evento SIGNED_IN, y supabase-js también lo
// emite al recuperar la sesión (volver a la pestaña, refresco de fondo): en
// producción, 90–212 "logins" por día de UNA persona. Ahora solo cuenta un
// ingreso de verdad:
//   1. el formulario (handleLogin marca `_loginPendiente` ANTES de llamar a
//      signInWithPassword, que emite SIGNED_IN antes de resolver), o
//   2. la llegada por un enlace de invitación/acceso (el token viene en el hash
//      de la URL). Se lee ACÁ, antes de crear el cliente: al inicializarse,
//      supabase-js consume el hash y lo borra de la barra.
let _loginPendiente = false;
let _llegoPorEnlace = /(^|[#&])access_token=/.test((typeof location !== "undefined" && location.hash) || "");

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
  // KAM de este login (app_metadata.kam) — ver el comentario en core/config.ts.
  // Viaja en el MISMO JWT que el rol, así que llega sin ninguna llamada extra:
  // ni ronda de red ni tabla nueva, el mismo patrón que ya usa `role`.
  STATE.myKam = (user && user.app_metadata && user.app_metadata.kam) || null;
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
    // Sin sesión válida no se pregunta nada (antes caía a la anon key). Con el
    // arranque provisional (V1) esto corre antes de que el refresh confirme: si
    // el refresh falla, no sale ningún pedido.
    if (!session || !session.access_token) return;
    const token = session.access_token;
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
  // Ola 5: lo que un partner no ve (navegación, ciudad/KAM/buscador/lista de
  // partners del panel de filtros) se oculta por CSS con body.role-partner
  // (styles.css) y la navegación se vuelve a pintar según el rol (shell.ts).
  // Al ser una clase y no estilos inline, un login interno posterior sin
  // recargar (I2) no hereda nada escondido.
  if (!esPartner) {
    if (STATE.curTab === "portal") {
      STATE.curTab = "rend";
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      document.getElementById("tab-rend")?.classList.add("active");
    }
  }
  if (esPartner) {
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
  renderShellNav();
  renderPageHeader();
}

// ── ARRANQUE SIN ESPERAR AL REFRESH DEL TOKEN (Ola 2, V1) ───────────────────
// Un KAM abre el dashboard una vez al día: el access token (1 h) SIEMPRE venció,
// así que getSession() hace un round-trip de refresh (~300 ms Lima→us-east)
// antes de devolver nada. Antes se esperaba eso para mostrar CUALQUIER cosa, y
// mientras tanto se veía la pantalla de login (visible por defecto): parpadeo
// de login + un round-trip en serie delante del caché.
//
// Ahora, si hay una sesión persistida por supabase-js en localStorage, la app
// arranca en modo PROVISIONAL con ese usuario: pinta el snapshot de IndexedDB
// de ESE user_id (data/cache.ts) mientras el refresh corre en paralelo. Reglas
// de seguridad, en orden:
//   1. Ningún dato sale de la RED sin token vigente: todo pedido pasa por
//      _authToken (data.ts) → getSession(), que espera al refresh; si no hay
//      sesión válida, lanza (ya no cae a la anon key).
//   2. Lo único que se pinta antes de confirmar es el caché local de ese mismo
//      usuario (clave por user_id + chequeo del dueño en snapshotLoad).
//   3. El rol para el gating sale de la sesión guardada hasta que el refresh la
//      confirma; si el rol/KAM confirmados difieren, se re-aplica el gate y se
//      re-renderiza la pestaña activa. (Tocar localStorage solo cambia UI: los
//      datos los decide RLS con el JWT real.)
//   4. Si el refresh FALLA de forma definitiva (refresh token revocado o
//      vencido: supabase-js ya borró la sesión), se borra el caché de datos, se
//      limpia el estado y se muestra el login. Si falla de forma reintentable
//      (sin red / 5xx): supabase-js reintenta el refresh con backoff hasta ~30 s
//      y durante ese lapso sigue a la vista SOLO el caché local (ningún pedido
//      de datos sale: esperan al token); si vuelve la red, se confirma y sigue;
//      si se agotan los reintentos, se oculta lo pintado y se muestra el login
//      SIN borrar el caché ni los borradores (la sesión no está invalidada,
//      solo no se pudo confirmar — mismo final que antes de V1).
//      Verificado con un refresh token revocado de verdad (logout scope=local)
//      y con el endpoint de token cortado (sin red) — ver el reporte de la Ola 2.
function _sesionGuardada() {
  try {
    const raw = localStorage.getItem(sb.auth.storageKey);
    const s = raw ? JSON.parse(raw) : null;
    if (!s || !s.refresh_token || !s.user || !s.user.id) return null;
    return s;
  } catch (_) { return null; }
}

function _quitarSplash() {
  const el = document.getElementById("bootSplash");
  if (el) el.remove();
}

function _mismoPerfil(a, b) {
  const ma = (a && a.app_metadata) || {}, mb = (b && b.app_metadata) || {};
  return (ma.role || "viewer") === (mb.role || "viewer") && (ma.kam || null) === (mb.kam || null)
    && (a && a.email) === (b && b.email);
}

// El refresh confirmó la sesión provisional.
function _confirmarSesion(provisional, user) {
  if (!user || user.id !== provisional.id) {
    // Otra cuenta (p.ej. se logueó otra persona en otra pestaña entre medio):
    // nada de lo pintado le corresponde. Se descarta todo y se arranca de cero.
    _clearStateAndLocalStorage();
    _appInitialized = false;
    if (user) showApp(user); else showLoginScreen();
    return;
  }
  STATE._sesionProvisional = false;
  // La telemetría de la pestaña inicial espera a la sesión confirmada (ver showApp).
  logAccess("tab", STATE.curTab || "rend");
  if (_mismoPerfil(provisional, user)) return;
  // Rol / KAM / email distintos a los guardados: re-gate + re-render.
  showApp(user);   // actualiza badge/email y _setRoleFromUser (no re-inicializa)
  if (typeof window._renderActiveTabAfterLoad === "function" && STATE.rawData && STATE.rawData.length) {
    window._renderActiveTabAfterLoad();
  }
}

// El refresh NO pudo confirmar la sesión provisional.
function _descartarSesionProvisional(error) {
  // Definitivo = el servidor RECHAZÓ el refresh (4xx: token revocado/vencido;
  // supabase-js ya borró la sesión guardada). Reintentable = no hubo respuesta
  // útil (sin red, 5xx, lock): la sesión sigue guardada y no está invalidada.
  const rechazada = !!(error && error.__isAuthError && !isAuthRetryableFetchError(error));
  const reintentable = !rechazada && !!_sesionGuardada();
  if (reintentable) {
    _limpiarEstadoEnMemoria();
  } else {
    // Definitivo: por las dudas se borra también la sesión guardada (supabase-js
    // ya lo hizo si el servidor la rechazó) para no volver a entrar provisional.
    try { localStorage.removeItem(sb.auth.storageKey); } catch (_) {}
    _clearStateAndLocalStorage();
  }
  STATE._sesionProvisional = false;
  _appInitialized = false;
  showLoginScreen();
}

export async function initAuth() {
  perfMark("auth:init");
  const guardada = _sesionGuardada();
  if (guardada) {
    showApp(guardada.user, { provisional: true });
    perfMark("auth:session-known");
  }
  // "No pude leer la sesión" NO es lo mismo que "no hay sesión". getSession()
  // puede fallar o quedarse esperando el Web Lock que supabase-js comparte
  // entre TODAS las pestañas del dominio (el motivo por el que existe
  // _authLock con su timeout de 5s, ver core/config.ts). Si eso pasaba, la
  // desestructuración tiraba o session venía undefined y se mandaba al usuario
  // a la pantalla de login con la sesión intacta en localStorage — se veía
  // como "me cerró la sesión sola", justo después de una recarga.
  // Ahora: un fallo se reintenta una vez, y recién ahí se asume que no hay
  // sesión.
  let session = null, error = null;
  for (let intento = 0; intento < 2; intento++) {
    try {
      const res = await sb.auth.getSession();
      session = (res && res.data && res.data.session) || null;
      error = (res && res.error) || null;
      break;
    } catch (err) {
      error = err;
      if (DEBUG) console.warn(`getSession() falló (intento ${intento + 1}):`, err);
      if (intento === 0) await new Promise(r => setTimeout(r, 600));
    }
  }
  perfMark("auth:session-confirmed");
  if (guardada) {
    if (session) _confirmarSesion(guardada.user, session.user);
    else _descartarSesionProvisional(error);
  } else if (session) {
    showApp(session.user);
  } else {
    showLoginScreen();
  }
  if (_llegoPorEnlace && session) logAccess("login", null);   // ver _loginPendiente
  _llegoPorEnlace = false;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN") {
      showApp(session.user);
      // Solo el SIGNED_IN del formulario es un ingreso; los que emite
      // supabase-js al recuperar la sesión no (ver _loginPendiente).
      if (_loginPendiente) { _loginPendiente = false; logAccess("login", null); }
    }
    if (event === "TOKEN_REFRESHED") {
      // Sesión que no se pudo confirmar al abrir (sin red) y que supabase-js
      // logró refrescar después: se entra sin volver a pedir la contraseña.
      if (!_appInitialized && session && session.user) showApp(session.user);
      else _setRoleFromUser(session && session.user);
    }
    // I2: una sesión que se cierra SIN pasar por handleLogout (token vencido,
    // logout desde otra pestaña) también tiene que limpiar el estado: si no, el
    // próximo SIGNED_IN (otro usuario) caía en `_appInitialized === true`, no
    // recargaba nada y veía los datos del anterior.
    if (event === "SIGNED_OUT") {
      _clearStateAndLocalStorage();
      _appInitialized = false;
      showLoginScreen();
    }
  });
}

export async function handleLogin() {
  const email    = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl    = document.getElementById("loginError");
  const btn      = document.getElementById("loginBtn");

  errEl.textContent = "";
  if (!email || !password) { errEl.textContent = t("login.errVacio"); return; }

  btn.textContent = t("login.loading");
  btn.disabled    = true;

  // El boton solo se restauraba ante error: si signInWithPassword NUNCA resolvia,
  // quedaba en "Ingresando..." para siempre y sin ninguna pista de que pasaba.
  // Este watchdog no arregla la causa (para eso esta _authLock), pero convierte
  // un cuelgue mudo en un mensaje accionable — que es la diferencia entre "el
  // dashboard no anda" y saber que hay que cerrar las otras pestañas.
  const watchdog = setTimeout(() => {
    if (!btn.disabled) return;                 // ya resolvio, no pisar nada
    errEl.textContent = t("login.errTimeout");
    btn.textContent   = t("login.submit");
    btn.disabled      = false;
  }, 15000);

  try {
    _loginPendiente = true;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      _loginPendiente = false;
      errEl.textContent = t("login.errCred");
      btn.textContent   = t("login.submit");
      btn.disabled      = false;
    }
    // En exito NO se restaura el boton a proposito: el handler de SIGNED_IN
    // (showApp) oculta la pantalla de login entera.
  } catch (e) {
    _loginPendiente = false;
    errEl.textContent = t("login.errOtro") + ((e && e.message) || e);
    btn.textContent   = t("login.submit");
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

// Vacía los paneles que muestran datos (quedan ocultos tras el login, pero no
// hace falta que sigan ahí): lo usa el descarte de una sesión provisional.
const _PANELES_CON_DATOS = ["rendContent", "metasContent", "portalContent", "present2Content",
  "calculatorContent", "rawdataContent", "configContent", "pList"];
function _vaciarPaneles() {
  _PANELES_CON_DATOS.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ""; });
}

// Estado EN MEMORIA de la sesión (datos, mapas, gráficas, módulos). No toca
// localStorage ni el caché de IndexedDB: eso lo hace _clearStateAndLocalStorage.
// Sube la "época" de la sesión: toda carga en vuelo (data.ts loadFromSupabase,
// escalas, precarga) la compara antes de aplicar/pintar/guardar lo que le llegue,
// así una respuesta de la sesión anterior nunca se aplica sobre la nueva.
export function _limpiarEstadoEnMemoria() {
  STATE._authEpoch = (STATE._authEpoch || 0) + 1;
  // Drop de datos del dataset en memoria.
  ["rawData","rawDataMensual","rawDataMensualTuktuk","rawDataDiarioTuktuk","rawDataFleet","rawDataMensualFleet","rawDataDiarioFleet",
   "rawDataFull","rawDataMensualFull",
   "rawDataDiario","rawDataDiarioFull","rawDataTuktuk","metasData","proyectosData","seguimientoData",
   "allDates","allPartners","sidebarPartners","curSummaries"
  ].forEach(k => { if (Array.isArray(STATE[k])) STATE[k].length = 0; });
  STATE.rendLine  = "comb";
  STATE.metasLine = "comb";
  STATE._tuktukMensualByCityDate = null;
  STATE._tuktukMensualPartners   = null;
  STATE._tuktukMensualDates      = null;
  STATE._frescuraUI              = null;   // encabezado de página (Ola 5)
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
  STATE.myKam           = null;
  STATE.isAdmin         = false;
  STATE.canWrite        = false;
  if (STATE.perms) STATE.perms = new Set();
  if (STATE.flotasMap) STATE.flotasMap = null;
  // Charts: destruir instancias para liberar memoria.
  if (STATE.charts) {
    Object.values(STATE.charts).forEach(c => { try { c?.destroy?.(); } catch {} });
    STATE.charts = {};
  }
  _vaciarPaneles();
  // I2: estado por usuario que vive en los MÓDULOS (CALC_STATE, conversión,
  // columnas diferidas, Configuración…): cada módulo registra su reseteo en
  // shared/sesion.ts. Sin esto, entrar con otro usuario sin recargar heredaba
  // las metas a medio cargar del anterior.
  resetearEstadoDeSesion();
}

export function _clearStateAndLocalStorage() {
  _limpiarEstadoEnMemoria();
  // Sensibles en localStorage. yangoSidebarCollapsed se queda (UI pref, no sensible).
  try {
    localStorage.removeItem("yangoFilters");
    localStorage.removeItem("yangoDecline");
    // Config del scaffold retirado "Fleet Externo" (guardaba la anon key de un
    // proyecto de terceros): se sigue borrando para limpiar navegadores viejos.
    localStorage.removeItem("yangoFleetExtConfig");
    // Borrador de la Calculadora (meta global + % TukTuk sin guardar aún): si
    // otra persona usa el mismo navegador después, no debería heredar metas de
    // otro KAM a medio cargar.
    localStorage.removeItem("yangoCalcDraft");
    // Conteos de filas por consulta (páginas especulativas de fetchAllPages).
    localStorage.removeItem("yangoPgCount");
  } catch {}
  // Caché de datos en IndexedDB (data/cache.js): cerrar sesión tiene que borrar
  // la DATA, no solo el token — si no, quien use después ese navegador podría
  // ver el último snapshot de negocio sin loguearse.
  snapshotClear();
  resetAccessLogSession();
}

export function showLoginScreen() {
  _quitarSplash();
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

// `opts.provisional`: arranque con la sesión guardada, antes de que el refresh
// del token la confirme (ver initAuth). Hace exactamente lo mismo — el gating
// sale del usuario guardado hasta que _confirmarSesion lo corrija si cambió.
export function showApp(user, opts = {}) {
  _quitarSplash();
  // true mientras el refresh no confirmó la sesión guardada (lo leen las pruebas
  // y sirve para diagnosticar; ningún permiso depende de esto — eso es RLS).
  STATE._sesionProvisional = !!opts.provisional;
  document.getElementById("loginScreen").style.display  = "none";
  document.getElementById("appContainer").style.display = "flex";
  // El badge se trunca por CSS (max-width + ellipsis) para no comerse la barra;
  // el email completo queda accesible en el tooltip.
  // El email va en un <span> propio, NO como texto suelto: el badge es
  // inline-flex (por el "▾") y text-overflow:ellipsis no aplica a un nodo de
  // texto anónimo dentro de un contenedor flex — el email se salía del pill.
  const _ub = document.getElementById("userBadge");
  _ub.innerHTML = `<span class="user-badge-ico">${iconSvg("user", { size: 16 })}</span>` +
    `<span class="user-badge-mail"></span>${iconSvg("chevron-down", { size: 14, className: "user-badge-chev" })}`;
  _ub.querySelector(".user-badge-mail").textContent = user.email;
  _ub.title = user.email;
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
  // Con sesión PROVISIONAL (V1) se registra recién al confirmarla
  // (_confirmarSesion): si el refresh falla, no sale ningún insert.
  if (!opts.provisional) logAccess("tab", STATE.curTab || "rend");

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
